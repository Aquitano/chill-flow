use std::process::{Command, Stdio};

use jiff::civil::Date;

/// The programs chill runs but doesn't ship.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Ffmpeg,
    YtDlp,
    Deno,
}

/// yt-dlp versions are release dates, and YouTube changes often enough that a release this old
/// has likely stopped resolving some links.
const YT_DLP_STALE_DAYS: i32 = 60;

impl Tool {
    pub const ALL: [Tool; 3] = [Tool::Ffmpeg, Tool::YtDlp, Tool::Deno];

    pub fn name(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::YtDlp => "yt-dlp",
            Tool::Deno => "deno",
        }
    }

    pub fn purpose(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "decodes every stream",
            Tool::YtDlp => "resolves YouTube links",
            Tool::Deno => "lets yt-dlp read YouTube's player",
        }
    }

    pub fn install(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ffmpeg, false) => "brew install ffmpeg",
            (Tool::Ffmpeg, true) => "winget install Gyan.FFmpeg",
            (Tool::YtDlp, false) => "brew install yt-dlp",
            (Tool::YtDlp, true) => "winget install yt-dlp.yt-dlp",
            (Tool::Deno, false) => "brew install deno",
            (Tool::Deno, true) => "winget install DenoLand.Deno",
        }
    }

    pub fn upgrade(self) -> &'static str {
        if cfg!(windows) {
            "winget upgrade yt-dlp.yt-dlp"
        } else {
            "brew upgrade yt-dlp"
        }
    }

    /// The installed version, or `None` when the program isn't on `PATH`.
    pub fn version(self) -> Option<String> {
        let flag = if self == Tool::Ffmpeg { "-version" } else { "--version" };
        let output = Command::new(self.name())
            .arg(flag)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text.lines().next().unwrap_or_default();
        let mut words = line.split_whitespace();
        // "ffmpeg version 7.1.1 Copyright…", "deno 2.5.4 (stable…)", "2025.09.26"
        let version = match words.next() {
            Some(first) if first == self.name() => words.find(|word| *word != "version"),
            first => first,
        };
        Some(version.unwrap_or("installed").to_string())
    }

    /// How many days old a yt-dlp version is, when it's older than YouTube tends to allow.
    pub fn stale_days(self, version: &str, today: Date) -> Option<i32> {
        if self != Tool::YtDlp {
            return None;
        }
        let mut parts = version.split('.').map(str::parse::<i16>);
        let (Some(Ok(year)), Some(Ok(month)), Some(Ok(day))) = (parts.next(), parts.next(), parts.next()) else {
            return None;
        };
        let released = Date::new(year, month as i8, day as i8).ok()?;
        let days = (today - released).get_days();
        (days > YT_DLP_STALE_DAYS).then_some(days)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_old_yt_dlp_release_counts_as_stale() {
        let today = Date::new(2026, 10, 19).unwrap();
        assert_eq!(Tool::YtDlp.stale_days("2026.10.01", today), None);
        assert_eq!(Tool::YtDlp.stale_days("2026.06.01", today), Some(140));
        assert_eq!(Tool::YtDlp.stale_days("2026.06.01.232403", today), Some(140));
        assert_eq!(Tool::Deno.stale_days("2026.06.01", today), None);
        assert_eq!(Tool::YtDlp.stale_days("installed", today), None);
    }
}
