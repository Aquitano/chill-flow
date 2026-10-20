use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, ensure};

const QUIET: [&str; 4] = ["-y", "-hide_banner", "-loglevel", "error"];
const MP3: [&str; 5] = ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"];

pub fn track(input: &Path, output: &Path) -> Result<()> {
    run(Command::new("ffmpeg")
        .args(QUIET)
        .arg("-i")
        .arg(input)
        .args(["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"])
        .args(MP3)
        .arg(output))
}

/// Ambience sits under the music, so its loops are quieter at -16 LUFS.
pub fn ambient_loop(input: &Path, output: &Path, start: f64, length: f64) -> Result<()> {
    run(Command::new("ffmpeg")
        .args(QUIET)
        .args(["-ss", &start.to_string()])
        .arg("-i")
        .arg(input)
        .args(["-t", &length.to_string(), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
        .args(MP3)
        .arg(output))
}

pub fn duration_sec(path: &Path) -> Result<u32> {
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"])
        .arg(path)
        .output()
        .context("running ffprobe (is ffmpeg installed?)")?;
    ensure!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8_lossy(&output.stdout);
    let seconds: f64 = text
        .trim()
        .parse()
        .with_context(|| format!("ffprobe printed {text:?} as the duration"))?;
    Ok(seconds.round() as u32)
}

fn run(command: &mut Command) -> Result<()> {
    let status = command.status().context("running ffmpeg (is it installed?)")?;
    ensure!(status.success(), "ffmpeg exited with {status}");
    Ok(())
}
