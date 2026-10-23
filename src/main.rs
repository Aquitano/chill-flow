mod action;
mod app;
mod audio;
mod catalog;
mod config;
mod diagnostics;
mod media;
mod model;
mod queue;
mod signals;
mod store;
mod sync;
mod timer;
mod tools;
mod ui;
mod update;
mod youtube;

use std::fs::{File, TryLockError};
use std::io::{self, Write, stdout};
use std::process::ExitCode;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use crossterm::event::{
    self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture, Event,
};
use crossterm::{cursor, execute};
use ratatui::DefaultTerminal;
use ratatui_image::picker::Picker;

use app::{App, Job, Stream};
use media::Media;
use tools::Tool;
use ui::Ui;

/// Lo-fi, ambience, and a focus timer in your terminal.
#[derive(Parser)]
#[command(version, args_conflicts_with_subcommands = true)]
struct Cli {
    #[command(subcommand)]
    command: Option<CliCommand>,
    /// A YouTube link, or the name of a saved scene, to start right away.
    target: Option<String>,
}

/// Whether `chill <name>` runs a command rather than the scene with that name.
pub fn is_command(name: &str) -> bool {
    let mut cli = Cli::command();
    cli.build();
    cli.find_subcommand(name).is_some()
}

#[derive(Subcommand)]
enum CliCommand {
    /// Check the tools YouTube links need, and show where chill keeps its files.
    Doctor,
    /// Update an official installer-managed copy of chill to the latest release.
    Update,
}

fn main() -> Result<ExitCode> {
    let cli = Cli::parse();
    if matches!(cli.command, Some(CliCommand::Update)) {
        return update::run().map(|()| ExitCode::SUCCESS);
    }
    let paths = config::Paths::resolve()?;
    if let Some(CliCommand::Doctor) = cli.command {
        return Ok(if doctor(&paths) {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        });
    }
    let config = config::load(&paths.config_file)?;
    // A second chill would count the same focus time twice and overwrite the first one's session.
    // The OS lets go of the lock however chill exits.
    let instance = File::create(paths.database.with_extension("lock")).context("could not lock the library")?;
    match instance.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => {
            eprintln!("chill is already running in another terminal.");
            return Ok(ExitCode::FAILURE);
        }
        Err(TryLockError::Error(error)) => return Err(error).context("could not lock the library"),
    }
    let store = store::Store::open(&paths.database).with_context(|| {
        format!(
            "could not open the library at {}",
            config::display_path(&paths.database)
        )
    })?;
    // Without an app to post as, notify-rust asks AppleScript for one named "use_default", and
    // macOS answers with a "Where is use_default?" file picker.
    #[cfg(target_os = "macos")]
    let _ = notify_rust::set_application(
        &std::env::var("__CFBundleIdentifier").unwrap_or_else(|_| "com.apple.Terminal".to_owned()),
    );
    media::run_app(move || {
        signals::listen();
        let theme = ui::theme::Theme::detect();
        let engine = audio::Engine::start(paths.cache.clone());
        let crash_log = paths.cache.join("crash.log");
        let cache = paths.cache.clone();
        let mut app = App::new(config, paths, store, engine);

        let mut terminal = ratatui::init();
        let _ = execute!(stdout(), EnableMouseCapture, EnableBracketedPaste);
        let ui_thread = std::thread::current().id();
        let crashed = app.jobs.clone();
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().id() == ui_thread {
                let _ = execute!(stdout(), DisableMouseCapture, DisableBracketedPaste);
                previous_hook(info);
                return;
            }
            // A worker thread dying must not tear down the UI or print across it.
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&crash_log)
                .and_then(|mut log| writeln!(log, "{info}"));
            let _ = crashed.send(Job::Crashed);
        }));

        let picker = if answers_image_query() {
            Picker::from_query_stdio().unwrap_or_else(|_| Picker::halfblocks())
        } else {
            Picker::halfblocks()
        };
        let mut ui = Ui::new(theme, picker, app.config.reduce_motion);
        let jobs = app.jobs.clone();
        let mut media = Media::new(&cache, move |command| {
            let _ = jobs.send(Job::Media(command));
        });
        if let Some(target) = cli.target {
            app.launch(&target);
        }
        app.check_tools();

        let result = run(&mut terminal, &mut app, &mut ui, &mut media);
        app.shutdown();
        // After the window closes there is no terminal left to restore. ratatui would report that
        // on stderr, which is gone too, and the panic that follows aborts, so errors are ignored
        // here and the terminal is never dropped.
        let _ = execute!(stdout(), DisableMouseCapture, DisableBracketedPaste, cursor::Show);
        let _ = ratatui::try_restore();
        std::mem::forget(terminal);
        result.map(|()| ExitCode::SUCCESS)
    })
}

/// An unanswered capability query leaves ratatui-image's reader blocked on stdin for two seconds,
/// where it swallows the first keypress. Multiplexers drop the query, including over SSH from
/// inside one, where only `TERM` says so.
fn answers_image_query() -> bool {
    let term = std::env::var("TERM").unwrap_or_default();
    let multiplexed = ["TMUX", "STY", "ZELLIJ"]
        .iter()
        .any(|name| std::env::var_os(name).is_some())
        || term.starts_with("tmux")
        || term.starts_with("screen");
    !multiplexed
}

/// Prints what chill depends on and where it keeps its files, and returns whether all of it is usable.
fn doctor(paths: &config::Paths) -> bool {
    println!("chill {}\n", env!("CARGO_PKG_VERSION"));
    let today = jiff::Zoned::now().date();
    let mut healthy = true;
    println!("YouTube links need these tools. The catalog and the ambience play without them.");
    for inspection in Tool::ALL.into_iter().map(Tool::inspect) {
        let tool = inspection.tool;
        let state = match &inspection.state {
            tools::State::Installed(version) => format!("installed ({version})"),
            tools::State::Missing => "missing".into(),
            tools::State::Broken(error) => {
                healthy = false;
                format!("broken: {error}")
            }
        };
        println!("{}: {state}. {}.", tool.name(), tool.purpose());
        if let Some(path) = &inspection.path {
            println!("  path: {}", config::display_path(path));
        }
        match &inspection.state {
            tools::State::Installed(version) => {
                if let Some(days) = tool.stale_days(version, today) {
                    println!("  {days} days old; YouTube links may fail.");
                }
                println!("  update: {}", tool.upgrade());
            }
            _ => match (tool == Tool::Deno).then(tools::node).flatten() {
                Some(version) => println!("  yt-dlp uses node {version} instead."),
                None => println!("  install: {}", tool.install()),
            },
        }
    }
    println!();
    let config = match config::load(&paths.config_file) {
        Ok(_) => String::new(),
        Err(error) => {
            healthy = false;
            format!("  ({error:#})")
        }
    };
    println!("{:<9}{}{config}", "config", config::display_path(&paths.config_file));
    println!("{:<9}{}", "library", config::display_path(&paths.database));
    println!("{:<9}{}", "cache", config::display_path(&paths.cache));
    println!(
        "{:<9}{}",
        "log",
        config::display_path(&paths.cache.join("diagnostics.json"))
    );
    println!(
        "{:<9}{}",
        "crashes",
        config::display_path(&paths.cache.join("crash.log"))
    );
    healthy
}

fn run(terminal: &mut DefaultTerminal, app: &mut App, ui: &mut Ui, media: &mut Media) -> Result<()> {
    let input = read_input();
    loop {
        app.tick(Instant::now());
        media.show(app.now_playing(), app.is_playing(), app.position());
        media.pump();
        terminal.draw(|frame| ui.draw(frame, app))?;
        if app.quit || signals::quit_requested() {
            return Ok(());
        }
        let busy = ui.is_animating(Instant::now())
            || (!app.config.reduce_motion
                && (app.is_playing() || app.stream == Stream::Resolving || app.engine.is_buffering()));
        let timeout = Duration::from_millis(if busy { 33 } else { 250 });
        match input.recv_timeout(timeout) {
            Ok(burst) => {
                let mut events = burst?;
                for burst in input.try_iter() {
                    events.extend(burst?);
                }
                for event in ui::input::coalesce(events) {
                    ui::input::handle(app, ui, event);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                anyhow::bail!("stopped reading input, see crash.log in the cache folder")
            }
        }
    }
}

/// Input arrives in bursts, a paste as many key events at once, read on a thread of its own: once
/// the terminal hangs up, crossterm's reader spins on the closed tty and never returns, and the
/// main loop still has to notice and save.
fn read_input() -> Receiver<io::Result<Vec<Event>>> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let read_burst = || -> io::Result<Vec<Event>> {
            let mut burst = vec![event::read()?];
            while event::poll(Duration::ZERO)? {
                burst.push(event::read()?);
            }
            Ok(burst)
        };
        loop {
            let burst = read_burst();
            let failed = burst.is_err();
            if sender.send(burst).is_err() || failed {
                return;
            }
        }
    });
    receiver
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_names_that_match_a_command_are_told_apart() {
        assert!(is_command("doctor") && is_command("update") && is_command("help"));
        assert!(matches!(
            Cli::try_parse_from(["chill", "update"]).unwrap().command,
            Some(CliCommand::Update)
        ));
        assert!(!is_command("rainy study"));
        let cli = Cli::try_parse_from(["chill", "--", "doctor"]).unwrap();
        assert_eq!((cli.command.is_none(), cli.target.as_deref()), (true, Some("doctor")));
    }
}
