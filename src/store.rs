use std::path::Path;

use anyhow::Result;
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::catalog::{Levels, Mix};
use crate::model::{Item, Saved, Scene, Session};

pub struct Store {
    db: Connection,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS saved (id TEXT PRIMARY KEY, body TEXT NOT NULL, added_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS likes (key TEXT PRIMARY KEY, item TEXT NOT NULL, added_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mixes (name TEXT PRIMARY KEY, levels TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenes (name TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS focus_blocks (
    id INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL,
    focused_sec INTEGER NOT NULL,
    planned_sec INTEGER NOT NULL,
    completed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS focus_blocks_started_at ON focus_blocks (started_at);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

/// Recorded in `user_version`, so a later release knows which of its migrations a library needs.
const SCHEMA_VERSION: i64 = 1;

/// Focused minutes per local calendar day, oldest first, ending today.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusDays {
    pub days: Vec<(Date, u32)>,
}

impl FocusDays {
    pub fn today(&self) -> u32 {
        self.days.last().map_or(0, |(_, minutes)| *minutes)
    }
}

fn json<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}

fn now() -> i64 {
    Timestamp::now().as_second()
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.execute_batch(SCHEMA)?;
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 0 {
            db.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Store { db })
    }

    fn all<T: DeserializeOwned>(&self, sql: &str) -> Result<Vec<T>> {
        let mut statement = self.db.prepare(sql)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut values = Vec::new();
        for row in rows {
            if let Ok(value) = serde_json::from_str(&row?) {
                values.push(value);
            }
        }
        Ok(values)
    }

    pub fn saved(&self) -> Result<Vec<Saved>> {
        self.all("SELECT body FROM saved ORDER BY added_at DESC")
    }

    pub fn save(&self, saved: &Saved) -> Result<()> {
        self.db.execute(
            "INSERT INTO saved (id, body, added_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (id) DO UPDATE SET body = excluded.body",
            params![saved.id, json(saved)?, now()],
        )?;
        Ok(())
    }

    pub fn forget(&self, id: &str) -> Result<()> {
        self.db.execute("DELETE FROM saved WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn likes(&self) -> Result<Vec<Item>> {
        self.all("SELECT item FROM likes ORDER BY added_at DESC")
    }

    pub fn set_liked(&self, item: &Item, liked: bool) -> Result<()> {
        if liked {
            self.db.execute(
                "INSERT OR REPLACE INTO likes (key, item, added_at) VALUES (?1, ?2, ?3)",
                params![item.key, json(item)?, now()],
            )?;
        } else {
            self.db.execute("DELETE FROM likes WHERE key = ?1", [&item.key])?;
        }
        Ok(())
    }

    pub fn mixes(&self) -> Result<Vec<Mix>> {
        let mut statement = self.db.prepare("SELECT name, levels FROM mixes ORDER BY name")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut mixes = Vec::new();
        for row in rows {
            let (name, levels) = row?;
            if let Ok(levels) = serde_json::from_str::<Levels>(&levels) {
                mixes.push(Mix {
                    id: format!("saved:{name}"),
                    name,
                    levels,
                });
            }
        }
        Ok(mixes)
    }

    pub fn save_mix(&self, name: &str, levels: &Levels) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO mixes (name, levels) VALUES (?1, ?2)",
            params![name, json(levels)?],
        )?;
        Ok(())
    }

    pub fn delete_mix(&self, name: &str) -> Result<()> {
        self.db.execute("DELETE FROM mixes WHERE name = ?1", [name])?;
        Ok(())
    }

    pub fn scenes(&self) -> Result<Vec<Scene>> {
        self.all("SELECT body FROM scenes ORDER BY name")
    }

    pub fn save_scene(&self, scene: &Scene) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO scenes (name, body) VALUES (?1, ?2)",
            params![scene.name, json(scene)?],
        )?;
        Ok(())
    }

    pub fn delete_scene(&self, name: &str) -> Result<()> {
        self.db.execute("DELETE FROM scenes WHERE name = ?1", [name])?;
        Ok(())
    }

    pub fn session(&self) -> Session {
        self.db
            .query_row("SELECT value FROM kv WHERE key = 'session'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .ok()
            .flatten()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO kv (key, value) VALUES ('session', ?1)",
            [json(session)?],
        )?;
        Ok(())
    }

    pub fn begin_focus_block(&self, started_at: Timestamp, planned_sec: u64) -> Result<i64> {
        self.db.execute(
            "INSERT INTO focus_blocks (started_at, focused_sec, planned_sec, completed) VALUES (?1, 0, ?2, 0)",
            params![started_at.as_second(), planned_sec as i64],
        )?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn update_focus_block(&self, id: i64, focused_sec: u64, completed: bool) -> Result<()> {
        self.db.execute(
            "UPDATE focus_blocks SET focused_sec = ?2, completed = ?3 WHERE id = ?1",
            params![id, focused_sec as i64, completed],
        )?;
        Ok(())
    }

    /// A block that runs past midnight is split between the two days it touched.
    pub fn focus_days(&self, count: i64, zone: &TimeZone) -> Result<FocusDays> {
        let today = Timestamp::now().to_zoned(zone.clone()).date();
        let first = today.checked_sub((count - 1).days())?;
        let dates: Vec<Date> = (0..count)
            .filter_map(|offset| first.checked_add(offset.days()).ok())
            .collect();
        let starts = dates
            .iter()
            .map(|date| Ok(date.to_zoned(zone.clone())?.timestamp().as_second()))
            .collect::<Result<Vec<i64>>>()?;
        let since = starts.first().copied().unwrap_or(0);
        let mut statement = self
            .db
            .prepare("SELECT started_at, focused_sec FROM focus_blocks WHERE started_at + focused_sec > ?1")?;
        let rows = statement.query_map([since], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
        let mut seconds = vec![0i64; dates.len()];
        for row in rows {
            let (started_at, focused_sec) = row?;
            let ended_at = started_at + focused_sec;
            for (index, total) in seconds.iter_mut().enumerate() {
                let day_end = starts.get(index + 1).copied().unwrap_or(i64::MAX);
                *total += (ended_at.min(day_end) - started_at.max(starts[index])).max(0);
            }
        }
        let days = dates
            .into_iter()
            .zip(seconds)
            .map(|(date, seconds)| (date, u32::try_from(seconds / 60).unwrap_or(u32::MAX)))
            .collect();
        Ok(FocusDays { days })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshing_saved_metadata_preserves_the_library_order() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let saved = |id: &str, title: &str| Saved {
            id: id.into(),
            url: format!("https://youtube.com/playlist?list={id}"),
            title: title.into(),
            channel: String::new(),
            items: Vec::new(),
        };
        store.save(&saved("first", "First")).unwrap();
        store.save(&saved("second", "Second")).unwrap();
        store
            .db
            .execute("UPDATE saved SET added_at = CASE id WHEN 'first' THEN 1 ELSE 2 END", [])
            .unwrap();

        store.save(&saved("first", "Refreshed first")).unwrap();

        let refreshed = store.saved().unwrap();
        assert_eq!(
            refreshed.iter().map(|saved| saved.id.as_str()).collect::<Vec<_>>(),
            ["second", "first"]
        );
        assert_eq!(refreshed[1].title, "Refreshed first");
    }

    #[test]
    fn focus_minutes_land_on_their_local_day() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let zone = TimeZone::get("Europe/Vienna").unwrap();
        let midnight = Timestamp::now()
            .to_zoned(zone.clone())
            .start_of_day()
            .unwrap()
            .timestamp();
        let (today, yesterday) = (midnight + 1.hour(), midnight - 12.hours());

        let block = store.begin_focus_block(today, 1500).unwrap();
        store.update_focus_block(block, 600, false).unwrap();
        let earlier = store.begin_focus_block(yesterday, 1500).unwrap();
        store.update_focus_block(earlier, 1500, true).unwrap();

        let days = store.focus_days(7, &zone).unwrap();
        assert_eq!(days.days.len(), 7);
        assert_eq!(days.today(), 10);
        assert_eq!(days.days[5].1, 25);
    }

    #[test]
    fn a_block_across_midnight_is_split_between_the_days() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let zone = TimeZone::get("Europe/Vienna").unwrap();
        let midnight = Timestamp::now()
            .to_zoned(zone.clone())
            .start_of_day()
            .unwrap()
            .timestamp();
        let block = store.begin_focus_block(midnight - 5.minutes(), 1500).unwrap();
        store.update_focus_block(block, 1500, true).unwrap();

        let days = store.focus_days(2, &zone).unwrap();
        assert_eq!((days.days[0].1, days.today()), (5, 20));
    }
}
