use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

pub use catalog_schema::{AmbientSound, Catalog, CatalogTrack, Levels, Mix};

const EMBEDDED: &str = include_str!("../catalog.json");

/// The last copy of the catalog at `catalog_url` that loaded, or for the main catalog the copy
/// compiled into the binary. The main catalog also reads `catalog.json`, where chill kept it
/// before there could be more than one.
pub fn offline(cache_dir: &Path, catalog_url: &str, main: bool) -> Catalog {
    let cached = |file: PathBuf| {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|text| Catalog::parse(&text, catalog_url).ok())
    };
    cached(cache_file(cache_dir, catalog_url))
        .or_else(|| main.then(|| cached(cache_dir.join("catalog.json"))).flatten())
        .or_else(|| main.then(|| Catalog::parse(EMBEDDED, catalog_url).ok()).flatten())
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
    let _ = std::fs::write(cache_file(cache_dir, catalog_url), text);
    Ok(catalog)
}

pub fn forget(cache_dir: &Path, catalog_url: &str) {
    let _ = std::fs::remove_file(cache_file(cache_dir, catalog_url));
}

fn cache_file(cache_dir: &Path, catalog_url: &str) -> PathBuf {
    let digest = Sha256::digest(catalog_url.as_bytes());
    let name: String = digest[..6].iter().map(|byte| format!("{byte:02x}")).collect();
    cache_dir.join(format!("catalog-{name}.json"))
}

/// The name shown beside a catalog's tracks: its own, or the host it comes from.
pub fn label(catalog: &Catalog, catalog_url: &str) -> String {
    catalog.name.clone().unwrap_or_else(|| {
        let host = catalog_url.split("://").nth(1).unwrap_or(catalog_url);
        host.split('/').next().unwrap_or(host).to_string()
    })
}

/// One catalog holding every entry of `catalogs`, with file names made absolute so each still
/// points into the folder it came from. Ids are shared across catalogs, so likes and scenes keep
/// working whichever catalog an entry sits in; when two catalogs use the same id, the earlier one
/// wins.
pub fn merge(catalogs: &[(String, Catalog)]) -> Catalog {
    let mut merged = Catalog {
        base_url: catalogs
            .first()
            .map(|(_, catalog)| catalog.base_url.clone())
            .unwrap_or_default(),
        ..Catalog::default()
    };
    let (mut tracks, mut sounds, mut mixes) = (HashSet::new(), HashSet::new(), HashSet::new());
    for (url, catalog) in catalogs {
        let name = label(catalog, url);
        let resolve = |file: &str| {
            if file.is_empty() {
                String::new()
            } else {
                catalog.url(file)
            }
        };
        for track in catalog.tracks.iter().filter(|track| tracks.insert(track.id.clone())) {
            merged.tracks.push(CatalogTrack {
                file: resolve(&track.file),
                cover: track.cover.as_deref().map(resolve),
                catalog: Some(name.clone()),
                ..track.clone()
            });
        }
        for sound in catalog.ambient.iter().filter(|sound| sounds.insert(sound.id.clone())) {
            merged.ambient.push(AmbientSound {
                file: resolve(&sound.file),
                ..sound.clone()
            });
        }
        merged
            .mixes
            .extend(catalog.mixes.iter().filter(|mix| mixes.insert(mix.id.clone())).cloned());
    }
    merged
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

    #[test]
    fn merged_catalogs_keep_their_own_folders_and_the_first_entry_for_a_shared_id() {
        let main = Catalog::parse(
            r#"{"name": "chill", "tracks": [{"id": "drive", "title": "Drive", "artist": "A", "file": "drive.mp3", "durationSec": 60}],
                "ambient": [{"id": "rain", "label": "Rain", "file": "rain.mp3"}]}"#,
            "https://public.example/catalog.json",
        )
        .unwrap();
        let friends = Catalog::parse(
            r#"{"tracks": [{"id": "drive", "title": "Other drive", "artist": "B", "file": "x.mp3", "durationSec": 60},
                           {"id": "home", "title": "Home", "artist": "B", "file": "home.mp3", "cover": "home.png", "durationSec": 90}],
                "ambient": [{"id": "rain", "label": "Other rain", "file": "r.mp3"}]}"#,
            "https://public.example/c/k3x9/catalog.json",
        )
        .unwrap();

        let merged = merge(&[
            ("https://public.example/catalog.json".into(), main),
            ("https://public.example/c/k3x9/catalog.json".into(), friends),
        ]);

        let summary: Vec<_> = merged
            .tracks
            .iter()
            .map(|track| (track.title.as_str(), merged.url(&track.file), track.catalog.as_deref()))
            .collect();
        assert_eq!(
            summary,
            [
                ("Drive", "https://public.example/drive.mp3".to_string(), Some("chill")),
                (
                    "Home",
                    "https://public.example/c/k3x9/home.mp3".to_string(),
                    Some("public.example")
                ),
            ]
        );
        assert_eq!(
            merged.tracks[1].cover.as_deref(),
            Some("https://public.example/c/k3x9/home.png")
        );
        assert_eq!(merged.ambient.len(), 1);
        assert_eq!(merged.ambient[0].label, "Rain");
    }
}
