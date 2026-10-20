use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};

pub use catalog_schema::{AmbientSound, Catalog, CatalogTrack, Levels, Mix};

const EMBEDDED: &str = include_str!("../catalog.json");

/// The last catalog that loaded, or the copy compiled into the binary.
pub fn offline(cache_dir: &Path, catalog_url: &str) -> Catalog {
    std::fs::read_to_string(cache_dir.join("catalog.json"))
        .ok()
        .and_then(|text| Catalog::parse(&text, catalog_url).ok())
        .or_else(|| Catalog::parse(EMBEDDED, catalog_url).ok())
        .unwrap_or_default()
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
