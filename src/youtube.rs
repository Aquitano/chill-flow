use std::collections::BTreeMap;
use std::io::{self, Read};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
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

pub struct Lookup {
    process: Option<Arc<LookupProcess>>,
}

struct LookupProcess {
    child: Mutex<Child>,
    cancelled: AtomicBool,
}

impl Lookup {
    fn spawn(mut command: Command, report: impl FnOnce(Result<Vec<u8>>) + Send + 'static) -> Self {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                report(Err(match error.kind() {
                    io::ErrorKind::NotFound => anyhow!(INSTALL_HINT),
                    _ => anyhow!("could not run yt-dlp: {error}"),
                }));
                return Self { process: None };
            }
        };
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            report(Err(anyhow!("yt-dlp started without output pipes")));
            return Self { process: None };
        };
        let process = Arc::new(LookupProcess {
            child: Mutex::new(child),
            cancelled: AtomicBool::new(false),
        });
        let worker = Arc::clone(&process);
        thread::spawn(move || {
            let stderr = thread::spawn(move || read_pipe(stderr));
            let stdout = read_pipe(stdout);
            let status = worker.wait();
            let stderr = stderr
                .join()
                .unwrap_or_else(|_| Err(io::Error::other("yt-dlp error reader stopped")));
            if !worker.cancelled.load(Ordering::Acquire) {
                report(lookup_output(stdout, stderr, status));
            }
        });
        Self { process: Some(process) }
    }
}

impl Drop for Lookup {
    fn drop(&mut self) {
        if let Some(process) = &self.process {
            process.cancelled.store(true, Ordering::Release);
            let mut child = process.child();
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl LookupProcess {
    fn child(&self) -> MutexGuard<'_, Child> {
        self.child.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn wait(&self) -> io::Result<ExitStatus> {
        loop {
            if let Some(status) = self.child().try_wait()? {
                return Ok(status);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn read_pipe(mut pipe: impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    pipe.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn lookup_output(
    stdout: io::Result<Vec<u8>>,
    stderr: io::Result<Vec<u8>>,
    status: io::Result<ExitStatus>,
) -> Result<Vec<u8>> {
    let status = status.context("could not wait for yt-dlp")?;
    if !status.success() {
        let stderr = stderr.context("could not read yt-dlp error output")?;
        let stderr = String::from_utf8_lossy(&stderr);
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
    stdout.context("could not read yt-dlp output")
}

fn yt_dlp(args: &[&str], report: impl FnOnce(Result<Vec<u8>>) + Send + 'static) -> Lookup {
    let mut command = Command::new("yt-dlp");
    command.args(args);
    Lookup::spawn(command, report)
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

pub fn inspect(url: &str, report: impl FnOnce(Result<Saved>) + Send + 'static) -> Lookup {
    let source = url.to_owned();
    yt_dlp(&["-J", "--flat-playlist", "--no-warnings", "--", url], move |result| {
        report(result.and_then(|stdout| saved_from(&source, serde_json::from_slice(&stdout)?)));
    })
}

pub fn resolve(url: &str, start_secs: f64, report: impl FnOnce(Result<StreamInput>) + Send + 'static) -> Lookup {
    let format = "bestaudio[ext=m4a]/bestaudio/best[height<=360]/best";
    yt_dlp(
        &["-j", "-f", format, "--no-playlist", "--no-warnings", "--", url],
        move |result| {
            report(result.and_then(|stdout| {
                let format: Format = serde_json::from_slice(&stdout)?;
                let live = format.is_live.unwrap_or(false);
                Ok(StreamInput {
                    url: format.url,
                    headers: format.http_headers.into_iter().collect(),
                    start_secs: if live { 0.0 } else { start_secs },
                    live,
                })
            }));
        },
    )
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
    use std::io::Write;
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Instant;

    use super::*;

    fn test_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "youtube::tests::lookup_test_process", "--nocapture"])
            .env("CHILL_LOOKUP_TEST_MODE", mode);
        command
    }

    #[test]
    fn lookup_test_process() {
        match std::env::var("CHILL_LOOKUP_TEST_MODE").as_deref() {
            Ok("wait") => thread::sleep(Duration::from_secs(30)),
            Ok("output") => {
                let bytes = vec![b'x'; 256 * 1024];
                io::stdout().write_all(&bytes).unwrap();
                io::stderr().write_all(&bytes).unwrap();
            }
            _ => {}
        }
    }

    #[test]
    fn dropping_a_lookup_kills_and_reaps_its_process_without_reporting() {
        let (reported, results) = mpsc::channel();
        let lookup = Lookup::spawn(test_command("wait"), move |result| {
            let _ = reported.send(result);
        });
        let process = Arc::clone(lookup.process.as_ref().unwrap());
        assert!(process.child().try_wait().unwrap().is_none());

        let started = Instant::now();
        drop(lookup);

        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(process.child().try_wait().unwrap().is_some());
        assert!(matches!(
            results.recv_timeout(Duration::from_secs(2)),
            Err(RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn lookup_drains_both_output_pipes_before_reporting_success() {
        let (reported, results) = mpsc::channel();
        let _lookup = Lookup::spawn(test_command("output"), move |result| {
            let _ = reported.send(result);
        });

        let output = results.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();

        assert!(output.len() >= 256 * 1024);
    }

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
