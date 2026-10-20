mod action;
mod app;
mod audio;
mod catalog;
mod config;
mod media;
mod model;
mod queue;
mod signals;
mod store;
mod timer;
mod tools;
mod ui;
mod youtube;

use std::io::{self, Write, stdout};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use anyhow::Result;
use clap::{Parser, Subcommand};
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

#[derive(Subcommand)]
enum CliCommand {
    /// Check that ffmpeg, yt-dlp, and deno are installed, and show where chill keeps its files.
    Doctor,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let paths = config::Paths::resolve()?;
    if let Some(CliCommand::Doctor) = cli.command {
        doctor(&paths);
        return Ok(());
    }
    let config = config::load(&paths.config_file)?;
    let store = store::Store::open(&paths.database)?;
    media::run_app(move || {
        signals::listen();
        let theme = ui::theme::Theme::detect();
        let engine = audio::Engine::start(paths.cache.clone());
        let crash_log = paths.cache.join("crash.log");
        let mut app = App::new(config, paths, store, engine);

        let mut terminal = ratatui::init();
        let _ = execute!(stdout(), EnableMouseCapture, EnableBracketedPaste);
        let ui_thread = std::thread::current().id();
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
        }));

        // An unanswered capability query leaves ratatui-image's reader blocked on stdin, where it
        // swallows the first keypress, and tmux drops those queries unless passthrough is on.
        let picker = match std::env::var_os("TMUX") {
            Some(_) => Picker::halfblocks(),
            None => Picker::from_query_stdio().unwrap_or_else(|_| Picker::halfblocks()),
        };
        let mut ui = Ui::new(theme, picker, app.config.reduce_motion);
        let jobs = app.jobs.clone();
        let mut media = Media::new(move |command| {
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
        result
    })
}

fn doctor(paths: &config::Paths) {
    println!("chill {}\n", env!("CARGO_PKG_VERSION"));
    let today = jiff::Zoned::now().date();
    let found: Vec<(Tool, Option<String>)> = Tool::ALL.into_iter().map(|tool| (tool, tool.version())).collect();
    let width = found
        .iter()
        .map(|(_, version)| version.as_deref().map_or(7, str::len))
        .max()
        .unwrap_or(0)
        + 2;
    let indent = 8 + width;
    for (tool, version) in found {
        let shown = version.as_deref().unwrap_or("missing");
        println!("{:<8}{shown:<width$}{}", tool.name(), tool.purpose());
        match version {
            None => println!("{:<indent$}install it with: {}", "", tool.install()),
            Some(version) => {
                if let Some(days) = tool.stale_days(&version, today) {
                    println!("{:<indent$}{days} days old, update it with: {}", "", tool.upgrade());
                }
            }
        }
    }
    println!();
    let config = match config::load(&paths.config_file) {
        Ok(_) => String::new(),
        Err(error) => format!("  ({error:#})"),
    };
    println!("{:<9}{}{config}", "config", config::display_path(&paths.config_file));
    println!("{:<9}{}", "library", config::display_path(&paths.database));
    println!("{:<9}{}", "cache", config::display_path(&paths.cache));
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
            || (app.is_playing() && !app.config.reduce_motion)
            || app.stream == Stream::Resolving
            || app.engine.is_buffering();
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
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
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
