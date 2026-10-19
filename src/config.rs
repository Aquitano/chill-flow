use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use etcetera::BaseStrategy;
use serde::Deserialize;

use crate::timer::PomodoroSettings;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub catalog_url: String,
    pub reduce_motion: bool,
    pub chime: bool,
    pub notifications: bool,
    pub pomodoro: PomodoroSettings,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            catalog_url: "https://chill-data.aquitano.me/catalog.json".into(),
            reduce_motion: false,
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
    set(&mut document["chime"], config.chime);
    set(&mut document["notifications"], config.notifications);
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
    std::fs::write(path, document.to_string()).with_context(|| format!("writing {}", path.display()))
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
        config.pomodoro.focus_minutes = 40;
        save(&path, &config).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        let reloaded = load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(text.starts_with("# mine"));
        assert!(text.contains("chime = false # the bell"));
        assert_eq!(reloaded.catalog_url, "https://example.com/catalog.json");
        assert_eq!((reloaded.chime, reloaded.pomodoro.focus_minutes), (false, 40));
    }
}
