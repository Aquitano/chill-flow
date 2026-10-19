use std::path::PathBuf;

use anyhow::{Context, Result};
use etcetera::BaseStrategy;
use serde::Deserialize;

use crate::timer::PomodoroSettings;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub catalog_url: String,
    pub reduce_motion: bool,
    pub pomodoro: PomodoroSettings,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            catalog_url: "https://chill-data.aquitano.me/catalog.json".into(),
            reduce_motion: false,
            pomodoro: PomodoroSettings::default(),
        }
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

pub fn load(path: &PathBuf) -> Result<Config> {
    match std::fs::read_to_string(path) {
        Ok(text) => toml::from_str(&text).with_context(|| format!("reading {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}
