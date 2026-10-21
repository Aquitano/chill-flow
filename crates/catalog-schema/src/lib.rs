use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const DEFAULT_URL: &str = "https://chill-data.aquitano.me/catalog.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// Shown beside its tracks when more than one catalog is in use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Where an added catalog is published, so chill-catalog uploads its files beside it. The
    /// main catalog leaves it out and lives at `DEFAULT_URL`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    pub duration_sec: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// The name of the catalog the track came from, set when catalogs are merged.
    #[serde(skip)]
    pub catalog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbientSound {
    pub id: String,
    pub label: String,
    pub file: String,
    #[serde(default = "unity_gain")]
    pub gain_percent: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    /// Parses `text` as the catalog served at `catalog_url`, so relative file names resolve
    /// against the folder it sits in.
    pub fn parse(text: &str, catalog_url: &str) -> Result<Catalog, serde_json::Error> {
        let mut catalog: Catalog = serde_json::from_str(text)?;
        catalog.base_url = catalog_url
            .rsplit_once('/')
            .map(|(base, _)| format!("{base}/"))
            .unwrap_or_default();
        Ok(catalog)
    }

    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).expect("the catalog only holds strings, maps, and numbers");
        text.push('\n');
        text
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

    const REPO_CATALOG: &str = include_str!("../../../catalog.json");

    #[test]
    fn the_repository_catalog_survives_a_round_trip_unchanged() {
        let catalog = Catalog::parse(REPO_CATALOG, DEFAULT_URL).unwrap();
        assert_eq!(catalog.to_json(), REPO_CATALOG);
    }
}
