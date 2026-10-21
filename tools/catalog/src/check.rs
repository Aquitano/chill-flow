use std::collections::HashSet;
use std::time::Duration;

use catalog_schema::Catalog;

/// Everything wrong with the catalog that can be seen without the network.
pub fn problems(catalog: &Catalog) -> Vec<String> {
    let mut problems = Vec::new();
    let mut require = |what: &str, field: &str, value: &str| {
        if value.trim().is_empty() {
            problems.push(format!("{what} has an empty {field}"));
        }
    };
    for track in &catalog.tracks {
        let what = format!("track {:?}", track.id);
        require(&what, "id", &track.id);
        require(&what, "title", &track.title);
        require(&what, "artist", &track.artist);
        require(&what, "file", &track.file);
        if let Some(cover) = &track.cover {
            require(&what, "cover", cover);
        }
    }
    for sound in &catalog.ambient {
        let what = format!("sound {:?}", sound.id);
        require(&what, "id", &sound.id);
        require(&what, "label", &sound.label);
        require(&what, "file", &sound.file);
    }
    for mix in &catalog.mixes {
        let what = format!("mix {:?}", mix.id);
        require(&what, "id", &mix.id);
        require(&what, "name", &mix.name);
    }

    for track in catalog.tracks.iter().filter(|track| track.duration_sec == 0) {
        problems.push(format!("track {:?} has no duration", track.id));
    }
    for sound in catalog
        .ambient
        .iter()
        .filter(|sound| !(1..=100).contains(&sound.gain_percent))
    {
        problems.push(format!(
            "sound {:?} has gainPercent {}, outside 1..=100",
            sound.id, sound.gain_percent
        ));
    }
    for mix in &catalog.mixes {
        if mix.levels.is_empty() {
            problems.push(format!("mix {:?} has no levels", mix.id));
        }
        for (sound, level) in &mix.levels {
            if catalog.sound(sound).is_none() {
                problems.push(format!(
                    "mix {:?} uses sound {sound:?}, which is not in ambient",
                    mix.id
                ));
            }
            if *level > 100 {
                problems.push(format!("mix {:?} sets {sound:?} to {level}, outside 0..=100", mix.id));
            }
        }
    }

    duplicates("track", catalog.tracks.iter().map(|track| &track.id), &mut problems);
    duplicates("sound", catalog.ambient.iter().map(|sound| &sound.id), &mut problems);
    duplicates("mix", catalog.mixes.iter().map(|mix| &mix.id), &mut problems);
    problems
}

/// Ids the main catalog also uses. chill keeps the main catalog's entry, so these would never show.
pub fn shadowed(catalog: &Catalog, main: &Catalog) -> Vec<String> {
    let tracks = catalog
        .tracks
        .iter()
        .filter(|track| main.tracks.iter().any(|other| other.id == track.id))
        .map(|track| format!("track {:?} shares its id with the main catalog, which wins", track.id));
    let sounds = catalog
        .ambient
        .iter()
        .filter(|sound| main.sound(&sound.id).is_some())
        .map(|sound| format!("sound {:?} shares its id with the main catalog, which wins", sound.id));
    tracks.chain(sounds).collect()
}

fn duplicates<'a>(what: &str, ids: impl Iterator<Item = &'a String>, problems: &mut Vec<String>) {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            problems.push(format!("more than one {what} has the id {id:?}"));
        }
    }
}

/// Every file the catalog points at that the public bucket does not serve.
pub fn unreachable(catalog: &Catalog) -> Vec<String> {
    let covers = catalog.tracks.iter().filter_map(|track| track.cover.as_ref());
    let tracks = catalog.tracks.iter().map(|track| &track.file);
    let sounds = catalog.ambient.iter().map(|sound| &sound.file);
    tracks
        .chain(covers)
        .chain(sounds)
        .filter_map(|file| {
            let url = catalog.url(file);
            let response = ureq::head(&url)
                .config()
                .http_status_as_error(false)
                .timeout_global(Some(Duration::from_secs(10)))
                .build()
                .call();
            match response {
                Ok(response) if response.status().is_success() => None,
                Ok(response) => Some(format!("{url} answers HTTP {}", response.status().as_u16())),
                Err(error) => Some(format!("{url} is unreachable: {error}")),
            }
        })
        .collect()
}
