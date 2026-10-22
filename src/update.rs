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
        updater.install_prefix_root()?.as_std_path(),
        &executable,
    )?;
    let current_version = Version::parse(env!("CARGO_PKG_VERSION"))?;
    updater.set_current_version(current_version.clone())?;
    println!("Checking for a newer chill release…");
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let result = runtime.block_on(async {
        let latest = updater.query_new_version().await?;
        if latest.is_none_or(|latest| latest <= &current_version) {
            return Ok(None);
        }
        // The exact path is already checked. axoupdater's root heuristic rejects roots ending in bin.
        updater.always_update(true).run().await
    }).context("Could not update chill. Retry chill update, or rerun the official installer from https://github.com/Aquitano/chill-flow#install")?;
    match result {
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

fn check_installation(source: Option<&ReleaseSource>, install_root: &Path, executable: &Path) -> Result<()> {
    let official = source.is_some_and(|source| {
        source.release_type == ReleaseSourceType::GitHub
            && source.owner == "Aquitano"
            && source.name == "chill-flow"
            && source.app_name == "chill"
    });
    // cargo-dist's CARGO_HOME layout uses bin even with a custom install directory.
    let exact_path = install_root
        .join("bin")
        .join(format!("chill{}", std::env::consts::EXE_SUFFIX))
        .canonicalize()
        .is_ok_and(|installed| installed == executable);
    if !official || !exact_path {
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
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir(root.join("bin")).unwrap();
        let executable = root.join("bin").join(format!("chill{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&executable, "official installation").unwrap();
        let executable = executable.canonicalize().unwrap();
        assert!(check_installation(Some(&source), root, &executable).is_ok());
        assert!(check_installation(None, root, &executable).is_err());
        let fork = ReleaseSource {
            owner: "someone-else".into(),
            ..source
        };
        assert!(check_installation(Some(&fork), root, &executable).is_err());
    }

    #[test]
    fn exact_binary_paths_are_required_for_cargo_home_and_custom_prefixes() {
        let source = ReleaseSource {
            release_type: ReleaseSourceType::GitHub,
            owner: "Aquitano".into(),
            name: "chill-flow".into(),
            app_name: "chill".into(),
        };
        let directory = tempfile::tempdir().unwrap();
        for prefix in [".cargo", "custom install", "custom/bin"] {
            let root = directory.path().join(prefix);
            std::fs::create_dir_all(root.join("bin")).unwrap();
            let name = format!("chill{}", std::env::consts::EXE_SUFFIX);
            let copy = root.join(&name);
            std::fs::write(&copy, "copy").unwrap();
            let copy = copy.canonicalize().unwrap();
            assert!(check_installation(Some(&source), &root, &copy).is_err());
            let installed = root.join("bin").join(name);
            std::fs::write(&installed, "installed").unwrap();
            let installed = installed.canonicalize().unwrap();
            assert!(check_installation(Some(&source), &root, &installed).is_ok());
            assert!(check_installation(Some(&source), &root, &copy).is_err());
            let alternate_name = if std::env::consts::EXE_SUFFIX.is_empty() {
                "chill.exe"
            } else {
                "chill"
            };
            let alternate = root.join("bin").join(alternate_name);
            std::fs::write(&alternate, "renamed copy").unwrap();
            assert!(check_installation(Some(&source), &root, &alternate.canonicalize().unwrap()).is_err());
        }
    }
}
