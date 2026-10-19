use crate::timer::TimerMode;

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
}

impl Prompt {
    pub fn title(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "Open a YouTube link",
            Prompt::SaveScene => "Save this scene as",
            Prompt::SaveMix => "Save this ambience mix as",
        }
    }

    pub fn placeholder(self) -> &'static str {
        match self {
            Prompt::OpenUrl => "https://www.youtube.com/watch?v=…",
            Prompt::SaveScene => "rainy study",
            Prompt::SaveMix => "my rain",
        }
    }
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
    ToggleShuffle,
    CycleRepeat,
    ToggleLikeCurrent,
    ToggleLikeRow(usize),
    ShowTab(Tab),
    Activate(usize),
    Enqueue(usize),
    RemoveRow(usize),
    JumpQueue(usize),
    RemoveQueued(usize),
    MoveQueued(usize, isize),
    TimerToggle,
    TimerReset,
    TimerSkip,
    SetTimerMode(TimerMode),
    CycleTimerMode,
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
    Quit,
}
