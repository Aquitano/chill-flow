use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store::Store;

pub const DEFAULT_URL: &str = "https://chill-sync.aquitano.me";

/// The Worker's limits are 256 KiB per record, ids of 200 UTF-16 units, and 2 MiB per request,
/// so uploads go in batches that stay under them, and a record that could never fit stays on
/// this machine rather than block every other one.
const RECORD_LIMIT: usize = 256 * 1024;
const ID_LIMIT: usize = 200;
const BATCH_BYTES: usize = 1536 * 1024;
const BATCH_RECORDS: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Like,
    Saved,
    Scene,
    Mix,
    Focus,
    Setting,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Like => "like",
            Kind::Saved => "saved",
            Kind::Scene => "scene",
            Kind::Mix => "mix",
            Kind::Focus => "focus",
            Kind::Setting => "setting",
        }
    }

    pub fn parse(text: &str) -> Option<Kind> {
        serde_json::from_value(Value::String(text.to_string())).ok()
    }
}

/// One synced item at one moment. `body` is `None` once the item was deleted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub kind: Kind,
    pub id: String,
    pub updated_at: i64,
    pub deleted: bool,
    pub body: Option<Value>,
}

#[derive(Debug, Serialize)]
struct Request<'a> {
    cursor: u64,
    changes: &'a [Record],
}

#[derive(Debug, Deserialize)]
struct Response {
    cursor: u64,
    changes: Vec<Record>,
    more: bool,
}

#[derive(Debug, Deserialize)]
struct Created {
    token: String,
}

#[derive(Debug, Deserialize)]
struct Failure {
    error: String,
}

/// The sync space behind a key is out of reach for good, so retrying is pointless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gone {
    /// The server turned the key down.
    Rejected,
    /// Someone deleted the space.
    Deleted,
}

impl std::fmt::Display for Gone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Gone::Rejected => "the sync server did not accept this sync key",
            Gone::Deleted => "this sync space was deleted",
        })
    }
}

impl std::error::Error for Gone {}

/// Whether `value` is something chill can use as the synced setting `name`. Anything else from
/// another machine is left out, so it can't sit in one library and not another.
pub fn readable_setting(name: &str, value: &Value) -> bool {
    match name {
        "chime" | "notifications" | "reduce_motion" => value.is_boolean(),
        "pomodoro" => serde_json::from_value::<crate::timer::PomodoroSettings>(value.clone()).is_ok(),
        "catalogs" => serde_json::from_value::<Vec<String>>(value.clone()).is_ok(),
        _ => false,
    }
}

/// The largest answer read from the server. Pages target 4 MiB, but tie winners can fill the
/// 10 MiB space, so this leaves room while keeping a misbehaving server from filling memory.
const ANSWER_LIMIT: u64 = 16 * 1024 * 1024;

/// `path` on the sync server. Only https carries the key, except to this machine for testing.
fn endpoint(server: &str, path: &str) -> Result<String> {
    let server = server.trim_end_matches('/');
    let uri: ureq::http::Uri = server.parse().context("sync_url must be a valid URL")?;
    let authority = uri.authority().context("sync_url must have a host")?;
    if authority.as_str().contains('@') {
        bail!("sync_url must not contain user information");
    }
    let local = authority.host().eq_ignore_ascii_case("localhost") || matches!(authority.host(), "127.0.0.1" | "[::1]");
    if uri.scheme_str() != Some("https") && !(uri.scheme_str() == Some("http") && local) {
        bail!("sync_url must start with https://, so the sync key never crosses the network unencrypted");
    }
    Ok(format!("{server}{path}"))
}

pub fn create_space(server: &str) -> Result<String> {
    let request = ureq::post(endpoint(server, "/v1/spaces")?)
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .send_empty();
    let created: Created = serde_json::from_str(&answer(request)?).context("the sync server's answer is malformed")?;
    Ok(created.token)
}

/// Deletes everything the space holds on the server and closes it, so other machines stop
/// syncing with it too.
pub fn delete_space(server: &str, token: &str) -> Result<()> {
    let request = ureq::delete(endpoint(server, "/v1/space")?)
        .header("authorization", format!("Bearer {token}"))
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .call();
    match answer(request) {
        Err(error) if error.downcast_ref::<Gone>() == Some(&Gone::Deleted) => Ok(()),
        result => result.map(drop),
    }
}

/// Uploads what changed here since the last sync and takes in what changed elsewhere, on a
/// connection of its own so the app keeps running meanwhile. Returns whether the library changed;
/// settings that arrived wait in the store for the app to take in.
pub fn run(database: &Path, server: &str, token: &str) -> Result<bool> {
    let store = Store::open(database)?;
    run_with(&store, token, |cursor, changes| {
        exchange(server, token, cursor, changes)
    })
}

fn run_with(store: &Store, token: &str, mut exchange: impl FnMut(u64, &[Record]) -> Result<Response>) -> Result<bool> {
    let mut library_changed = false;
    let mut cursor = store.sync_cursor();
    let outgoing: Vec<Record> = store
        .outgoing()?
        .into_iter()
        .filter(|record| size(record) <= RECORD_LIMIT && record.id.encode_utf16().count() <= ID_LIMIT)
        .collect();
    let mut batches = batches(&outgoing).into_iter();
    loop {
        let changes = batches.next().unwrap_or(&[]);
        let response = exchange(cursor, changes)?;
        match store.record_exchange(token, changes, &response.changes, response.cursor)? {
            Some(changed) => library_changed |= changed,
            None => return Ok(library_changed),
        }
        cursor = response.cursor;
        if !response.more && batches.len() == 0 {
            return Ok(library_changed);
        }
    }
}

fn exchange(server: &str, token: &str, cursor: u64, changes: &[Record]) -> Result<Response> {
    let request = ureq::post(endpoint(server, "/v1/sync")?)
        .header("authorization", format!("Bearer {token}"))
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .header("content-type", "application/json")
        .send(&serde_json::to_vec(&Request { cursor, changes })?[..]);
    serde_json::from_str(&answer(request)?).context("the sync server's answer is malformed")
}

/// The body of a successful answer.
fn answer(response: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<String> {
    let mut response = response.context("reaching the sync server")?;
    match response.status().as_u16() {
        401 => return Err(Gone::Rejected.into()),
        410 => return Err(Gone::Deleted.into()),
        _ => {}
    }
    let status = response.status().as_u16();
    if status == 204 {
        return Ok(String::new());
    }
    let text = response
        .body_mut()
        .with_config()
        .limit(ANSWER_LIMIT)
        .read_to_string()
        .context("reading the sync server's answer")?;
    if !(200..300).contains(&status) {
        let reason = serde_json::from_str::<Failure>(&text).map_or(text, |failure| failure.error);
        bail!("the sync server answered HTTP {status}: {reason}");
    }
    Ok(text)
}

fn size(record: &Record) -> usize {
    serde_json::to_vec(record).map_or(usize::MAX, |bytes| bytes.len())
}

fn batches(records: &[Record]) -> Vec<&[Record]> {
    let mut batches = Vec::new();
    let (mut start, mut bytes) = (0, 0);
    for (index, record) in records.iter().enumerate() {
        let record_bytes = size(record);
        if index > start && (bytes + record_bytes > BATCH_BYTES || index - start == BATCH_RECORDS) {
            batches.push(&records[start..index]);
            (start, bytes) = (index, 0);
        }
        bytes += record_bytes;
    }
    if start < records.len() {
        batches.push(&records[start..]);
    }
    batches
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;
    use crate::model::{Item, Playable, Saved, Scene};

    /// The Worker's rules: the later change wins, at the same time the greater serialized body,
    /// a client whose change lost a tie gets the winner back, and pages are short.
    #[derive(Default)]
    struct Server {
        records: BTreeMap<(&'static str, String), (Record, String, u64)>,
        seq: u64,
    }

    impl Server {
        fn exchange(&mut self, cursor: u64, changes: &[Record]) -> Response {
            let mut winners = Vec::new();
            for change in changes {
                let text = serde_json::to_string(&change.body).unwrap();
                let key = (change.kind.as_str(), change.id.clone());
                match self.records.get(&key) {
                    Some((stored, stored_text, _))
                        if (change.updated_at, &text) <= (stored.updated_at, stored_text) =>
                    {
                        if let Some((stored, _, seq)) = self.records.get(&key)
                            && stored.updated_at == change.updated_at
                            && *seq <= cursor
                        {
                            winners.push(stored.clone());
                        }
                    }
                    _ => {
                        self.seq += 1;
                        self.records.insert(key, (change.clone(), text, self.seq));
                    }
                }
            }
            let mut newer: Vec<&(Record, String, u64)> =
                self.records.values().filter(|(_, _, seq)| *seq > cursor).collect();
            newer.sort_by_key(|(_, _, seq)| *seq);
            let page: Vec<&(Record, String, u64)> = newer.iter().take(3).copied().collect();
            Response {
                cursor: page.last().map_or(cursor, |(_, _, seq)| *seq),
                more: newer.len() > page.len(),
                changes: page
                    .into_iter()
                    .map(|(record, _, _)| record.clone())
                    .chain(winners)
                    .collect(),
            }
        }
    }

    fn machine() -> Store {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.set_sync_token(Some("key")).unwrap();
        store
    }

    fn sync(store: &Store, server: &mut Server) {
        run_with(store, "key", |cursor, changes| Ok(server.exchange(cursor, changes))).unwrap();
    }

    fn item(n: u32) -> Item {
        Item {
            key: format!("r2:track-{n}"),
            title: format!("Track {n}"),
            artist: "B".into(),
            duration: Some(60),
            cover: None,
            play: Playable::File {
                url: format!("https://cdn.example/{n}.mp3"),
            },
        }
    }

    fn scene(n: u32, level: u8) -> Scene {
        serde_json::from_value(json!({
            "name": format!("scene {n}"),
            "source": { "kind": "tracks" },
            "levels": { "rain": level },
            "timer": { "kind": "pomodoro" }
        }))
        .unwrap()
    }

    fn change(rng: &mut fastrand::Rng, store: &Store) {
        let n = rng.u32(0..4);
        let now = jiff::Timestamp::now();
        match rng.u8(0..9) {
            0 => store.set_liked(&item(n), true).unwrap(),
            1 => store.set_liked(&item(n), false).unwrap(),
            2 => store.save_scene(&scene(n, rng.u8(0..=100))).unwrap(),
            3 => store.delete_scene(&format!("scene {n}")).unwrap(),
            4 => store
                .save_mix(&format!("mix {n}"), &BTreeMap::from([("rain".into(), rng.u8(0..=100))]))
                .unwrap(),
            5 => store.delete_mix(&format!("mix {n}")).unwrap(),
            6 => {
                let block = store.begin_focus_block(now, 1500).unwrap();
                store.update_focus_block(block, rng.u64(0..1500), rng.bool()).unwrap();
            }
            7 => store.set_synced_setting("chime", &Value::Bool(rng.bool())).unwrap(),
            _ => {
                let saved = Saved {
                    id: format!("ytpl:{n}"),
                    url: format!("https://youtube.com/playlist?list={n}"),
                    title: format!("Playlist {}", rng.u8(..)),
                    channel: String::new(),
                    items: vec![item(n)],
                };
                if rng.bool() {
                    store.save(&saved)
                } else {
                    store.forget(&saved.id)
                }
                .unwrap()
            }
        }
    }

    /// What another machine, or a newer chill, might send: valid records with times close to
    /// the ones here, so ties happen, and old records whose bodies this version can't read.
    fn from_elsewhere(rng: &mut fastrand::Rng) -> Record {
        let n = rng.u32(0..4);
        let now = jiff::Timestamp::now().as_millisecond();
        let (kind, id, body) = match rng.u8(0..4) {
            0 => (
                Kind::Like,
                format!("r2:track-{n}"),
                json!({ "item": item(n), "addedAt": 1 }),
            ),
            1 => (
                Kind::Scene,
                format!("scene {n}"),
                serde_json::to_value(scene(n, rng.u8(0..=100))).unwrap(),
            ),
            2 => (Kind::Setting, "chime".into(), Value::Bool(rng.bool())),
            _ => (Kind::Mix, format!("mix {n}"), json!({ "rain": rng.u8(0..=100) })),
        };
        let garbage = rng.u8(0..4) == 0;
        Record {
            kind,
            id,
            updated_at: if garbage {
                rng.i64(0..1000)
            } else {
                now + rng.i64(-3..3)
            },
            deleted: !garbage && rng.u8(0..4) == 0,
            body: Some(if garbage {
                json!(["not", "a", { "body": n }])
            } else {
                body
            }),
        }
        .normalized()
    }

    impl Record {
        fn normalized(mut self) -> Record {
            if self.deleted {
                self.body = None;
            }
            self
        }
    }

    #[test]
    fn the_key_only_travels_over_https_except_to_this_machine() {
        assert_eq!(
            endpoint("https://sync.example/", "/v1/sync").unwrap(),
            "https://sync.example/v1/sync"
        );
        assert!(endpoint("http://127.0.0.1:8787", "/v1/sync").is_ok());
        assert!(endpoint("http://localhost", "/v1/sync").is_ok());
        assert!(endpoint("http://[::1]:8787", "/v1/sync").is_ok());
        assert!(endpoint("http://LOCALHOST:8787/base/", "/v1/sync").is_ok());
        for server in [
            "http://sync.example",
            "http://localhost.evil.example",
            "http://localhost:8787@example.invalid",
            "http://127.0.0.1:8787@example.invalid",
            "http://[::1]:8787@example.invalid",
            "http://user@localhost:8787",
            "https://user:password@sync.example",
            "https:///missing-host",
            "ftp://localhost",
            "",
        ] {
            assert!(endpoint(server, "/v1/sync").is_err(), "{server}");
        }
    }

    #[test]
    fn two_machines_end_up_with_the_same_library_whatever_order_things_happen_in() {
        for seed in 0..150 {
            let mut rng = fastrand::Rng::with_seed(seed);
            let (a, b) = (machine(), machine());
            let mut server = Server::default();
            for _ in 0..40 {
                let here = if rng.bool() { &a } else { &b };
                match rng.u8(0..10) {
                    0..=5 => change(&mut rng, here),
                    6 | 7 => sync(here, &mut server),
                    _ => {
                        let records: Vec<Record> = (0..rng.usize(1..4)).map(|_| from_elsewhere(&mut rng)).collect();
                        let mut unique = BTreeMap::new();
                        for record in records {
                            unique.insert((record.kind.as_str(), record.id.clone()), record);
                        }
                        let records: Vec<Record> = unique.into_values().collect();
                        server.exchange(server.seq, &records);
                    }
                }
            }
            for _ in 0..2 {
                sync(&a, &mut server);
                sync(&b, &mut server);
            }
            assert_eq!(a.snapshot(), b.snapshot(), "seed {seed}");
        }
    }

    #[test]
    fn uploads_split_into_batches_under_the_servers_limits() {
        let record = |bytes: usize| Record {
            kind: Kind::Saved,
            id: "playlist".into(),
            updated_at: 1,
            deleted: false,
            body: Some(Value::String("x".repeat(bytes))),
        };
        let records: Vec<Record> = (0..8)
            .map(|_| record(200 * 1024))
            .chain((0..1500).map(|_| record(10)))
            .collect();

        let sizes: Vec<usize> = batches(&records).iter().map(|batch| batch.len()).collect();

        assert_eq!(sizes.iter().sum::<usize>(), records.len());
        assert!(
            batches(&records)
                .iter()
                .all(|batch| batch.iter().map(size).sum::<usize>() <= BATCH_BYTES)
        );
        assert!(sizes.iter().all(|count| *count <= BATCH_RECORDS));
        assert!(batches(&[]).is_empty());
    }
}
