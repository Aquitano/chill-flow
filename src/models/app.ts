export interface Track {
    id: string;
    title: string;
    artist: string;
    thumbnailUrl?: string;
    audioUrl: string;
    duration: number;
    tags: string[];
    category?: string;
    isLiked?: boolean;
}

/** A catalog row as seen by the admin dashboard — includes the raw storage keys. */
export interface AdminTrack extends Track {
    storageKey: string;
    thumbnailKey: string | null;
}

export interface AmbientSound {
    id: string;
    label: string;
    category: string;
    audioUrl: string;
    /** Loudness trim applied under the user's slider (100 = unity). */
    gainPercent: number;
}

/** A named ambient mix: sound id -> level 0..100. Ids absent from the map are off. */
export interface AmbientMix {
    id: string;
    name: string;
    levels: Record<string, number>;
}

export interface Quote {
    id: string;
    text: string;
    author: string;
    tags: string[];
}

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    priority: 'low' | 'medium' | 'high';
    dueAt: Date | null;
    /** True when dueAt carries a meaningful time of day; false for date-only dues. */
    dueHasTime: boolean;
}

export interface Background {
    id: string;
    type: 'color' | 'image' | 'video';
    name: string;
    url?: string;
    color?: string;
    thumbnailUrl?: string;
    tags: string[];
}

export interface PomodoroSettings {
    focusMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    sessionsBeforeLongBreak: number;
}

export interface UserPreferences {
    defaultMode: string;
    autoPlay: boolean;
    transitionSpeed: number;
    volume: number;
    showNotifications: boolean;
    theme: 'light' | 'dark' | 'system';
    timerMode: 'focus' | 'pomodoro';
    timerPreset: string;
    customMinutes: string;
    pomodoroSettings: PomodoroSettings;
    customModes: AppMode[];
    selectedTrackId: string | null;
    selectedBackgroundId: string | null;
    likedTrackIds: string[];
}

export interface AppMode {
    id: string;
    name: string;
    label: string;
    settings: {
        showQuote: boolean;
        showBackground: boolean;
        showTasks: boolean;
        backgroundId?: string;
        playlistIds?: string[];
        quoteCategories?: string[];
    };
}

export interface FocusSession {
    id: string;
    mode: string;
    status: 'active' | 'completed' | 'canceled';
    plannedDurationSeconds: number;
    elapsedSeconds: number;
    trackId: string | null;
    completedAt: string;
}
