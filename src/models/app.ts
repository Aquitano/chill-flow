
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
    date?: Date;
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

export interface UserPreferences {
    defaultMode: string;
    autoPlay: boolean;
    transitionSpeed: number;
    volume: number;
    showNotifications: boolean;
    theme: 'light' | 'dark' | 'system';
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
    durationSeconds: number;
    trackId: string | null;
    completedAt: string;
}
