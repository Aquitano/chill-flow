use std::io::{BufWriter, Read, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const CAPACITY: usize = 100;
pub const MESSAGE_LIMIT: usize = 2048;
const FILE_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
pub struct Diagnostic {
    #[serde(skip)]
    pub id: usize,
    pub message: String,
    pub last_seen: String,
    pub occurrences: u64,
    pub dismissed: bool,
}

#[derive(Default, Deserialize, Serialize)]
struct History {
    entries: Vec<Diagnostic>,
    omitted: u64,
    #[serde(default)]
    overflow_dismissed: bool,
}

pub struct Diagnostics {
    history: History,
    history_loaded: bool,
    next_id: usize,
    pub path: PathBuf,
    pub log_error: Option<String>,
}

impl Diagnostics {
    pub fn new(path: PathBuf) -> Self {
        let loaded = (|| -> anyhow::Result<History> {
            let file = match std::fs::File::open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(History::default()),
                Err(error) => return Err(error.into()),
            };
            let mut text = String::new();
            file.take(FILE_LIMIT).read_to_string(&mut text)?;
            let mut history: History = serde_json::from_str(&text)?;
            history.entries.truncate(CAPACITY);
            for (id, entry) in history.entries.iter_mut().enumerate() {
                entry.id = id;
                entry.message = redact(&entry.message, None);
                entry.last_seen.truncate(entry.last_seen.floor_char_boundary(64));
            }
            Ok(history)
        })();
        match loaded {
            Ok(history) => Self {
                next_id: history.entries.len(),
                history,
                history_loaded: true,
                path,
                log_error: None,
            },
            Err(error) => Self {
                history: History::default(),
                history_loaded: false,
                next_id: 0,
                path,
                log_error: Some(format!(
                    "Could not read diagnostic log: {error}. New entries stay in memory. Restore access to the log and restart chill to resume saving."
                )),
            },
        }
    }

    pub fn entries(&self) -> &[Diagnostic] {
        &self.history.entries
    }

    pub fn omitted(&self) -> u64 {
        self.history.omitted
    }

    pub fn pending(&self) -> usize {
        self.history.entries.iter().filter(|entry| !entry.dismissed).count()
            + usize::from(self.history.omitted > 0 && !self.history.overflow_dismissed)
    }

    /// The pending entry seen most recently, so the notice shows what just went wrong.
    pub fn latest_pending(&self) -> Option<&Diagnostic> {
        self.history
            .entries
            .iter()
            .filter(|entry| !entry.dismissed)
            .max_by_key(|entry| entry.last_seen.parse::<jiff::Timestamp>().ok())
    }

    pub fn adjacent_entry(&self, id: usize, step: isize) -> Option<usize> {
        let entries = self.entries();
        let index = entries
            .iter()
            .position(|entry| entry.id == id)
            .map(|index| index.saturating_add_signed(step).min(entries.len().saturating_sub(1)))
            .unwrap_or(0);
        entries.get(index).map(|entry| entry.id)
    }

    pub fn record(&mut self, message: &str, secret: Option<&str>) {
        let message = redact(message, secret);
        let now = jiff::Timestamp::now().to_string();
        if let Some(entry) = self.history.entries.iter_mut().find(|entry| entry.message == message) {
            entry.occurrences = entry.occurrences.saturating_add(1);
            entry.last_seen = now;
            entry.dismissed = false;
        } else {
            if self.history.entries.len() == CAPACITY {
                if let Some(index) = self.history.entries.iter().position(|entry| entry.dismissed) {
                    self.history.entries.remove(index);
                } else {
                    self.history.omitted = self.history.omitted.saturating_add(1);
                    self.history.overflow_dismissed = false;
                    self.save();
                    return;
                }
            }
            self.history.entries.push(Diagnostic {
                id: self.next_id,
                message,
                last_seen: now,
                occurrences: 1,
                dismissed: false,
            });
            self.next_id += 1;
        }
        self.save();
    }

    pub fn dismiss(&mut self, id: usize) {
        if let Some(entry) = self.history.entries.iter_mut().find(|entry| entry.id == id) {
            entry.dismissed = true;
            self.save();
        }
    }

    pub fn dismiss_overflow(&mut self) {
        self.history.overflow_dismissed = true;
        self.save();
    }

    fn save(&mut self) {
        if !self.history_loaded {
            return;
        }
        let result = (|| -> anyhow::Result<()> {
            let mut file =
                tempfile::NamedTempFile::new_in(self.path.parent().unwrap_or_else(|| std::path::Path::new(".")))?;
            let mut writer = BufWriter::new(&mut file);
            serde_json::to_writer(&mut writer, &self.history)?;
            writer.flush()?;
            drop(writer);
            file.persist(&self.path)?;
            Ok(())
        })();
        self.log_error = result
            .err()
            .map(|error| format!("Could not save diagnostic log: {error}"));
    }
}

pub fn redact(message: &str, secret: Option<&str>) -> String {
    let message = match secret.filter(|secret| !secret.is_empty()) {
        Some(secret) => message.replace(secret, "[sync key]"),
        None => message.to_owned(),
    };
    let mut text = String::new();
    for word in message.split_whitespace() {
        if !text.is_empty() {
            text.push(' ');
        }
        if word.contains("://") || word.contains("www.") {
            text.push_str("[URL]");
        } else if word
            .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_')
            .any(|part| {
                part.len() >= 43
                    && part
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_')
            })
        {
            text.push_str("[key]");
        } else {
            text.extend(word.chars().filter(|ch| !ch.is_control()));
        }
    }
    if text.len() > MESSAGE_LIMIT {
        text.truncate(text.floor_char_boundary(MESSAGE_LIMIT));
        text.push_str("… [truncated]");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_notice_shows_the_failure_seen_last() {
        let dir = tempfile::tempdir().unwrap();
        let mut diagnostics = Diagnostics::new(dir.path().join("diagnostics.json"));
        let mut record = |message| {
            std::thread::sleep(std::time::Duration::from_millis(2));
            diagnostics.record(message, None);
            diagnostics.latest_pending().map(|entry| entry.message.clone())
        };
        assert_eq!(record("No audio output").as_deref(), Some("No audio output"));
        assert_eq!(
            record("YouTube links need ffmpeg").as_deref(),
            Some("YouTube links need ffmpeg")
        );
        assert_eq!(record("No audio output").as_deref(), Some("No audio output"));
    }

    #[test]
    fn dismissal_keeps_history_and_repeated_failures_reopen_the_notice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let mut diagnostics = Diagnostics::new(path.clone());
        diagnostics.record("ffmpeg is missing", None);
        diagnostics.dismiss(0);
        assert_eq!(diagnostics.pending(), 0);
        let mut restored = Diagnostics::new(path);
        assert_eq!(restored.entries().len(), 1);
        assert!(restored.entries()[0].dismissed);
        restored.record("ffmpeg is missing", None);
        assert_eq!(restored.pending(), 1);
        assert_eq!(restored.entries()[0].occurrences, 2);
    }

    #[test]
    fn unreadable_history_survives_new_notices_until_successful_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let mut original = Diagnostics::new(path.clone());
        original.record("earlier unresolved failure", None);
        let valid = std::fs::read(&path).unwrap();
        let mut unreadable = valid.clone();
        unreadable.push(0xff);
        std::fs::write(&path, &unreadable).unwrap();

        let mut failed = Diagnostics::new(path.clone());
        assert!(failed.log_error.is_some());
        failed.record("new failure", None);
        failed.dismiss(0);
        failed.dismiss_overflow();
        assert_eq!(std::fs::read(&path).unwrap(), unreadable);
        assert_eq!(failed.entries()[0].message, "new failure");

        std::fs::write(&path, &valid).unwrap();
        failed.record("another failure", None);
        assert!(failed.log_error.is_some());
        assert_eq!(std::fs::read(&path).unwrap(), valid);
        let mut recovered = Diagnostics::new(path.clone());
        assert!(recovered.log_error.is_none());
        assert_eq!(recovered.entries()[0].message, "earlier unresolved failure");
        recovered.record("failure after recovery", None);
        assert_eq!(Diagnostics::new(path).entries().len(), 2);
    }

    #[test]
    fn full_history_preserves_unresolved_failures_and_counts_overflow() {
        let dir = tempfile::tempdir().unwrap();
        let mut diagnostics = Diagnostics::new(dir.path().join("diagnostics.json"));
        for index in 0..CAPACITY + 3 {
            diagnostics.record(&format!("failure {index}"), None);
        }
        assert_eq!(diagnostics.entries().len(), CAPACITY);
        assert_eq!(diagnostics.entries()[0].message, "failure 0");
        assert_eq!(diagnostics.omitted(), 3);
        diagnostics.dismiss_overflow();
        assert_eq!(diagnostics.omitted(), 3);
        assert_eq!(diagnostics.pending(), CAPACITY);
        diagnostics.dismiss(0);
        diagnostics.record("new failure", None);
        assert_eq!(diagnostics.entries()[0].message, "failure 1");
        assert_eq!(diagnostics.entries().last().unwrap().message, "new failure");
        assert_eq!(diagnostics.entries().last().unwrap().id, CAPACITY);
        let log = std::fs::read_to_string(&diagnostics.path).unwrap();
        assert!(!log.contains("\"id\""));
        let mut restored = Diagnostics::new(diagnostics.path.clone());
        assert!(restored.entries().iter().enumerate().all(|(id, entry)| entry.id == id));
        restored.dismiss(restored.entries()[0].id);
        restored.record("failure after reload", None);
        assert_eq!(restored.entries().last().unwrap().id, CAPACITY);
    }

    #[test]
    fn log_removes_urls_keys_and_terminal_controls() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let mut diagnostics = Diagnostics::new(path.clone());
        diagnostics.record(
            "Failed https://private.example/secret?key=hidden with short-secret \u{1b}",
            Some("short-secret"),
        );
        let log = std::fs::read_to_string(path).unwrap();
        assert!(!log.contains("private.example") && !log.contains("short-secret") && !log.contains("hidden"));
        assert_eq!(diagnostics.entries()[0].message, "Failed [URL] with [sync key] ");
        assert_eq!(redact(&"a".repeat(64), None), "[key]");
    }
}
