use std::io::{Read, Seek};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

use jiff::civil::Date;

/// The programs chill runs for YouTube but doesn't ship.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Ffmpeg,
    YtDlp,
    Deno,
}

/// yt-dlp versions are release dates, and YouTube changes often enough that a release this old
/// has likely stopped resolving some links.
const YT_DLP_STALE_DAYS: i32 = 60;
/// The oldest Node.js yt-dlp runs in place of deno.
const NODE_MIN_MAJOR: u32 = 22;

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
            Tool::Ffmpeg => "decodes YouTube audio",
            Tool::YtDlp => "resolves YouTube links",
            Tool::Deno => "lets yt-dlp read YouTube's player",
        }
    }

    pub fn install(self) -> String {
        install_command(&[self]).unwrap_or_else(|| {
            match self {
                Tool::Ffmpeg => "install ffmpeg with your system package manager (https://ffmpeg.org/download.html)",
                Tool::YtDlp => "follow https://github.com/yt-dlp/yt-dlp#installation",
                Tool::Deno => "follow https://docs.deno.com/runtime/getting_started/installation/",
            }
            .to_owned()
        })
    }

    fn winget_id(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "Gyan.FFmpeg",
            Tool::YtDlp => "yt-dlp.yt-dlp",
            Tool::Deno => "DenoLand.Deno",
        }
    }

    pub fn upgrade(self) -> &'static str {
        match (self, std::env::consts::OS) {
            (Tool::Ffmpeg, "macos") => "brew upgrade ffmpeg",
            (Tool::YtDlp, "macos") => "brew upgrade yt-dlp",
            (Tool::Deno, "macos") => "brew upgrade deno",
            (Tool::Ffmpeg, "windows") => "winget upgrade Gyan.FFmpeg",
            (Tool::YtDlp, "windows") => "winget upgrade yt-dlp.yt-dlp",
            (Tool::Deno, "windows") => "winget upgrade DenoLand.Deno",
            _ => "update it with the package manager or installer you used to install it",
        }
    }

    pub fn inspect(self) -> Inspection {
        let path = which::which(self.name()).ok();
        let state = match &path {
            None => State::Missing,
            Some(path) => {
                let flag = if self == Tool::Ffmpeg { "-version" } else { "--version" };
                match version_output(Command::new(path).arg(flag), Duration::from_secs(5))
                    .and_then(|text| self.parse_version(&text))
                {
                    Ok(version) => State::Installed(version),
                    Err(error) => State::Broken(format!("{error:#}")),
                }
            }
        };
        Inspection {
            tool: self,
            path,
            state,
        }
    }

    fn parse_version(self, text: &str) -> Result<String> {
        let mut words = text.lines().next().unwrap_or_default().split_whitespace();
        let version = match self {
            Tool::Ffmpeg if words.next() == Some("ffmpeg") && words.next() == Some("version") => words.next(),
            Tool::Deno if words.next() == Some("deno") => words.next(),
            Tool::YtDlp => words.next(),
            _ => None,
        };
        match version.filter(|value| value.chars().any(|ch| ch.is_ascii_digit())) {
            Some(version) => Ok(version.to_owned()),
            None => bail!("unrecognized version output: {}", text.trim()),
        }
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

/// One command that installs `tools`: winget on Windows, and Homebrew on a Mac or wherever
/// it's installed.
fn install_command(tools: &[Tool]) -> Option<String> {
    let (manager, package): (&str, fn(Tool) -> &'static str) = if cfg!(windows) {
        ("winget", Tool::winget_id)
    } else if cfg!(target_os = "macos") || has_brew() {
        ("brew", Tool::name)
    } else {
        return None;
    };
    let packages: Vec<&str> = tools.iter().map(|&tool| package(tool)).collect();
    Some(format!("{manager} install {}", packages.join(" ")))
}

fn has_brew() -> bool {
    which::which("brew").is_ok()
}

/// What stops YouTube links from working on this machine, if any of the tools is missing.
pub fn missing_for_youtube() -> Option<String> {
    let missing: Vec<Tool> = Tool::ALL
        .into_iter()
        .filter(|&tool| which::which(tool.name()).is_err() && !(tool == Tool::Deno && node_stands_in()))
        .collect();
    youtube_hint(&missing, install_command(&missing), has_brew())
}

fn youtube_hint(missing: &[Tool], command: Option<String>, has_brew: bool) -> Option<String> {
    let (names, them) = match missing {
        [] => return None,
        [tool] => (tool.name().to_owned(), "it"),
        [first, second] => (format!("{} and {}", first.name(), second.name()), "them"),
        _ => ("ffmpeg, yt-dlp, and deno".to_owned(), "them"),
    };
    // winget puts what it installs on the PATH of terminals opened afterwards.
    let install = match command {
        Some(command) if command.starts_with("winget") => {
            format!("Install {them} with `{command}`, then start chill from a new terminal.")
        }
        Some(command) if !has_brew => {
            format!("Install Homebrew from https://brew.sh, then install {them} with `{command}`.")
        }
        Some(command) => format!("Install {them} with `{command}`."),
        None => "Run chill doctor to see how to install them.".to_owned(),
    };
    Some(format!("YouTube links need {names}, which chill can't find. {install}"))
}

/// The version of Node.js on the PATH, when it's new enough for yt-dlp to use in place of deno.
pub fn node() -> Option<String> {
    let path = which::which("node").ok()?;
    let output = version_output(Command::new(path).arg("--version"), Duration::from_secs(5)).ok()?;
    usable_node(&output).map(str::to_owned)
}

/// Checked once per run, and first by the startup tool check, since it starts node and a
/// YouTube link checks its tools on the interface thread.
pub fn node_stands_in() -> bool {
    static USABLE: OnceLock<bool> = OnceLock::new();
    *USABLE.get_or_init(|| node().is_some())
}

fn usable_node(output: &str) -> Option<&str> {
    let version = output.trim().strip_prefix('v')?;
    let major: u32 = version.split('.').next()?.parse().ok()?;
    (major >= NODE_MIN_MAJOR).then_some(version)
}

#[derive(Debug)]
pub struct Inspection {
    pub tool: Tool,
    pub path: Option<PathBuf>,
    pub state: State,
}

#[derive(Debug)]
pub enum State {
    Installed(String),
    Missing,
    Broken(String),
}

impl Inspection {
    /// What to say at startup. A missing tool waits until a YouTube link needs it, since
    /// everything else plays without it.
    pub fn notice(&self, today: Date) -> Option<String> {
        let tool = self.tool;
        let detail = match &self.state {
            State::Missing => return None,
            State::Broken(error) => format!("{} is broken: {error}.", tool.name()),
            State::Installed(version) => {
                tool.stale_days(version, today)?;
                format!("{} is out of date and may fail.", tool.name())
            }
        };
        Some(format!("{detail} It {}. Run chill doctor for details.", tool.purpose()))
    }
}

fn version_output(command: &mut Command, timeout: Duration) -> Result<String> {
    const LIMIT: u64 = 8192;
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(stdout.try_clone()?)
        .stderr(stderr.try_clone()?)
        .spawn()
        .context("could not run version check")?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(error) => break Err(anyhow::Error::from(error)),
        }
        if started.elapsed() >= timeout {
            break Err(anyhow::anyhow!(
                "version check timed out after {} seconds",
                timeout.as_secs_f32()
            ));
        }
        if stdout.metadata().is_ok_and(|m| m.len() > LIMIT) || stderr.metadata().is_ok_and(|m| m.len() > LIMIT) {
            break Err(anyhow::anyhow!("version output exceeded {LIMIT} bytes"));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if status.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let read = |file: &mut std::fs::File| -> Result<String> {
        file.rewind()?;
        let mut bytes = Vec::new();
        file.take(LIMIT).read_to_end(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).trim().to_owned())
    };
    let errors = read(&mut stderr)?;
    let status = status.with_context(|| format!("stderr: {errors}"))?;
    if !status.success() {
        bail!("version check failed ({status}): {errors}");
    }
    read(&mut stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_require_real_output() {
        assert_eq!(
            Tool::Ffmpeg.parse_version("ffmpeg version 7.1 Copyright").unwrap(),
            "7.1"
        );
        assert_eq!(Tool::Deno.parse_version("deno 2.5.4 (stable)\nv8 14").unwrap(), "2.5.4");
        assert_eq!(Tool::YtDlp.parse_version("2026.10.01").unwrap(), "2026.10.01");
        for tool in Tool::ALL {
            assert!(tool.parse_version("").is_err());
            assert!(tool.parse_version("installed").is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn checks_report_failed_processes_and_stop_hung_processes() {
        let error = version_output(
            Command::new("sh").args(["-c", "echo loader-failed >&2; exit 7"]),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(error.to_string().contains("loader-failed"));
        let started = Instant::now();
        let error = version_output(
            Command::new("sh").args(["-c", "exec sleep 10"]),
            Duration::from_millis(50),
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn startup_notices_cover_broken_and_stale_tools_and_leave_missing_ones_to_youtube() {
        let today = Date::new(2026, 10, 19).unwrap();
        let stale = Inspection {
            tool: Tool::YtDlp,
            path: None,
            state: State::Installed("2026.06.01".into()),
        };
        assert_eq!(stale.notice(today), stale.notice(Date::new(2026, 10, 20).unwrap()));
        assert_eq!(
            stale.notice(today).unwrap(),
            "yt-dlp is out of date and may fail. It resolves YouTube links. Run chill doctor for details."
        );
        for tool in Tool::ALL {
            let mut inspection = Inspection {
                tool,
                path: None,
                state: State::Missing,
            };
            assert_eq!(inspection.notice(today), None);
            inspection.state = State::Broken("loader failed".into());
            assert_eq!(
                inspection.notice(today).unwrap(),
                format!(
                    "{} is broken: loader failed. It {}. Run chill doctor for details.",
                    tool.name(),
                    tool.purpose()
                )
            );
        }
    }

    #[test]
    fn youtube_names_every_missing_tool_in_one_install_command() {
        let brew = || Some("brew install ffmpeg deno".to_owned());
        assert_eq!(youtube_hint(&[], brew(), true), None);
        assert_eq!(
            youtube_hint(&[Tool::Ffmpeg, Tool::Deno], brew(), true).unwrap(),
            "YouTube links need ffmpeg and deno, which chill can't find. Install them with `brew install ffmpeg deno`."
        );
        assert!(
            youtube_hint(&[Tool::Ffmpeg, Tool::Deno], brew(), false)
                .unwrap()
                .contains("Install Homebrew from https://brew.sh, then install them with `brew install ffmpeg deno`.")
        );
        let winget = Some("winget install Gyan.FFmpeg".to_owned());
        assert!(
            youtube_hint(&[Tool::Ffmpeg], winget, false)
                .unwrap()
                .ends_with("then start chill from a new terminal.")
        );
        let elsewhere = youtube_hint(&Tool::ALL, None, false).unwrap();
        assert!(
            elsewhere.contains("ffmpeg, yt-dlp, and deno")
                && elsewhere.ends_with("Run chill doctor to see how to install them.")
        );
    }

    #[test]
    fn node_22_or_newer_stands_in_for_deno() {
        assert_eq!(usable_node("v22.11.0\n"), Some("22.11.0"));
        assert_eq!(usable_node("v24.1.0"), Some("24.1.0"));
        assert_eq!(usable_node("v20.18.0"), None);
        assert_eq!(usable_node("node: command failed"), None);
    }

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
