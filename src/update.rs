use std::path::Path;

use anyhow::{Context, Result, bail};
use axoupdater::{AxoUpdater, ReleaseSource, ReleaseSourceType, Version};

const INSTALL_HELP: &str = "Use the official installer at https://github.com/Aquitano/chill-flow#install. For a Cargo installation, run cargo install --git https://github.com/Aquitano/chill-flow --force. For other package managers, update through that package manager.";

pub fn run() -> Result<()> {
    check_platform(std::env::consts::OS, std::env::consts::ARCH)?;
    let mut updater = AxoUpdater::new_for("chill");
    updater
        .load_receipt()
        .with_context(|| format!("No usable installer receipt for chill. {INSTALL_HELP}"))?;
    let executable = std::env::current_exe()?.canonicalize()?;
    check_installation(
        updater.source.as_ref(),
        updater.check_receipt_is_for_this_executable()?,
        &executable,
    )?;
    updater.set_current_version(Version::parse(env!("CARGO_PKG_VERSION"))?)?;
    println!("Checking for a newer chill release…");
    match updater.run_sync().context("Could not update chill. Retry chill update, or rerun the official installer from https://github.com/Aquitano/chill-flow#install")? {
        Some(result) => println!("Updated chill to {}. Start chill again to use it.", result.new_version),
        None => println!("chill {} is up to date.", env!("CARGO_PKG_VERSION")),
    }
    Ok(())
}

fn check_platform(os: &str, arch: &str) -> Result<()> {
    if !matches!((os, arch), ("macos", "aarch64") | ("windows", "x86_64")) {
        bail!("chill update supports official Apple Silicon macOS and x64 Windows installations. {INSTALL_HELP}");
    }
    Ok(())
}

fn check_installation(source: Option<&ReleaseSource>, receipt_matches: bool, executable: &Path) -> Result<()> {
    let official = source.is_some_and(|source| {
        source.release_type == ReleaseSourceType::GitHub
            && source.owner == "Aquitano"
            && source.name == "chill-flow"
            && source.app_name == "chill"
    });
    let filename = executable.file_name().and_then(|name| name.to_str());
    if !official || !receipt_matches || !matches!(filename, Some("chill" | "chill.exe")) {
        bail!("This executable does not match an official chill installation receipt. {INSTALL_HELP}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_official_distribution_platforms_are_eligible() {
        assert!(check_platform("macos", "aarch64").is_ok());
        assert!(check_platform("windows", "x86_64").is_ok());
        assert!(check_platform("macos", "x86_64").is_err());
        assert!(check_platform("linux", "x86_64").is_err());
        assert!(check_platform("windows", "aarch64").is_err());
    }

    #[test]
    fn copied_binaries_missing_receipts_and_other_sources_are_rejected_before_updating() {
        let source = ReleaseSource {
            release_type: ReleaseSourceType::GitHub,
            owner: "Aquitano".into(),
            name: "chill-flow".into(),
            app_name: "chill".into(),
        };
        assert!(check_installation(Some(&source), true, Path::new("chill")).is_ok());
        assert!(check_installation(Some(&source), true, Path::new("chill.exe")).is_ok());
        assert!(check_installation(Some(&source), false, Path::new("chill")).is_err());
        assert!(check_installation(None, true, Path::new("chill")).is_err());
        assert!(check_installation(Some(&source), true, Path::new("chill-copy")).is_err());
        let fork = ReleaseSource {
            owner: "someone-else".into(),
            ..source
        };
        assert!(check_installation(Some(&fork), true, Path::new("chill")).is_err());
    }
}
