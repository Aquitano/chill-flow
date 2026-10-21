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

/// The sync server turned the key down, so retrying with it is pointless.
#[derive(Debug)]
pub struct Rejected;

impl std::fmt::Display for Rejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the sync server did not accept this sync key")
    }
}

impl std::error::Error for Rejected {}

pub fn create_space(server: &str) -> Result<String> {
    let request = ureq::post(format!("{server}/v1/spaces"))
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .send_empty();
    let created: Created = call(request)?;
    Ok(created.token)
}

/// Uploads what changed here since the last sync and takes in what changed elsewhere, on a
/// connection of its own so the app keeps running meanwhile. Returns whether the library changed;
/// settings that arrived wait in the store for the app to take in.
pub fn run(database: &Path, server: &str, token: &str) -> Result<bool> {
    let store = Store::open(database)?;
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
        let response = exchange(server, token, cursor, changes)?;
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
    let request = ureq::post(format!("{server}/v1/sync"))
        .header("authorization", format!("Bearer {token}"))
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .header("content-type", "application/json")
        .send(&serde_json::to_vec(&Request { cursor, changes })?[..]);
    call(request)
}

fn call<T: for<'de> Deserialize<'de>>(response: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<T> {
    let mut response = response.context("reaching the sync server")?;
    let status = response.status().as_u16();
    if status == 401 {
        return Err(Rejected.into());
    }
    let text = response
        .body_mut()
        .read_to_string()
        .context("reading the sync server's answer")?;
    if !(200..300).contains(&status) {
        let reason = serde_json::from_str::<Failure>(&text).map_or(text, |failure| failure.error);
        bail!("the sync server answered HTTP {status}: {reason}");
    }
    serde_json::from_str(&text).context("the sync server's answer is malformed")
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
    use super::*;

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
