use crate::timer::TimerMode;
use crate::ui::picture::Picture;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Tracks,
    Liked,
    YouTube,
    Sounds,
    Scenes,
}

impl Tab {
    pub const ALL: [Tab; 5] = [Tab::Tracks, Tab::Liked, Tab::YouTube, Tab::Sounds, Tab::Scenes];

    pub fn label(self) -> &'static str {
        match self {
            Tab::Tracks => "Tracks",
            Tab::Liked => "Liked",
            Tab::YouTube => "YouTube",
            Tab::Sounds => "Sounds",
            Tab::Scenes => "Scenes",
        }
    }

    pub fn index(self) -> usize {
        Tab::ALL.iter().position(|tab| *tab == self).unwrap_or(0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Library,
    Queue,
    Ambience,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prompt {
    OpenUrl,
    SaveScene,
    SaveMix,
    AddCatalog,
    JoinSync,
}

impl Prompt {
    pub fn title(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "Open a link",
            Prompt::SaveScene => "Save scene",
            Prompt::SaveMix => "Save ambience mix",
            Prompt::AddCatalog => "Add a catalog",
            Prompt::JoinSync => "Join a sync space",
        }
    }

    pub fn placeholder(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "https://youtu.be/…",
            Prompt::SaveScene => "rainy study",
            Prompt::SaveMix => "my rain",
            Prompt::AddCatalog => "https://…/catalog.json",
            Prompt::JoinSync => "the sync key from your other machine",
        }
    }

    pub fn verb(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "open",
            Prompt::SaveScene | Prompt::SaveMix => "save",
            Prompt::AddCatalog => "add",
            Prompt::JoinSync => "join",
        }
    }

    pub fn hint(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "A YouTube video, playlist, or stream. Saved under YouTube.",
            Prompt::SaveScene => "Keeps what plays, the ambience, and the timer. Start it later with chill <name>.",
            Prompt::SaveMix => "Keeps the current ambience levels under Sounds.",
            Prompt::AddCatalog => "A catalog.json someone shared with you. Its tracks join Tracks.",
            Prompt::JoinSync => "Copy it with \"Copy sync key\" on the machine that already syncs.",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Setting {
    FocusMinutes,
    BreakMinutes,
    LongBreakMinutes,
    LongBreakEvery,
    AutoStartBreaks,
    AutoStartFocus,
    Chime,
    Notifications,
    Picture,
    Look,
    ReduceMotion,
}

impl Setting {
    pub const ALL: [Setting; 11] = [
        Setting::FocusMinutes,
        Setting::BreakMinutes,
        Setting::LongBreakMinutes,
        Setting::LongBreakEvery,
        Setting::AutoStartBreaks,
        Setting::AutoStartFocus,
        Setting::Chime,
        Setting::Notifications,
        Setting::Picture,
        Setting::Look,
        Setting::ReduceMotion,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Setting::FocusMinutes => "Pomodoro focus",
            Setting::BreakMinutes => "Short break",
            Setting::LongBreakMinutes => "Long break",
            Setting::LongBreakEvery => "Long break after",
            Setting::AutoStartBreaks => "Start breaks on their own",
            Setting::AutoStartFocus => "Start focus on its own",
            Setting::Chime => "Chime between phases",
            Setting::Notifications => "Notify between phases",
            Setting::Picture => "Picture",
            Setting::Look => "Picture drawn with",
            Setting::ReduceMotion => "Reduce motion",
        }
    }

    /// The heading this setting sits under, shown above its first row.
    pub fn group(self) -> &'static str {
        match self {
            Setting::Chime | Setting::Notifications => "Sound",
            Setting::Picture | Setting::Look | Setting::ReduceMotion => "Display",
            _ => "Timer",
        }
    }

    pub fn is_toggle(self) -> bool {
        matches!(
            self,
            Setting::AutoStartBreaks
                | Setting::AutoStartFocus
                | Setting::Chime
                | Setting::Notifications
                | Setting::ReduceMotion
        )
    }
}

/// What a confirmed delete removes, named by identity so that a list reordered while the
/// confirmation was open can't redirect it to another row.
#[derive(Debug, Clone, PartialEq)]
pub enum Removal {
    Saved(String),
    Like(String),
    Mix(String),
    Scene(String),
    /// An added catalog, by its URL.
    Catalog(String),
}

/// Everything the user can ask for, whether by key, mouse, media key, or the palette.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    TogglePlay,
    Next,
    Previous,
    SeekBy(f64),
    SeekTo(f64),
    VolumeBy(f32),
    SetVolume(f32),
    SetBalance(f32),
    BalanceBy(f32),
    ToggleShuffle,
    CycleRepeat,
    ToggleLikeCurrent,
    ToggleLikeRow(usize),
    ShowTab(Tab),
    Activate(usize),
    Enqueue(usize),
    RefreshSaved(String),
    RemoveRow(usize),
    Remove(Removal),
    JumpQueue(usize),
    RemoveQueued(usize),
    MoveQueued(usize, isize),
    TimerToggle,
    TimerReset,
    TimerSkip,
    SetTimerMode(TimerMode),
    CycleTimerMode,
    ToggleTimerPanel,
    ToggleLibraryPanel,
    /// The ambience panel and the timer beside it.
    ToggleSidePanel,
    SetPicture(Picture),
    SetLevel(String, u8),
    LevelBy(String, i16),
    ApplyMix(usize),
    PlaySoundscape(usize),
    CycleMix(isize),
    AmbienceOff,
    LoadScene(usize),
    Focus(Panel),
    OpenPrompt(Prompt),
    Submit(Prompt, String),
    OpenPalette,
    OpenHelp,
    OpenStats,
    OpenDiagnostics,
    DismissDiagnostic(usize),
    DismissDiagnosticOverflow,
    OpenSettings,
    AdjustSetting(Setting, i8),
    TurnOnSync,
    SyncNow,
    /// Asks before leaving; `LeaveSync` is what the confirmation sends.
    TurnOffSync,
    LeaveSync,
    /// Asks before deleting; `EraseSyncData` is what the confirmation sends.
    DeleteSyncData,
    EraseSyncData,
    CopySyncKey,
    Quit,
}
