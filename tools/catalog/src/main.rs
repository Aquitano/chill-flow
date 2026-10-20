mod bucket;
mod check;
mod encode;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use catalog_schema::{AmbientSound, Catalog, CatalogTrack};
use clap::{Args, Parser, Subcommand};

use bucket::{Bucket, IMMUTABLE, SHORT_LIVED, Upload};

/// The catalog compiled into chill, which is also the one published to the bucket.
const CATALOG_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog.json");

#[derive(Parser)]
#[command(about = "Adds tracks and ambient sounds to chill's catalog.json and publishes it to R2")]
struct Cli {
    /// Print what would be uploaded and written without touching the bucket or catalog.json
    #[arg(long, global = true)]
    dry_run: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Normalize a track to -14 LUFS, upload it with its cover, and add it to catalog.json
    AddTrack(TrackArgs),
    /// Cut and normalize an ambient loop to -16 LUFS, upload it, and add it to catalog.json
    AddSound(SoundArgs),
    /// Validate catalog.json and confirm the public bucket serves every file it names
    Check,
    /// Check catalog.json, then upload it to the bucket
    Publish,
}

#[derive(Args)]
struct TrackArgs {
    audio: PathBuf,
    #[arg(long)]
    title: String,
    #[arg(long)]
    artist: String,
    /// Defaults to the title in lowercase with dashes
    #[arg(long)]
    id: Option<String>,
    /// A PNG, JPEG, or WebP image
    #[arg(long)]
    cover: Option<PathBuf>,
    #[arg(long = "tag", value_name = "TAG")]
    tags: Vec<String>,
    /// Replace files that already exist on the bucket
    #[arg(long)]
    force: bool,
}

#[derive(Args)]
struct SoundArgs {
    audio: PathBuf,
    #[arg(long)]
    label: String,
    /// Author and license of the recording
    #[arg(long)]
    credit: String,
    /// Defaults to the label in lowercase with dashes
    #[arg(long)]
    id: Option<String>,
    /// Seconds to skip at the start of the recording
    #[arg(long, default_value_t = 2.0)]
    start: f64,
    /// Seconds in the loop
    #[arg(long, default_value_t = 75.0)]
    length: f64,
    /// Playback gain relative to the other sounds, 1 to 100
    #[arg(long, default_value_t = 100)]
    gain: u32,
    /// Replace files that already exist on the bucket
    #[arg(long)]
    force: bool,
}

fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();
    match cli.command {
        Command::AddTrack(args) => add_track(args, cli.dry_run),
        Command::AddSound(args) => add_sound(args, cli.dry_run),
        Command::Check => check(),
        Command::Publish => publish(cli.dry_run),
    }
}

fn add_track(args: TrackArgs, dry_run: bool) -> Result<()> {
    let _lock = lock()?;
    let mut catalog = load()?;
    let id = entry_id(args.id, &args.title)?;
    ensure!(
        catalog.tracks.iter().all(|track| track.id != id),
        "catalog.json already has a track with the id {id:?}"
    );
    let file = format!("{id}.mp3");
    let cover = args
        .cover
        .map(|path| image_type(&path).map(|(extension, content_type)| (path, extension, content_type)))
        .transpose()?;
    let cover_key = cover
        .as_ref()
        .map(|(_, extension, _)| format!("cover-{id}.{extension}"));
    let bucket = connect(
        dry_run,
        args.force,
        [Some(&file), cover_key.as_ref()].into_iter().flatten(),
    )?;

    let scratch = tempfile::tempdir()?;
    let encoded = scratch.path().join(&file);
    encode::track(&args.audio, &encoded)?;
    let mut uploads = vec![mp3(&file, &encoded)?];
    if let (Some((path, _, content_type)), Some(key)) = (&cover, &cover_key) {
        let body = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        uploads.push(Upload {
            key: key.clone(),
            body,
            content_type,
            cache_control: IMMUTABLE,
        });
    }
    let track = CatalogTrack {
        id,
        title: args.title,
        artist: args.artist,
        file,
        cover: cover_key,
        duration_sec: encode::duration_sec(&encoded)?,
        tags: args.tags,
    };
    let entry = serde_json::to_string_pretty(&track)?;
    catalog.tracks.push(track);
    validate(&catalog)?;
    ship(bucket.as_ref(), &uploads, &catalog, &entry)
}

fn add_sound(args: SoundArgs, dry_run: bool) -> Result<()> {
    let _lock = lock()?;
    let mut catalog = load()?;
    let id = entry_id(args.id, &args.label)?;
    ensure!(
        catalog.sound(&id).is_none(),
        "catalog.json already has a sound with the id {id:?}"
    );
    ensure!((1..=100).contains(&args.gain), "--gain must be between 1 and 100");
    ensure!(
        args.start >= 0.0 && args.length > 0.0,
        "--start must be at least 0 and --length above 0"
    );
    let file = format!("ambient-{id}.mp3");
    let bucket = connect(dry_run, args.force, [&file])?;

    let scratch = tempfile::tempdir()?;
    let encoded = scratch.path().join(&file);
    encode::ambient_loop(&args.audio, &encoded, args.start, args.length)?;
    let uploads = [mp3(&file, &encoded)?];
    let sound = AmbientSound {
        id,
        label: args.label,
        file,
        gain_percent: args.gain,
        credit: Some(args.credit),
    };
    let entry = serde_json::to_string_pretty(&sound)?;
    catalog.ambient.push(sound);
    validate(&catalog)?;
    ship(bucket.as_ref(), &uploads, &catalog, &entry)
}

fn check() -> Result<()> {
    let catalog = load()?;
    let mut problems = check::problems(&catalog);
    problems.extend(check::unreachable(&catalog));
    for problem in &problems {
        eprintln!("- {problem}");
    }
    ensure!(problems.is_empty(), "catalog.json has {} problem(s)", problems.len());
    println!(
        "catalog.json is valid: {} tracks, {} sounds, {} mixes, every file reachable",
        catalog.tracks.len(),
        catalog.ambient.len(),
        catalog.mixes.len()
    );
    Ok(())
}

fn publish(dry_run: bool) -> Result<()> {
    let _lock = lock()?;
    check()?;
    let upload = Upload {
        key: "catalog.json".into(),
        body: std::fs::read(CATALOG_PATH).context("reading catalog.json")?,
        content_type: "application/json",
        cache_control: SHORT_LIVED,
    };
    if dry_run {
        println!("would upload {}", upload.describe());
        return Ok(());
    }
    Bucket::from_env()?.put(&upload)?;
    println!("uploaded {}", upload.describe());
    Ok(())
}

/// Held for a whole command, so two runs at once can't drop each other's entry or both upload the
/// same new file.
fn lock() -> Result<std::fs::File> {
    let file = std::fs::File::open(CATALOG_PATH).context("opening catalog.json")?;
    file.lock().context("locking catalog.json")?;
    Ok(file)
}

/// Runs before the first upload, so a bad entry leaves nothing on the bucket.
fn validate(catalog: &Catalog) -> Result<()> {
    let problems = check::problems(catalog);
    ensure!(
        problems.is_empty(),
        "nothing was uploaded, because catalog.json would be invalid:\n- {}",
        problems.join("\n- ")
    );
    Ok(())
}

fn load() -> Result<Catalog> {
    let text = std::fs::read_to_string(CATALOG_PATH).context("reading catalog.json")?;
    Catalog::parse(&text, catalog_schema::DEFAULT_URL).context("catalog.json is malformed")
}

/// The bucket to upload to, or `None` on a dry run. Refuses keys the bucket already holds
/// unless forced, because clients cache them as immutable and would keep the old file.
fn connect<'a>(dry_run: bool, force: bool, keys: impl IntoIterator<Item = &'a String>) -> Result<Option<Bucket>> {
    if dry_run {
        return Ok(None);
    }
    let bucket = Bucket::from_env()?;
    if !force {
        for key in keys {
            if bucket.exists(key)? {
                bail!(
                    "{key} is already on the bucket. It is served with an immutable cache header, so players that \
                     fetched it keep the old file. Pick a new --id, or pass --force to replace it anyway."
                );
            }
        }
    }
    Ok(Some(bucket))
}

fn ship(bucket: Option<&Bucket>, uploads: &[Upload], catalog: &Catalog, entry: &str) -> Result<()> {
    let Some(bucket) = bucket else {
        for upload in uploads {
            println!("would upload {}", upload.describe());
        }
        println!("would add to catalog.json:\n{entry}");
        return Ok(());
    };
    for upload in uploads {
        bucket.put(upload)?;
        println!("uploaded {}", upload.describe());
    }
    std::fs::write(CATALOG_PATH, catalog.to_json()).context("writing catalog.json")?;
    println!("added to catalog.json:\n{entry}\nRun `publish` to upload the catalog.");
    Ok(())
}

fn mp3(key: &str, path: &Path) -> Result<Upload> {
    Ok(Upload {
        key: key.into(),
        body: std::fs::read(path).with_context(|| format!("reading {}", path.display()))?,
        content_type: "audio/mpeg",
        cache_control: IMMUTABLE,
    })
}

fn entry_id(id: Option<String>, name: &str) -> Result<String> {
    let id = id.unwrap_or_else(|| slug(name));
    ensure!(!id.is_empty(), "could not derive an id from {name:?}, pass --id");
    ensure!(
        slug(&id) == id,
        "--id may only hold lowercase letters, digits, and single dashes, like {:?}",
        slug(&id)
    );
    Ok(id)
}

fn slug(text: &str) -> String {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn image_type(path: &Path) -> Result<(String, &'static str)> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let content_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => bail!("{} is not a PNG, JPEG, or WebP image", path.display()),
    };
    Ok((extension, content_type))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_catalog() -> Catalog {
        Catalog::parse(
            &std::fs::read_to_string(CATALOG_PATH).unwrap(),
            catalog_schema::DEFAULT_URL,
        )
        .unwrap()
    }

    #[test]
    fn an_invalid_entry_is_refused_before_anything_uploads() {
        let folder = tempfile::tempdir().unwrap();
        let audio = folder.path().join("song.wav");
        let generated = std::process::Command::new("ffmpeg")
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=2"])
            .arg(&audio)
            .status()
            .unwrap();
        assert!(generated.success());
        let args = TrackArgs {
            audio,
            title: "Night Drive".into(),
            artist: " ".into(),
            id: None,
            cover: None,
            tags: Vec::new(),
            force: false,
        };

        let error = add_track(args, true).unwrap_err();

        assert!(error.to_string().contains("nothing was uploaded"), "{error}");
    }

    #[test]
    fn check_reports_a_mix_that_uses_a_missing_sound() {
        let mut catalog = repo_catalog();
        assert_eq!(check::problems(&catalog), Vec::<String>::new());

        catalog.mixes[0].levels.insert("hail".into(), 40);
        assert_eq!(
            check::problems(&catalog),
            [format!(
                "mix {:?} uses sound \"hail\", which is not in ambient",
                catalog.mixes[0].id
            )]
        );
    }

    #[test]
    fn added_entries_survive_the_trip_through_the_apps_parser() {
        let mut catalog = repo_catalog();
        catalog.tracks.push(CatalogTrack {
            id: entry_id(None, "Night Drive").unwrap(),
            title: "Night Drive".into(),
            artist: "Someone".into(),
            file: "night-drive.mp3".into(),
            cover: None,
            duration_sec: 184,
            tags: vec!["focus".into()],
        });
        catalog.ambient.push(AmbientSound {
            id: "hail".into(),
            label: "Hail".into(),
            file: "ambient-hail.mp3".into(),
            gain_percent: 70,
            credit: Some("Someone, CC0 1.0".into()),
        });

        let reparsed = Catalog::parse(&catalog.to_json(), "https://cdn.example/catalog.json").unwrap();
        let track = reparsed.tracks.last().unwrap();
        assert_eq!((track.id.as_str(), track.duration_sec), ("night-drive", 184));
        assert_eq!(reparsed.url(&track.file), "https://cdn.example/night-drive.mp3");
        assert_eq!(reparsed.sound("hail").map(|sound| sound.gain_percent), Some(70));
        assert!(check::problems(&reparsed).is_empty());
    }
}
