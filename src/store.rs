use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Result, bail};
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::catalog::{Levels, Mix};
use crate::model::{Item, Saved, Scene, Session};
use crate::sync::{Kind, Record};

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
CREATE TABLE IF NOT EXISTS sync_state (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL,
    dirty INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
);
";

/// Focus blocks get an id that is the same on every machine, so a synced block is updated in
/// place instead of counted twice.
const MIGRATE_TO_2: &str = "
ALTER TABLE focus_blocks ADD COLUMN uid TEXT;
UPDATE focus_blocks SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX focus_blocks_uid ON focus_blocks (uid);
";

/// Recorded in `user_version`, so a later release knows which of its migrations a library needs.
const SCHEMA_VERSION: i64 = 2;

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

fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LikeBody {
    item: Item,
    added_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedBody {
    saved: Saved,
    added_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusBody {
    started_at: i64,
    focused_sec: i64,
    planned_sec: i64,
    completed: bool,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            bail!("a newer version of chill wrote this library, so update chill to open it");
        }
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.execute_batch(SCHEMA)?;
        if version < 2 {
            db.execute_batch(&format!(
                "BEGIN; {MIGRATE_TO_2} PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;"
            ))?;
        }
        Ok(Store { db })
    }

    /// Marks an item as changed here, for the next sync to upload. The time only moves forward,
    /// so a change made within the same millisecond as the last still wins.
    fn touch(&self, kind: Kind, id: &str, deleted: bool) -> Result<()> {
        self.db.execute(
            "INSERT INTO sync_state (kind, id, updated_at, deleted, dirty) VALUES (?1, ?2, ?3, ?4, 1)
             ON CONFLICT (kind, id) DO UPDATE SET
                 updated_at = max(excluded.updated_at, sync_state.updated_at + 1),
                 deleted = excluded.deleted,
                 dirty = 1",
            params![kind.as_str(), id, now_ms(), deleted],
        )?;
        Ok(())
    }

    /// Records a synced setting's new value together with the time it changed, so an upload
    /// always sends the value that goes with its time.
    pub fn set_synced_setting(&self, name: &str, value: &Value) -> Result<()> {
        let transaction = self.db.unchecked_transaction()?;
        set_setting_value(&transaction, name, value)?;
        self.touch(Kind::Setting, name, false)?;
        transaction.commit()?;
        Ok(())
    }

    /// Settings whose value in `settings` differs from the one last synced, such as after an edit
    /// to config.toml by hand.
    pub fn changed_settings<'a>(&self, settings: &'a BTreeMap<String, Value>) -> Vec<(&'a String, &'a Value)> {
        settings
            .iter()
            .filter(|(name, value)| self.setting_value(name).as_ref() != Some(*value))
            .collect()
    }

    fn setting_value(&self, name: &str) -> Option<Value> {
        self.kv(&format!("setting:{name}"))
            .and_then(|text| serde_json::from_str(&text).ok())
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
        self.touch(Kind::Saved, &saved.id, false)
    }

    pub fn forget(&self, id: &str) -> Result<()> {
        self.db.execute("DELETE FROM saved WHERE id = ?1", [id])?;
        self.touch(Kind::Saved, id, true)
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
        self.touch(Kind::Like, &item.key, !liked)
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
        self.touch(Kind::Mix, name, false)
    }

    pub fn delete_mix(&self, name: &str) -> Result<()> {
        self.db.execute("DELETE FROM mixes WHERE name = ?1", [name])?;
        self.touch(Kind::Mix, name, true)
    }

    pub fn scenes(&self) -> Result<Vec<Scene>> {
        self.all("SELECT body FROM scenes ORDER BY name")
    }

    pub fn save_scene(&self, scene: &Scene) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO scenes (name, body) VALUES (?1, ?2)",
            params![scene.name, json(scene)?],
        )?;
        self.touch(Kind::Scene, &scene.name, false)
    }

    pub fn delete_scene(&self, name: &str) -> Result<()> {
        self.db.execute("DELETE FROM scenes WHERE name = ?1", [name])?;
        self.touch(Kind::Scene, name, true)
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
        let (id, uid): (i64, String) = self.db.query_row(
            "INSERT INTO focus_blocks (uid, started_at, focused_sec, planned_sec, completed)
             VALUES (lower(hex(randomblob(16))), ?1, 0, ?2, 0) RETURNING id, uid",
            params![started_at.as_second(), planned_sec as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        self.touch(Kind::Focus, &uid, false)?;
        Ok(id)
    }

    pub fn update_focus_block(&self, id: i64, focused_sec: u64, completed: bool) -> Result<()> {
        let uid: Option<String> = self
            .db
            .query_row(
                "UPDATE focus_blocks SET focused_sec = ?2, completed = ?3 WHERE id = ?1 RETURNING uid",
                params![id, focused_sec as i64, completed],
                |row| row.get(0),
            )
            .optional()?;
        match uid {
            Some(uid) => self.touch(Kind::Focus, &uid, false),
            None => Ok(()),
        }
    }

    fn kv(&self, key: &str) -> Option<String> {
        self.db
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |row| row.get(0))
            .optional()
            .ok()
            .flatten()
    }

    fn set_kv(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(value) => self
                .db
                .execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)", [key, value])?,
            None => self.db.execute("DELETE FROM kv WHERE key = ?1", [key])?,
        };
        Ok(())
    }

    pub fn sync_token(&self) -> Option<String> {
        self.kv("sync_token")
    }

    /// Joins the sync space behind `token`, or with `None` leaves it, starting over from the
    /// first change next time.
    pub fn set_sync_token(&self, token: Option<&str>) -> Result<()> {
        self.set_kv("sync_token", token)?;
        self.set_kv("sync_cursor", None)
    }

    pub fn sync_cursor(&self) -> u64 {
        self.kv("sync_cursor")
            .and_then(|cursor| cursor.parse().ok())
            .unwrap_or(0)
    }

    pub fn set_sync_cursor(&self, cursor: u64) -> Result<()> {
        self.set_kv("sync_cursor", Some(&cursor.to_string()))
    }

    /// Queues the whole library for the next upload, for a space this machine just joined. Items
    /// never changed since the sync table existed get their library time, or none, so a version
    /// already in the space wins over them; that is how a joining machine takes on the space's
    /// settings.
    pub fn queue_everything_for_sync(&self, settings: &BTreeMap<String, Value>) -> Result<()> {
        let transaction = self.db.unchecked_transaction()?;
        transaction.execute_batch(
            "UPDATE sync_state SET dirty = 1;
             INSERT OR IGNORE INTO sync_state SELECT 'like', key, added_at * 1000, 0, 1 FROM likes;
             INSERT OR IGNORE INTO sync_state SELECT 'saved', id, added_at * 1000, 0, 1 FROM saved;
             INSERT OR IGNORE INTO sync_state SELECT 'scene', name, 0, 0, 1 FROM scenes;
             INSERT OR IGNORE INTO sync_state SELECT 'mix', name, 0, 0, 1 FROM mixes;
             INSERT OR IGNORE INTO sync_state SELECT 'focus', uid, started_at * 1000, 0, 1 FROM focus_blocks;",
        )?;
        for (name, value) in settings {
            set_setting_value(&transaction, name, value)?;
            transaction.execute(
                "INSERT OR IGNORE INTO sync_state VALUES ('setting', ?1, 0, 0, 1)",
                [name],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Everything changed here since the last upload. An item gone from its table is sent as
    /// deleted.
    pub fn outgoing(&self) -> Result<Vec<Record>> {
        let mut statement = self
            .db
            .prepare("SELECT kind, id, updated_at, deleted FROM sync_state WHERE dirty = 1 ORDER BY updated_at")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
            ))
        })?;
        let mut records = Vec::new();
        for row in rows {
            let (kind, id, updated_at, deleted) = row?;
            let Some(kind) = Kind::parse(&kind) else { continue };
            let body = if deleted { None } else { self.body(kind, &id)? };
            if kind == Kind::Setting && body.is_none() {
                continue;
            }
            records.push(Record {
                kind,
                deleted: body.is_none(),
                id,
                updated_at,
                body,
            });
        }
        Ok(records)
    }

    fn body(&self, kind: Kind, id: &str) -> Result<Option<Value>> {
        let parse = |text: String| serde_json::from_str::<Value>(&text).ok();
        let row = |sql: &str| -> Result<Option<(String, i64)>> {
            Ok(self
                .db
                .query_row(sql, [id], |row| Ok((row.get(0)?, row.get(1)?)))
                .optional()?)
        };
        Ok(match kind {
            Kind::Like => row("SELECT item, added_at FROM likes WHERE key = ?1")?
                .and_then(|(item, added_at)| Some(json!({ "item": parse(item)?, "addedAt": added_at }))),
            Kind::Saved => row("SELECT body, added_at FROM saved WHERE id = ?1")?
                .and_then(|(saved, added_at)| Some(json!({ "saved": parse(saved)?, "addedAt": added_at }))),
            Kind::Scene => row("SELECT body, 0 FROM scenes WHERE name = ?1")?.and_then(|(body, _)| parse(body)),
            Kind::Mix => row("SELECT levels, 0 FROM mixes WHERE name = ?1")?.and_then(|(levels, _)| parse(levels)),
            Kind::Focus => self
                .db
                .query_row(
                    "SELECT started_at, focused_sec, planned_sec, completed FROM focus_blocks WHERE uid = ?1",
                    [id],
                    |row| {
                        Ok(FocusBody {
                            started_at: row.get(0)?,
                            focused_sec: row.get(1)?,
                            planned_sec: row.get(2)?,
                            completed: row.get(3)?,
                        })
                    },
                )
                .optional()?
                .map(serde_json::to_value)
                .transpose()?,
            Kind::Setting => self.setting_value(id),
        })
    }

    /// Clears the upload mark of records the server took, unless the item changed again since.
    pub fn pushed(&self, records: &[Record]) -> Result<()> {
        let transaction = self.db.unchecked_transaction()?;
        for record in records {
            transaction.execute(
                "UPDATE sync_state SET dirty = 0 WHERE kind = ?1 AND id = ?2 AND updated_at = ?3",
                params![record.kind.as_str(), record.id, record.updated_at],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Takes in records from other machines, skipping any this machine changed more recently,
    /// and returns the ones it took. A body this version can't read is skipped too.
    pub fn apply<'a>(&self, records: &'a [Record]) -> Result<Vec<&'a Record>> {
        let transaction = self.db.unchecked_transaction()?;
        let mut applied = Vec::new();
        for record in records {
            let local: Option<i64> = transaction
                .query_row(
                    "SELECT updated_at FROM sync_state WHERE kind = ?1 AND id = ?2",
                    params![record.kind.as_str(), record.id],
                    |row| row.get(0),
                )
                .optional()?;
            if local.is_some_and(|local| local >= record.updated_at) || !apply_one(&transaction, record)? {
                continue;
            }
            transaction.execute(
                "INSERT OR REPLACE INTO sync_state (kind, id, updated_at, deleted, dirty) VALUES (?1, ?2, ?3, ?4, 0)",
                params![record.kind.as_str(), record.id, record.updated_at, record.deleted],
            )?;
            applied.push(record);
        }
        transaction.commit()?;
        Ok(applied)
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

fn set_setting_value(db: &Connection, name: &str, value: &Value) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
        params![format!("setting:{name}"), json(value)?],
    )?;
    Ok(())
}

/// Writes one record from another machine into its table, or returns false for a body this
/// version can't read.
fn apply_one(db: &Connection, record: &Record) -> Result<bool> {
    fn body<T: DeserializeOwned>(record: &Record) -> Option<T> {
        serde_json::from_value(record.body.clone()?).ok()
    }
    let id = record.id.as_str();
    match (record.kind, record.deleted) {
        (Kind::Like, true) => db.execute("DELETE FROM likes WHERE key = ?1", [id])?,
        (Kind::Saved, true) => db.execute("DELETE FROM saved WHERE id = ?1", [id])?,
        (Kind::Scene, true) => db.execute("DELETE FROM scenes WHERE name = ?1", [id])?,
        (Kind::Mix, true) => db.execute("DELETE FROM mixes WHERE name = ?1", [id])?,
        (Kind::Focus, true) => db.execute("DELETE FROM focus_blocks WHERE uid = ?1", [id])?,
        (Kind::Setting, true) => 0,
        (Kind::Setting, false) => {
            let Some(value) = &record.body else { return Ok(false) };
            set_setting_value(db, id, value)?;
            0
        }
        (Kind::Like, false) => {
            let Some(like) = body::<LikeBody>(record) else {
                return Ok(false);
            };
            db.execute(
                "INSERT OR REPLACE INTO likes (key, item, added_at) VALUES (?1, ?2, ?3)",
                params![id, json(&like.item)?, like.added_at],
            )?
        }
        (Kind::Saved, false) => {
            let Some(saved) = body::<SavedBody>(record) else {
                return Ok(false);
            };
            db.execute(
                "INSERT OR REPLACE INTO saved (id, body, added_at) VALUES (?1, ?2, ?3)",
                params![id, json(&saved.saved)?, saved.added_at],
            )?
        }
        (Kind::Scene, false) => {
            let Some(scene) = body::<Scene>(record) else {
                return Ok(false);
            };
            db.execute(
                "INSERT OR REPLACE INTO scenes (name, body) VALUES (?1, ?2)",
                params![id, json(&scene)?],
            )?
        }
        (Kind::Mix, false) => {
            let Some(levels) = body::<Levels>(record) else {
                return Ok(false);
            };
            db.execute(
                "INSERT OR REPLACE INTO mixes (name, levels) VALUES (?1, ?2)",
                params![id, json(&levels)?],
            )?
        }
        (Kind::Focus, false) => {
            let Some(focus) = body::<FocusBody>(record) else {
                return Ok(false);
            };
            db.execute(
                "INSERT INTO focus_blocks (uid, started_at, focused_sec, planned_sec, completed) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (uid) DO UPDATE SET started_at = excluded.started_at, focused_sec = excluded.focused_sec,
                     planned_sec = excluded.planned_sec, completed = excluded.completed",
                params![id, focus.started_at, focus.focused_sec, focus.planned_sec, focus.completed],
            )?
        }
    };
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(key: &str) -> Item {
        Item {
            key: key.into(),
            title: "Home".into(),
            artist: "B".into(),
            duration: Some(90),
            cover: None,
            play: crate::model::Playable::File {
                url: "https://cdn.example/home.mp3".into(),
            },
        }
    }

    #[test]
    fn a_change_uploads_once_and_loses_only_to_a_newer_one_from_elsewhere() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.set_liked(&item("r2:home"), true).unwrap();

        let outgoing = store.outgoing().unwrap();
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].body.as_ref().unwrap()["item"]["key"], "r2:home");
        store.pushed(&outgoing).unwrap();
        assert!(store.outgoing().unwrap().is_empty());

        let older = Record {
            kind: Kind::Like,
            id: "r2:home".into(),
            updated_at: outgoing[0].updated_at - 1,
            deleted: true,
            body: None,
        };
        assert!(store.apply(std::slice::from_ref(&older)).unwrap().is_empty());
        assert_eq!(store.likes().unwrap().len(), 1);

        let newer = Record {
            updated_at: outgoing[0].updated_at + 1,
            ..older
        };
        assert_eq!(store.apply(std::slice::from_ref(&newer)).unwrap().len(), 1);
        assert!(store.likes().unwrap().is_empty());
        assert!(store.outgoing().unwrap().is_empty());
    }

    #[test]
    fn a_joining_machine_uploads_its_library_but_takes_the_spaces_settings() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.set_liked(&item("r2:home"), true).unwrap();
        store.pushed(&store.outgoing().unwrap()).unwrap();

        let settings = BTreeMap::from([("chime".to_string(), Value::Bool(true))]);
        store.queue_everything_for_sync(&settings).unwrap();

        let queued: Vec<(Kind, String)> = store
            .outgoing()
            .unwrap()
            .into_iter()
            .map(|record| (record.kind, record.id))
            .collect();
        assert_eq!(
            queued,
            [(Kind::Setting, "chime".into()), (Kind::Like, "r2:home".into())]
        );
        let from_the_space = Record {
            kind: Kind::Setting,
            id: "chime".into(),
            updated_at: 1,
            deleted: false,
            body: Some(Value::Bool(false)),
        };
        assert_eq!(store.apply(&[from_the_space]).unwrap().len(), 1);
        assert_eq!(store.changed_settings(&settings).len(), 1);
    }

    #[test]
    fn the_sync_servers_example_fills_the_library_and_uploads_back_unchanged() {
        let exchange: Value = serde_json::from_str(include_str!("../sync/fixtures/exchange.json")).unwrap();
        let records: Vec<Record> = serde_json::from_value(exchange["response"]["changes"].clone()).unwrap();
        let store = Store::open(Path::new(":memory:")).unwrap();

        assert_eq!(store.apply(&records).unwrap().len(), records.len());
        assert_eq!(store.likes().unwrap()[0].title, "Rainy Window");
        assert_eq!(store.saved().unwrap()[0].channel, "Lofi Girl");
        assert_eq!(store.scenes().unwrap()[0].name, "Late night reading");
        assert_eq!(store.mixes().unwrap()[0].name, "Cafe in the rain");

        let pomodoro = records.iter().find(|record| record.kind == Kind::Setting).unwrap();
        let settings = BTreeMap::from([("pomodoro".to_string(), pomodoro.body.clone().unwrap())]);
        store.queue_everything_for_sync(&settings).unwrap();
        assert_eq!(store.outgoing().unwrap(), records);
    }

    #[test]
    fn a_library_from_a_newer_chill_is_left_alone() {
        let path = std::env::temp_dir().join(format!("chill-newer-{}.db", std::process::id()));
        Connection::open(&path)
            .unwrap()
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();

        let opened = Store::open(&path);
        let tables: i64 = Connection::open(&path)
            .unwrap()
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
            .unwrap();
        let _ = std::fs::remove_file(&path);

        assert!(opened.is_err());
        assert_eq!(tables, 0);
    }

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
