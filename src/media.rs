use std::path::Path;
use std::time::Duration;

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection,
};

/// What the OS media overlay shows: a track, or the ambience when no music plays.
#[derive(Debug, PartialEq)]
pub struct NowPlaying<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub album: &'a str,
    pub cover: Option<&'a str>,
    pub duration: Option<u32>,
}

struct MetadataSnapshot {
    title: String,
    artist: String,
    album: String,
    cover: Option<String>,
    duration: Option<u32>,
}

#[derive(Default)]
struct MetadataCache(Option<MetadataSnapshot>);

impl MetadataCache {
    fn update(&mut self, now: Option<&NowPlaying<'_>>) -> bool {
        let shown = self.0.as_ref().map(|shown| NowPlaying {
            title: &shown.title,
            artist: &shown.artist,
            album: &shown.album,
            cover: shown.cover.as_deref(),
            duration: shown.duration,
        });
        if shown.as_ref() == now {
            return false;
        }
        self.0 = now.map(|now| MetadataSnapshot {
            title: now.title.to_owned(),
            artist: now.artist.to_owned(),
            album: now.album.to_owned(),
            cover: now.cover.map(str::to_owned),
            duration: now.duration,
        });
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MediaCommand {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    SeekBy(f64),
    SetPosition(f64),
}

/// The OS "Now Playing" surface and media keys: MPNowPlayingInfoCenter on macOS, SMTC on
/// Windows, MPRIS elsewhere. Missing support only means the keys do nothing.
pub struct Media {
    controls: Option<MediaControls>,
    #[cfg(windows)]
    window: windows_window::HiddenWindow,
    /// Shown for an item without a cover, where a platform otherwise keeps the previous one.
    no_cover: Option<String>,
    shown_metadata: MetadataCache,
    shown_playback: Option<(bool, u64)>,
}

impl Media {
    pub fn new(cache_dir: &Path, on_command: impl Fn(MediaCommand) + Send + 'static) -> Media {
        #[cfg(windows)]
        let window = windows_window::HiddenWindow::create();
        #[cfg(windows)]
        let hwnd = window.handle();
        #[cfg(not(windows))]
        let hwnd = None;

        // MPRIS names must be unique, and a second instance would otherwise fail to register.
        let dbus_name = format!("chill.instance{}", std::process::id());
        let config = PlatformConfig {
            display_name: "chill",
            dbus_name: &dbus_name,
            hwnd,
        };
        let controls = MediaControls::new(config).ok().and_then(|mut controls| {
            controls
                .attach(move |event| {
                    if let Some(command) = translate(event) {
                        on_command(command);
                    }
                })
                .ok()?;
            Some(controls)
        });
        Media {
            controls,
            #[cfg(windows)]
            window,
            no_cover: blank_cover(cache_dir),
            shown_metadata: MetadataCache::default(),
            shown_playback: None,
        }
    }

    pub fn show(&mut self, now: Option<NowPlaying>, playing: bool, position: f64) {
        // souvlaki's macOS calls autorelease the objects they build, and this thread has no pool of
        // its own, so without one they pile up for the whole session.
        #[cfg(target_os = "macos")]
        objc2::rc::autoreleasepool(|_| self.update(now, playing, position));
        #[cfg(not(target_os = "macos"))]
        self.update(now, playing, position);
    }

    fn update(&mut self, now: Option<NowPlaying>, playing: bool, position: f64) {
        let Some(controls) = self.controls.as_mut() else { return };
        if self.shown_metadata.update(now.as_ref()) {
            let no_cover = self.no_cover.as_deref();
            let metadata = now.as_ref().map_or(
                MediaMetadata {
                    cover_url: no_cover,
                    ..MediaMetadata::default()
                },
                |now| MediaMetadata {
                    title: Some(now.title),
                    artist: Some(now.artist),
                    album: Some(now.album),
                    cover_url: now.cover.or(no_cover),
                    duration: now.duration.map(|seconds| Duration::from_secs(u64::from(seconds))),
                },
            );
            let _ = controls.set_metadata(metadata);
            self.shown_playback = None;
        }
        let whole_seconds = position.max(0.0) as u64;
        if self.shown_playback == Some((playing, whole_seconds)) {
            return;
        }
        self.shown_playback = Some((playing, whole_seconds));
        let progress = Duration::try_from_secs_f64(position.max(0.0)).ok().map(MediaPosition);
        let playback = match (now, playing) {
            (None, _) => MediaPlayback::Stopped,
            (Some(_), true) => MediaPlayback::Playing { progress },
            (Some(_), false) => MediaPlayback::Paused { progress },
        };
        let _ = controls.set_playback(playback);
    }

    pub fn pump(&mut self) {
        #[cfg(windows)]
        self.window.pump();
    }
}

/// SMTC only replaces the thumbnail when given one, so an item without a cover gets a blank image.
#[cfg(windows)]
fn blank_cover(cache_dir: &Path) -> Option<String> {
    let path = cache_dir.join("no-cover.png");
    if !path.is_file() {
        image::RgbaImage::new(1, 1).save(&path).ok()?;
    }
    Some(format!("file://{}", path.display()))
}

#[cfg(not(windows))]
fn blank_cover(_cache_dir: &Path) -> Option<String> {
    None
}

fn translate(event: MediaControlEvent) -> Option<MediaCommand> {
    let step = |direction: SeekDirection, seconds: f64| match direction {
        SeekDirection::Forward => seconds,
        SeekDirection::Backward => -seconds,
    };
    Some(match event {
        MediaControlEvent::Play => MediaCommand::Play,
        MediaControlEvent::Pause | MediaControlEvent::Stop => MediaCommand::Pause,
        MediaControlEvent::Toggle => MediaCommand::Toggle,
        MediaControlEvent::Next => MediaCommand::Next,
        MediaControlEvent::Previous => MediaCommand::Previous,
        MediaControlEvent::Seek(direction) => MediaCommand::SeekBy(step(direction, 10.0)),
        MediaControlEvent::SeekBy(direction, by) => MediaCommand::SeekBy(step(direction, by.as_secs_f64())),
        MediaControlEvent::SetPosition(MediaPosition(at)) => MediaCommand::SetPosition(at.as_secs_f64()),
        _ => return None,
    })
}

/// macOS delivers media-key callbacks on the main dispatch queue, so the main thread has to
/// keep pumping its run loop while the app itself runs on another thread.
#[cfg(target_os = "macos")]
pub fn run_app<R: Send + 'static>(app: impl FnOnce() -> R + Send + 'static) -> R {
    use std::sync::mpsc;

    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    const ACCESSORY_POLICY: isize = 1;

    unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: bool = msg_send![application, setActivationPolicy: ACCESSORY_POLICY];
    }
    let (done_tx, done_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let result = app();
        let _ = done_tx.send(());
        result
    });
    loop {
        match done_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => unsafe {
                let run_loop: *mut AnyObject = msg_send![class!(NSRunLoop), mainRunLoop];
                let past: *mut AnyObject = msg_send![class!(NSDate), distantPast];
                let _: () = msg_send![run_loop, runUntilDate: past];
            },
        }
    }
    match handle.join() {
        Ok(result) => result,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn run_app<R>(app: impl FnOnce() -> R) -> R {
    app()
}

/// SMTC only talks to a window, and a terminal app has none of its own.
#[cfg(windows)]
mod windows_window {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DispatchMessageW, MSG, PM_REMOVE, PeekMessageW, TranslateMessage,
    };

    pub struct HiddenWindow(HWND);

    impl HiddenWindow {
        pub fn create() -> HiddenWindow {
            // The predefined STATIC class needs no registration, so no WNDCLASSEXW (and no Gdi feature).
            let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "chill\0".encode_utf16().collect();
            unsafe {
                let instance = GetModuleHandleW(std::ptr::null());
                let hwnd = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    title.as_ptr(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                HiddenWindow(hwnd)
            }
        }

        pub fn handle(&self) -> Option<*mut c_void> {
            (!self.0.is_null()).then_some(self.0)
        }

        pub fn pump(&self) {
            unsafe {
                let mut message: MSG = std::mem::zeroed();
                while PeekMessageW(&mut message, self.0, 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_cache_refreshes_every_changed_field_even_with_the_same_title() {
        let mut cache = MetadataCache::default();
        let mut now = NowPlaying {
            title: "Rain",
            artist: "First artist",
            album: "Catalog",
            cover: None,
            duration: Some(10),
        };
        assert!(cache.update(Some(&now)));
        assert!(!cache.update(Some(&now)));
        now.artist = "Second artist";
        assert!(cache.update(Some(&now)));
        now.album = "YouTube";
        assert!(cache.update(Some(&now)));
        now.cover = Some("https://example.com/cover.png");
        assert!(cache.update(Some(&now)));
        now.duration = Some(20);
        assert!(cache.update(Some(&now)));
        assert!(!cache.update(Some(&now)));
        assert!(cache.update(None));
        assert!(!cache.update(None));
    }
}
