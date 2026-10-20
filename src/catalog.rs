use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const EMBEDDED: &str = include_str!("../catalog.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub tracks: Vec<CatalogTrack>,
    pub ambient: Vec<AmbientSound>,
    #[serde(default)]
    pub mixes: Vec<Mix>,
    #[serde(skip)]
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub file: String,
    pub cover: Option<String>,
    pub duration_sec: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbientSound {
    pub id: String,
    pub label: String,
    pub file: String,
    #[serde(default = "unity_gain")]
    pub gain_percent: u32,
    pub credit: Option<String>,
}

fn unity_gain() -> u32 {
    100
}

/// Sound id to level 0..=100. Sounds absent from the map are off.
pub type Levels = BTreeMap<String, u8>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mix {
    pub id: String,
    pub name: String,
    pub levels: Levels,
}

impl Catalog {
    fn parse(text: &str, catalog_url: &str) -> Result<Catalog> {
        let mut catalog: Catalog = serde_json::from_str(text)?;
        catalog.base_url = catalog_url
            .rsplit_once('/')
            .map(|(base, _)| format!("{base}/"))
            .unwrap_or_default();
        Ok(catalog)
    }

    /// The last catalog that loaded, or the copy compiled into the binary.
    pub fn offline(cache_dir: &Path, catalog_url: &str) -> Catalog {
        std::fs::read_to_string(cache_dir.join("catalog.json"))
            .ok()
            .and_then(|text| Catalog::parse(&text, catalog_url).ok())
            .or_else(|| Catalog::parse(EMBEDDED, catalog_url).ok())
            .unwrap_or_else(|| Catalog {
                tracks: Vec::new(),
                ambient: Vec::new(),
                mixes: Vec::new(),
                base_url: String::new(),
            })
    }

    pub fn fetch(cache_dir: &Path, catalog_url: &str) -> Result<Catalog> {
        let text = ureq::get(catalog_url)
            .config()
            .timeout_global(Some(Duration::from_secs(8)))
            .build()
            .call()
            .with_context(|| format!("fetching {catalog_url}"))?
            .body_mut()
            .read_to_string()?;
        let catalog = Catalog::parse(&text, catalog_url).context("catalog.json is malformed")?;
        let _ = std::fs::write(cache_dir.join("catalog.json"), text);
        Ok(catalog)
    }

    pub fn url(&self, file: &str) -> String {
        if file.starts_with("http://") || file.starts_with("https://") {
            file.to_string()
        } else {
            format!("{}{file}", self.base_url)
        }
    }

    pub fn sound(&self, id: &str) -> Option<&AmbientSound> {
        self.ambient.iter().find(|sound| sound.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses_and_resolves_relative_files() {
        let catalog = Catalog::parse(EMBEDDED, "https://cdn.example/sub/catalog.json").unwrap();
        assert!(!catalog.ambient.is_empty());
        assert_eq!(catalog.url("a.mp3"), "https://cdn.example/sub/a.mp3");
        assert_eq!(catalog.url("https://elsewhere/b.mp3"), "https://elsewhere/b.mp3");
        let known = |id: &String| catalog.sound(id).is_some();
        assert!(catalog.mixes.iter().all(|mix| mix.levels.keys().all(known)));
    }
}
