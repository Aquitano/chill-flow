mod action;
mod app;
mod audio;
mod catalog;
mod config;
mod media;
mod model;
mod queue;
mod store;
mod timer;
mod ui;
mod youtube;

use std::io::stdout;
use std::time::{Duration, Instant};

use anyhow::Result;
use clap::Parser;
use crossterm::event::{self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture};
use crossterm::execute;
use ratatui::DefaultTerminal;
use ratatui_image::picker::Picker;

use app::{App, Job, Stream};
use media::Media;
use ui::Ui;

/// Lo-fi, ambience, and a focus timer in your terminal.
#[derive(Parser)]
#[command(version)]
struct Cli {
    /// A YouTube link, or the name of a saved scene, to start right away.
    target: Option<String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let paths = config::Paths::resolve()?;
    let config = config::load(&paths.config_file)?;
    let store = store::Store::open(&paths.database)?;
    media::run_app(move || {
        let theme = ui::theme::Theme::detect();
        let engine = audio::Engine::start(paths.cache.clone());
        let mut app = App::new(config, paths.cache, store, engine);

        let mut terminal = ratatui::init();
        let _ = execute!(stdout(), EnableMouseCapture, EnableBracketedPaste);
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let _ = execute!(stdout(), DisableMouseCapture, DisableBracketedPaste);
            previous_hook(info);
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

        let result = run(&mut terminal, &mut app, &mut ui, &mut media);
        app.shutdown();
        let _ = execute!(stdout(), DisableMouseCapture, DisableBracketedPaste);
        ratatui::restore();
        result
    })
}

fn run(terminal: &mut DefaultTerminal, app: &mut App, ui: &mut Ui, media: &mut Media) -> Result<()> {
    loop {
        app.tick(Instant::now());
        media.show(app.current(), app.is_playing(), app.position());
        media.pump();
        terminal.draw(|frame| ui.draw(frame, app))?;
        if app.quit {
            return Ok(());
        }
        let busy = ui.is_animating(Instant::now())
            || (app.is_playing() && !app.config.reduce_motion)
            || app.stream == Stream::Resolving
            || app.engine.is_buffering();
        let timeout = Duration::from_millis(if busy { 33 } else { 250 });
        if event::poll(timeout)? {
            let mut burst = vec![event::read()?];
            while event::poll(Duration::ZERO)? {
                burst.push(event::read()?);
            }
            for event in ui::input::coalesce(burst) {
                ui::input::handle(app, ui, event);
            }
        }
    }
}
