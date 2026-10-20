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

/// Ambience sits under the music, so its loops are quieter at -16 LUFS. ffmpeg cuts a window that
/// runs past the end short without complaint, so the result is measured against what was asked.
pub fn ambient_loop(input: &Path, output: &Path, start: f64, length: f64) -> Result<()> {
    run(Command::new("ffmpeg")
        .args(QUIET)
        .args(["-ss", &start.to_string()])
        .arg("-i")
        .arg(input)
        .args(["-t", &length.to_string(), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
        .args(MP3)
        .arg(output))?;
    let cut = duration(output).unwrap_or(0.0);
    ensure!(
        cut >= length - 0.5,
        "{} has only {cut:.1} s of audio after --start {start}, and the loop needs --length {length}",
        input.display()
    );
    Ok(())
}

pub fn duration_sec(path: &Path) -> Result<u32> {
    Ok(duration(path)?.round() as u32)
}

fn duration(path: &Path) -> Result<f64> {
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
    text.trim()
        .parse()
        .with_context(|| format!("ffprobe printed {text:?} as the duration"))
}

fn run(command: &mut Command) -> Result<()> {
    let status = command.status().context("running ffmpeg (is it installed?)")?;
    ensure!(status.success(), "ffmpeg exited with {status}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_loop_window_past_the_end_of_the_recording_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        let recording = folder.path().join("rain.wav");
        run(Command::new("ffmpeg")
            .args(QUIET)
            .args(["-f", "lavfi", "-i", "anoisesrc=d=4"])
            .arg(&recording))
        .unwrap();
        let output = folder.path().join("loop.mp3");

        assert!(ambient_loop(&recording, &output, 0.0, 3.0).is_ok());
        assert!(ambient_loop(&recording, &output, 5.0, 3.0).is_err());
        assert!(ambient_loop(&recording, &output, 2.0, 3.0).is_err());
    }
}
