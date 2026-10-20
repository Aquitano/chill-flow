use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};

static QUIT: LazyLock<Arc<AtomicBool>> = LazyLock::new(Arc::default);

/// Whether the terminal closed or chill was told to stop, so it quits the normal way and the
/// session still saves.
pub fn quit_requested() -> bool {
    QUIT.load(Ordering::Relaxed)
}

#[cfg(unix)]
pub fn listen() {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGQUIT, SIGTERM};

    for signal in [SIGHUP, SIGINT, SIGQUIT, SIGTERM] {
        let _ = signal_hook::flag::register(signal, Arc::clone(&QUIT));
    }
}

#[cfg(windows)]
pub fn listen() {
    use windows_sys::Win32::System::Console::SetConsoleCtrlHandler;
    use windows_sys::core::BOOL;

    /// Windows ends the process as soon as this returns, and closing the window allows about five
    /// seconds, so it waits here while the main loop saves and quits.
    unsafe extern "system" fn handler(_event: u32) -> BOOL {
        QUIT.store(true, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_secs(5));
        1
    }
    unsafe {
        SetConsoleCtrlHandler(Some(handler), 1);
    }
}
