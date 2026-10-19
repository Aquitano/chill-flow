use std::io;
use std::process::{Command, Stdio};

pub(super) fn command() -> Command {
    let mut command = Command::new("ffmpeg");
    command
        .args(["-nostdin", "-hide_banner", "-loglevel", "error"])
        .stdin(Stdio::null());
    command
}

pub(super) fn spawn_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "ffmpeg is not installed; install it with `brew install ffmpeg` (macOS) or `winget install ffmpeg` (Windows)".to_owned()
    } else {
        format!("could not start ffmpeg: {error}")
    }
}

pub(super) fn last_line(stderr: &str) -> Option<&str> {
    stderr.lines().map(str::trim).rfind(|line| !line.is_empty())
}
