use std::collections::BTreeMap;
use std::process::Command;

use anyhow::{Result, anyhow, bail};
use serde::Deserialize;

use crate::audio::StreamInput;
use crate::model::{Item, Playable, Saved};

const INSTALL_HINT: &str = "yt-dlp is not installed. Install it with `brew install yt-dlp deno` (macOS) or `winget install yt-dlp.yt-dlp DenoLand.Deno` (Windows).";

#[derive(Debug, Deserialize)]
struct Info {
    #[serde(rename = "_type")]
    kind: Option<String>,
    id: String,
    title: Option<String>,
    /// The title without the timestamp yt-dlp appends to live streams.
    fulltitle: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    live_status: Option<String>,
    #[serde(default)]
    entries: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
struct Entry {
    id: String,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    live_status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Format {
    url: String,
    #[serde(default)]
    http_headers: BTreeMap<String, String>,
    is_live: Option<bool>,
}

fn yt_dlp(args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("yt-dlp")
        .args(args)
        .output()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => anyhow!(INSTALL_HINT),
            _ => anyhow!("could not run yt-dlp: {error}"),
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr
            .lines()
            .rev()
            .find(|line| line.starts_with("ERROR"))
            .or_else(|| stderr.lines().last())
            .unwrap_or("yt-dlp failed")
            .trim_start_matches("ERROR: ");
        // "[youtube] <id>: This video is unavailable" names the extractor and id; keep the reason.
        let reason = reason
            .strip_prefix('[')
            .and_then(|rest| rest.split_once(": "))
            .map_or(reason, |(_, message)| message);
        bail!("{reason}");
    }
    Ok(output.stdout)
}

fn video_item(id: &str, title: Option<String>, channel: Option<String>, duration: Option<f64>, live: bool) -> Item {
    Item {
        key: format!("yt:{id}"),
        title: title.unwrap_or_else(|| id.to_string()),
        artist: channel.unwrap_or_default(),
        duration: duration.filter(|_| !live).map(|seconds| seconds.round() as u32),
        cover: Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
        play: Playable::YouTube {
            url: format!("https://www.youtube.com/watch?v={id}"),
            live,
        },
    }
}

fn saved_from(url: &str, info: Info) -> Result<Saved> {
    let channel = info.channel.or(info.uploader).unwrap_or_default();
    let is_live = |status: &Option<String>| status.as_deref() == Some("is_live");
    if info.kind.as_deref() == Some("playlist") {
        let items: Vec<Item> = info
            .entries
            .into_iter()
            .filter(|entry| entry.title.as_deref() != Some("[Private video]"))
            .map(|entry| {
                let live = is_live(&entry.live_status);
                video_item(
                    &entry.id,
                    entry.title,
                    entry.channel.or(entry.uploader),
                    entry.duration,
                    live,
                )
            })
            .collect();
        if items.is_empty() {
            bail!("that playlist has no playable videos");
        }
        return Ok(Saved {
            id: format!("ytpl:{}", info.id),
            url: url.to_string(),
            title: info.title.unwrap_or(info.id),
            channel,
            items,
        });
    }
    let item = video_item(
        &info.id,
        info.fulltitle.or(info.title),
        Some(channel.clone()),
        info.duration,
        is_live(&info.live_status),
    );
    Ok(Saved {
        id: item.key.clone(),
        url: url.to_string(),
        title: item.title.clone(),
        channel,
        items: vec![item],
    })
}

pub fn inspect(url: &str) -> Result<Saved> {
    let stdout = yt_dlp(&["-J", "--flat-playlist", "--no-warnings", "--", url])?;
    saved_from(url, serde_json::from_slice(&stdout)?)
}

pub fn resolve(url: &str, start_secs: f64) -> Result<StreamInput> {
    let format = "bestaudio[ext=m4a]/bestaudio/best[height<=360]/best";
    let stdout = yt_dlp(&["-j", "-f", format, "--no-playlist", "--no-warnings", "--", url])?;
    let format: Format = serde_json::from_slice(&stdout)?;
    let live = format.is_live.unwrap_or(false);
    Ok(StreamInput {
        url: format.url,
        headers: format.http_headers.into_iter().collect(),
        start_secs: if live { 0.0 } else { start_secs },
        live,
    })
}

/// The video a `watch?v=…&list=…` link points at, so a pasted playlist starts there.
pub fn start_key(url: &str) -> Option<String> {
    let url = url.split_once('#').map_or(url, |(url, _)| url);
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let id = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("v="))
        .or_else(|| path.split_once("youtu.be/").map(|(_, id)| id))?;
    (!id.is_empty()).then(|| format!("yt:{id}"))
}

pub fn looks_like_url(text: &str) -> bool {
    let text = text.trim();
    (text.starts_with("https://") || text.starts_with("http://")) && !text.contains(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_playlists_become_saved_sources_without_private_entries() {
        let json = r#"{"_type":"playlist","id":"PL1","title":"Lofi","channel":"Chill","entries":[
            {"id":"a1","title":"First","duration":181.4,"channel":"Chill"},
            {"id":"b2","title":"[Private video]"},
            {"id":"c3","title":"Radio","live_status":"is_live"}]}"#;
        let saved = saved_from(
            "https://youtube.com/playlist?list=PL1",
            serde_json::from_str(json).unwrap(),
        )
        .unwrap();
        assert_eq!(saved.id, "ytpl:PL1");
        assert_eq!(saved.kind_label(), "playlist");
        let keys: Vec<_> = saved.items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, ["yt:a1", "yt:c3"]);
        assert_eq!(saved.items[0].duration, Some(181));
        assert!(saved.items[1].is_live() && saved.items[1].duration.is_none());
    }

    #[test]
    fn watch_links_start_at_their_video() {
        assert_eq!(
            start_key("https://www.youtube.com/watch?v=abc&list=PL1").as_deref(),
            Some("yt:abc")
        );
        assert_eq!(start_key("https://youtube.com/playlist?list=PL1"), None);
        assert_eq!(start_key("https://youtu.be/abc?list=PL1").as_deref(), Some("yt:abc"));
        assert_eq!(
            start_key("https://www.youtube.com/watch?v=abc#t=30").as_deref(),
            Some("yt:abc")
        );
    }
}
