use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use etcetera::BaseStrategy;
use serde::Deserialize;

use crate::timer::PomodoroSettings;
use crate::ui::picture::{Look, Picture, Season};

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub catalog_url: String,
    /// Catalogs added on top of `catalog_url`, whose tracks join the same Tracks tab.
    pub catalogs: Vec<String>,
    pub sync_url: String,
    pub reduce_motion: bool,
    pub picture: Picture,
    pub look: Look,
    pub season: Season,
    pub chime: bool,
    pub notifications: bool,
    pub pomodoro: PomodoroSettings,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            catalog_url: catalog_schema::DEFAULT_URL.into(),
            catalogs: Vec::new(),
            sync_url: crate::sync::DEFAULT_URL.into(),
            reduce_motion: false,
            picture: Picture::default(),
            look: Look::default(),
            season: Season::default(),
            chime: true,
            notifications: true,
            pomodoro: PomodoroSettings::default(),
        }
    }
}

/// `path` with the home folder shown as `~`.
pub fn display_path(path: &Path) -> String {
    let home = etcetera::home_dir().ok();
    match home.as_deref().and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) => format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display()),
        None => path.display().to_string(),
    }
}

pub struct Paths {
    pub config_file: PathBuf,
    pub database: PathBuf,
    pub cache: PathBuf,
}

impl Paths {
    pub fn resolve() -> Result<Paths> {
        let base = etcetera::choose_base_strategy().context("could not find the home directory")?;
        let data = base.data_dir().join("chill");
        let cache = base.cache_dir().join("chill");
        std::fs::create_dir_all(&data).with_context(|| format!("creating {}", data.display()))?;
        std::fs::create_dir_all(&cache).with_context(|| format!("creating {}", cache.display()))?;
        Ok(Paths {
            config_file: base.config_dir().join("chill").join("config.toml"),
            database: data.join("chill.db"),
            cache,
        })
    }
}

pub fn load(path: &Path) -> Result<Config> {
    match std::fs::read_to_string(path) {
        Ok(text) => toml::from_str(&text).with_context(|| format!("reading {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

/// Writes the settings the app can change into `config.toml`, keeping everything else in the
/// file (comments, catalog_url) as the user left it.
pub fn save(path: &Path, config: &Config) -> Result<()> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error).with_context(|| format!("reading {}", path.display())),
    };
    let mut document: toml_edit::DocumentMut = text.parse().with_context(|| format!("reading {}", path.display()))?;
    set(&mut document["reduce_motion"], config.reduce_motion);
    set(&mut document["picture"], config.picture.id());
    set(&mut document["look"], config.look.id());
    // Left out until someone picks a season, so an older chill that doesn't know it still starts.
    if config.season == Season::Auto {
        document.remove("season");
    } else {
        set(&mut document["season"], config.season.id());
    }
    set(&mut document["chime"], config.chime);
    set(&mut document["notifications"], config.notifications);
    if config.catalogs.is_empty() {
        document.remove("catalogs");
    } else {
        set(&mut document["catalogs"], toml_edit::Array::from_iter(&config.catalogs));
    }
    let pomodoro = &config.pomodoro;
    let table = document["pomodoro"].or_insert(toml_edit::table());
    set(&mut table["focus_minutes"], i64::from(pomodoro.focus_minutes));
    set(&mut table["break_minutes"], i64::from(pomodoro.break_minutes));
    set(&mut table["long_break_minutes"], i64::from(pomodoro.long_break_minutes));
    set(&mut table["long_break_every"], i64::from(pomodoro.long_break_every));
    set(&mut table["auto_start_breaks"], pomodoro.auto_start_breaks);
    set(&mut table["auto_start_focus"], pomodoro.auto_start_focus);
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).with_context(|| format!("creating {}", folder.display()))?;
    }
    // Written beside the file and renamed over it, so a crash mid-save can't leave a half-written
    // config that stops the next start. A config linked from elsewhere, such as a dotfiles
    // repository, is replaced where the link points, so the link survives.
    let target = match std::fs::canonicalize(path) {
        Ok(target) => target,
        Err(error) => match std::fs::symlink_metadata(path) {
            Err(metadata_error)
                if metadata_error.kind() == std::io::ErrorKind::NotFound
                    && error.kind() == std::io::ErrorKind::NotFound =>
            {
                path.to_path_buf()
            }
            _ => {
                return Err(error).with_context(|| {
                    format!(
                        "resolving {}; ensure any symlink destination exists before saving",
                        path.display()
                    )
                });
            }
        },
    };
    let permissions = match std::fs::metadata(&target) {
        Ok(metadata) => Some(metadata.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).with_context(|| format!("reading permissions of {}", target.display())),
    };
    tempfile::NamedTempFile::new_in(target.parent().unwrap_or_else(|| Path::new(".")))
        .and_then(|mut partial| {
            if let Some(permissions) = permissions {
                partial.as_file().set_permissions(permissions)?;
            }
            partial.write_all(document.to_string().as_bytes())?;
            partial.persist(&target).map(|_| ()).map_err(|error| error.error)
        })
        .with_context(|| format!("writing {}", path.display()))
}

/// Replaces a value but keeps the spacing and trailing comment around it.
fn set(item: &mut toml_edit::Item, value: impl Into<toml_edit::Value>) {
    let mut value = value.into();
    if let Some(old) = item.as_value() {
        *value.decor_mut() = old.decor().clone();
    }
    *item = toml_edit::Item::Value(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_keeps_the_users_comments_and_other_keys() {
        let path = std::env::temp_dir().join(format!("chill-config-{}.toml", std::process::id()));
        std::fs::write(
            &path,
            "# mine\ncatalog_url = \"https://example.com/catalog.json\"\nchime = true # the bell\n",
        )
        .unwrap();
        let mut config = load(&path).unwrap();
        config.chime = false;
        config.picture = Picture::FujiDawn;
        config.pomodoro.focus_minutes = 40;
        config.catalogs = vec!["https://friends.example/catalog.json".into()];
        save(&path, &config).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        let reloaded = load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(text.starts_with("# mine"));
        assert!(text.contains("chime = false # the bell"));
        assert_eq!(reloaded.catalog_url, "https://example.com/catalog.json");
        assert_eq!(reloaded.catalogs, config.catalogs);
        assert_eq!((reloaded.chime, reloaded.pomodoro.focus_minutes), (false, 40));
        assert_eq!(reloaded.picture, Picture::FujiDawn);
    }

    #[cfg(unix)]
    #[test]
    fn saving_keeps_restrictive_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("config.toml");
        std::fs::write(&path, "chime = true\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        save(&path, &Config::default()).unwrap();

        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

        let new_path = folder.path().join("new-config.toml");
        save(&new_path, &Config::default()).unwrap();
        assert_eq!(
            std::fs::metadata(&new_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn saving_through_a_dangling_link_chain_keeps_the_links() {
        let folder = tempfile::tempdir().unwrap();
        let nested = folder.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        let linked = nested.join("config.toml");
        let intermediate = folder.path().join("intermediate.toml");
        std::os::unix::fs::symlink("../intermediate.toml", &linked).unwrap();
        std::os::unix::fs::symlink("missing.toml", &intermediate).unwrap();

        let error = save(&linked, &Config::default()).unwrap_err();

        assert!(error.to_string().contains("ensure any symlink destination exists"));
        assert_eq!(std::fs::read_link(&linked).unwrap(), Path::new("../intermediate.toml"));
        assert_eq!(std::fs::read_link(&intermediate).unwrap(), Path::new("missing.toml"));
        assert!(!folder.path().join("missing.toml").exists());
    }

    #[cfg(unix)]
    #[test]
    fn saving_through_a_linked_config_keeps_the_link() {
        let folder = tempfile::tempdir().unwrap();
        let dotfile = folder.path().join("dotfiles.toml");
        let linked = folder.path().join("config.toml");
        std::fs::write(&dotfile, "chime = true\n").unwrap();
        std::os::unix::fs::symlink(&dotfile, &linked).unwrap();

        save(
            &linked,
            &Config {
                chime: false,
                ..Config::default()
            },
        )
        .unwrap();

        assert!(std::fs::symlink_metadata(&linked).unwrap().file_type().is_symlink());
        assert!(std::fs::read_to_string(&dotfile).unwrap().contains("chime = false"));
    }
}
