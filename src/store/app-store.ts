import { tracksInScene } from '@/lib/tracks';
import { Background, FocusSession, Quote, Task, Track } from '@/models/app';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/** Bottom-dock panels and the command palette; only one may be open at a time. */
export type WorkspaceOverlay = 'library' | 'ambience' | 'palette';

export type ModeSettings = {
    label: string;
    description: string;
    showQuote: boolean;
    showBackground: boolean;
    showTasks: boolean;
    showStreak: boolean;
    showTimer: boolean;
};

export type TimerMode = 'focus' | 'pomodoro';

/** Cadence portion of Pomodoro settings that round-trips to the account (no runtime fields). */
export type PomodoroCadence = Pick<
    PomodoroSettings,
    'focusMinutes' | 'breakMinutes' | 'longBreakMinutes' | 'sessionsBeforeLongBreak'
>;

/** Workspace timer/volume defaults restored from persisted preferences. */
export type HydratablePreferences = {
    volume: number;
    timerMode: TimerMode;
    timerPreset: string;
    customMinutes: string;
    pomodoroSettings: PomodoroCadence;
};

/** Resolve a preset label (and custom-minute fallback) to whole minutes; null means infinite. */
export function presetToMinutes(preset: string, customMinutes: string): number | null {
    if (preset === '∞') return null;
    const minutesMatch = /^(\d+)m$/.exec(preset);
    if (minutesMatch) return parseInt(minutesMatch[1]!, 10);
    const hoursMatch = /^(\d+)h$/.exec(preset);
    if (hoursMatch) return parseInt(hoursMatch[1]!, 10) * 60;
    const custom = parseInt(customMinutes, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 25;
}

function timerDurationPatch(mode: TimerMode, seconds: number) {
    return mode === 'focus'
        ? { timerSeconds: seconds, focusTimerSeconds: seconds, timerActive: false }
        : { timerSeconds: seconds, pomodoroTimerSeconds: seconds, timerActive: false };
}

export type PomodoroSettings = {
    focusMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    sessionsBeforeLongBreak: number;
    currentSession: number;
    isBreak: boolean;
};

interface AppState {
    isPlaying: boolean;
    currentTrack: Track | null;
    lastTrack: Track | null;
    tracks: Track[];
    likedTrackIds: string[];

    volume: number[];
    repeatEnabled: boolean;

    /** Track-category filter for the play queue; null plays across the whole library. */
    activeScene: string | null;
    activeOverlay: WorkspaceOverlay | null;

    isMenuOpen: boolean;
    /** Settings section to land on when the dialog opens via a shortcut; null keeps the last one. */
    menuSection: string | null;
    isTasksOpen: boolean;

    currentMode: string;
    modes: Record<string, ModeSettings>;

    currentQuote: Quote | null;
    tasks: Task[];
    backgrounds: Background[];
    selectedBackgroundId: string | null;
    sessions: FocusSession[];
    sessionSummary: {
        totalSessions: number;
        totalMinutes: number;
        currentStreak: number;
    };

    timerMode: TimerMode;
    timerSeconds: number;
    timerActive: boolean;
    selectedPreset: string;
    customMinutes: string;
    pomodoroSettings: PomodoroSettings;
    focusTimerSeconds: number;
    pomodoroTimerSeconds: number;

    togglePlay: () => void;
    setIsPlaying: (playing: boolean) => void;
    setVolume: (volume: number[]) => void;
    toggleMenu: () => void;
    setMenuOpen: (open: boolean) => void;
    openMenuSection: (section: string) => void;
    toggleTasks: () => void;
    setTasksOpen: (open: boolean) => void;
    setMode: (mode: string) => void;
    setTracks: (tracks: Track[]) => void;
    setTasks: (tasks: Task[]) => void;
    setBackgrounds: (backgrounds: Background[]) => void;
    setCurrentTrack: (track: Track | null) => void;
    setLikedTrackIds: (trackIds: string[]) => void;
    toggleTrackLike: (trackId: string) => void;
    nextTrack: () => void;
    previousTrack: () => void;
    setActiveScene: (scene: string | null) => void;
    setOverlay: (overlay: WorkspaceOverlay | null) => void;
    toggleOverlay: (overlay: WorkspaceOverlay) => void;
    /** Tracks eligible for next/previous under the active scene filter. */
    getQueue: () => Track[];
    setSelectedBackgroundId: (backgroundId: string | null) => void;
    setCurrentQuote: (quote: Quote | null) => void;
    setSessions: (sessions: FocusSession[], summary: AppState['sessionSummary']) => void;
    toggleRepeat: () => void;

    setTimerMode: (mode: TimerMode) => void;
    hydratePreferences: (prefs: HydratablePreferences) => void;
    startTimer: () => void;
    pauseTimer: () => void;
    resetTimer: () => void;
    setTimerPreset: (preset: string) => void;
    setCustomTime: (minutes: string) => void;
    decrementTimer: () => void;
    updatePomodoroSettings: (settings: Partial<PomodoroSettings>) => void;
    advancePomodoroPhase: () => void;

    getCurrentModeSettings: () => ModeSettings;
}

export const defaultModes: Record<string, ModeSettings> = {
    DeepWork: {
        label: 'DeepWork',
        description: 'Ultra-minimal environment for deep, distraction-free work.',
        showQuote: false,
        showBackground: false,
        showTasks: false,
        showStreak: false,
        showTimer: true,
    },
    LearnFlow: {
        label: 'LearnFlow',
        description: 'Ideal for studying, research sessions, and long-form reading.',
        showQuote: true,
        showBackground: true,
        showTasks: true,
        showStreak: true,
        showTimer: true,
    },
    TaskDrive: {
        label: 'TaskDrive',
        description: 'A practical workspace centered on task execution and momentum.',
        showQuote: false,
        showBackground: false,
        showTasks: true,
        showStreak: true,
        showTimer: true,
    },
    CreativeSpark: {
        label: 'CreativeSpark',
        description: 'A visual mode for writing, designing, and generative thinking.',
        showQuote: true,
        showBackground: true,
        showTasks: false,
        showStreak: false,
        showTimer: false,
    },
};

export const useAppStore = create<AppState>()(
    devtools((set, get) => ({
        isPlaying: false,
        currentTrack: null,
        lastTrack: null,
        tracks: [],
        likedTrackIds: [],
        volume: [50],
        repeatEnabled: false,
        activeScene: null,
        activeOverlay: null,
        isMenuOpen: false,
        menuSection: null,
        isTasksOpen: false,
        currentMode: 'DeepWork',
        modes: defaultModes,
        currentQuote: null,
        tasks: [],
        backgrounds: [],
        selectedBackgroundId: null,
        sessions: [],
        sessionSummary: {
            totalSessions: 0,
            totalMinutes: 0,
            currentStreak: 0,
        },
        timerMode: 'focus',
        timerSeconds: 25 * 60,
        timerActive: false,
        selectedPreset: '25m',
        customMinutes: '25',
        focusTimerSeconds: 25 * 60,
        pomodoroTimerSeconds: 25 * 60,
        pomodoroSettings: {
            focusMinutes: 25,
            breakMinutes: 5,
            longBreakMinutes: 15,
            sessionsBeforeLongBreak: 4,
            currentSession: 1,
            isBreak: false,
        },

        togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying }), false, 'togglePlay'),
        setIsPlaying: (playing) => set({ isPlaying: playing }, false, 'setIsPlaying'),
        setVolume: (volume) => set({ volume }, false, 'setVolume'),
        toggleMenu: () =>
            set((state) => ({ isMenuOpen: !state.isMenuOpen, menuSection: null }), false, 'toggleMenu'),
        setMenuOpen: (open) => set({ isMenuOpen: open, menuSection: null }, false, 'setMenuOpen'),
        openMenuSection: (section) => set({ isMenuOpen: true, menuSection: section }, false, 'openMenuSection'),
        toggleTasks: () => set((state) => ({ isTasksOpen: !state.isTasksOpen }), false, 'toggleTasks'),
        setTasksOpen: (open) => set({ isTasksOpen: open }, false, 'setTasksOpen'),
        setMode: (mode) =>
            set(
                (state) => ({
                    currentMode: mode,
                    // Re-seed the tasks panel to the new mode's default; the Tasks button
                    // can still toggle it afterwards within the mode. Unknown modes leave
                    // the current panel state untouched.
                    isTasksOpen: state.modes[mode]?.showTasks ?? state.isTasksOpen,
                }),
                false,
                'setMode',
            ),
        setTracks: (tracks) =>
            set(
                (state) => ({
                    tracks,
                    currentTrack: state.currentTrack ?? tracks[0] ?? null,
                }),
                false,
                'setTracks',
            ),
        setTasks: (tasks) => set({ tasks }, false, 'setTasks'),
        setBackgrounds: (backgrounds) =>
            set(
                (state) => ({
                    backgrounds,
                    selectedBackgroundId: state.selectedBackgroundId ?? backgrounds[0]?.id ?? null,
                }),
                false,
                'setBackgrounds',
            ),
        setCurrentTrack: (track) =>
            set(
                (state) => ({
                    lastTrack: state.currentTrack,
                    currentTrack: track,
                }),
                false,
                'setCurrentTrack',
            ),
        setLikedTrackIds: (trackIds) => set({ likedTrackIds: trackIds }, false, 'setLikedTrackIds'),
        toggleTrackLike: (trackId) =>
            set(
                (state) => ({
                    likedTrackIds: state.likedTrackIds.includes(trackId)
                        ? state.likedTrackIds.filter((id) => id !== trackId)
                        : [...state.likedTrackIds, trackId],
                }),
                false,
                'toggleTrackLike',
            ),
        nextTrack: () =>
            set(
                (state) => {
                    const queue = tracksInScene(state.tracks, state.activeScene);
                    if (queue.length === 0) return state;
                    const currentIndex = state.currentTrack
                        ? queue.findIndex((track) => track.id === state.currentTrack?.id)
                        : -1;
                    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % queue.length : 0;
                    return {
                        lastTrack: state.currentTrack,
                        currentTrack: queue[nextIndex] ?? null,
                    };
                },
                false,
                'nextTrack',
            ),
        previousTrack: () =>
            set(
                (state) => {
                    if (state.lastTrack) {
                        return {
                            currentTrack: state.lastTrack,
                            lastTrack: state.currentTrack,
                        };
                    }

                    const queue = tracksInScene(state.tracks, state.activeScene);
                    if (queue.length === 0) return state;

                    const currentIndex = state.currentTrack
                        ? queue.findIndex((track) => track.id === state.currentTrack?.id)
                        : 0;
                    const previousIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;

                    return {
                        lastTrack: state.currentTrack,
                        currentTrack: queue[previousIndex] ?? null,
                    };
                },
                false,
                'previousTrack',
            ),
        setActiveScene: (scene) => set({ activeScene: scene }, false, 'setActiveScene'),
        setOverlay: (overlay) => set({ activeOverlay: overlay }, false, 'setOverlay'),
        toggleOverlay: (overlay) =>
            set(
                (state) => ({ activeOverlay: state.activeOverlay === overlay ? null : overlay }),
                false,
                'toggleOverlay',
            ),
        getQueue: () => {
            const { tracks, activeScene } = get();
            return tracksInScene(tracks, activeScene);
        },
        setSelectedBackgroundId: (backgroundId) => set({ selectedBackgroundId: backgroundId }, false, 'setBackgroundId'),
        setCurrentQuote: (quote) => set({ currentQuote: quote }, false, 'setCurrentQuote'),
        setSessions: (sessions, summary) => set({ sessions, sessionSummary: summary }, false, 'setSessions'),
        toggleRepeat: () => set((state) => ({ repeatEnabled: !state.repeatEnabled }), false, 'toggleRepeat'),

        setTimerMode: (mode) => {
            const state = get();
            const currentSeconds = state.timerSeconds;

            if (state.timerMode === 'focus') {
                set({ focusTimerSeconds: currentSeconds }, false, 'saveFocusTimerState');
            } else {
                set({ pomodoroTimerSeconds: currentSeconds }, false, 'savePomodoroTimerState');
            }

            if (mode === 'focus') {
                set(
                    {
                        timerMode: mode,
                        timerSeconds: state.focusTimerSeconds,
                        timerActive: false,
                    },
                    false,
                    'switchToFocusMode',
                );
                return;
            }

            const pomodoroMinutes = state.pomodoroSettings.isBreak
                ? state.pomodoroSettings.breakMinutes
                : state.pomodoroSettings.focusMinutes;

            set(
                {
                    timerMode: mode,
                    timerSeconds: state.selectedPreset === '∞' ? pomodoroMinutes * 60 : state.pomodoroTimerSeconds,
                    pomodoroTimerSeconds: pomodoroMinutes * 60,
                    timerActive: false,
                },
                false,
                'switchToPomodoroMode',
            );
        },

        hydratePreferences: (prefs) =>
            set(
                (state) => {
                    const focusMinutes = presetToMinutes(prefs.timerPreset, prefs.customMinutes);
                    const focusSeconds = focusMinutes === null ? 0 : focusMinutes * 60;
                    const pomodoroSeconds = prefs.pomodoroSettings.focusMinutes * 60;
                    const activeSeconds = prefs.timerMode === 'focus' ? focusSeconds : pomodoroSeconds;

                    return {
                        volume: [prefs.volume],
                        timerMode: prefs.timerMode,
                        selectedPreset: prefs.timerPreset,
                        customMinutes: prefs.customMinutes,
                        focusTimerSeconds: focusSeconds,
                        pomodoroTimerSeconds: pomodoroSeconds,
                        timerSeconds: activeSeconds,
                        timerActive: false,
                        pomodoroSettings: {
                            ...state.pomodoroSettings,
                            ...prefs.pomodoroSettings,
                            currentSession: 1,
                            isBreak: false,
                        },
                    };
                },
                false,
                'hydratePreferences',
            ),

        // Timer and playback are deliberately independent: starting a focus block must
        // not force the music on (and vice versa).
        startTimer: () => set({ timerActive: true }, false, 'startTimer'),

        pauseTimer: () => set({ timerActive: false }, false, 'pauseTimer'),

        resetTimer: () => {
            const state = get();

            if (state.selectedPreset === '∞' && state.timerMode === 'focus') {
                return;
            }

            if (state.timerMode === 'focus') {
                const presetMinutes = state.selectedPreset === '∞'
                    ? 0
                    : parseInt(state.selectedPreset.replace('m', ''), 10) || 25;

                set({ timerSeconds: presetMinutes * 60, timerActive: false }, false, 'resetFocusTimer');
                return;
            }

            const minutes = state.pomodoroSettings.isBreak
                ? state.pomodoroSettings.breakMinutes
                : state.pomodoroSettings.focusMinutes;

            set({ timerSeconds: minutes * 60, timerActive: false }, false, 'resetPomodoroTimer');
        },

        setTimerPreset: (preset) => {
            const state = get();

            if (preset === '∞') {
                if (state.timerMode === 'focus') {
                    set(
                        {
                            selectedPreset: preset,
                            timerSeconds: 0,
                            focusTimerSeconds: 0,
                            timerActive: false,
                        },
                        false,
                        'setInfiniteTimerPreset',
                    );
                }
                return;
            }

            const minutes = parseInt(preset.replace('m', '').replace('h', ''), 10) || 25;
            const seconds = minutes * 60;
            const nextState = {
                ...timerDurationPatch(state.timerMode, seconds),
                selectedPreset: preset,
            };

            set(nextState, false, 'setTimerPreset');
        },

        setCustomTime: (minutes) => {
            const state = get();
            const mins = parseInt(minutes, 10) || 25;
            const seconds = mins * 60;
            const displayLabel = mins >= 60
                ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`
                : `${mins}m`;

            const nextState = {
                ...timerDurationPatch(state.timerMode, seconds),
                customMinutes: minutes,
                selectedPreset: displayLabel,
            };

            set(nextState, false, 'setCustomTime');
        },

        decrementTimer: () => {
            const state = get();

            if (!state.timerActive || (state.timerMode === 'focus' && state.selectedPreset === '∞')) {
                return;
            }

            if (state.timerSeconds > 0) {
                const nextSeconds = state.timerSeconds - 1;

                if (state.timerMode === 'focus') {
                    set(
                        {
                            timerSeconds: nextSeconds,
                            focusTimerSeconds: nextSeconds,
                        },
                        false,
                        'decrementFocusTimer',
                    );
                } else {
                    set(
                        {
                            timerSeconds: nextSeconds,
                            pomodoroTimerSeconds: nextSeconds,
                        },
                        false,
                        'decrementPomodoroTimer',
                    );
                }
                return;
            }

            if (state.timerMode === 'pomodoro') {
                get().advancePomodoroPhase();
                return;
            }

            set({ timerActive: false }, false, 'timerCompleted');
        },

        updatePomodoroSettings: (settings) =>
            set(
                (state) => ({
                    pomodoroSettings: { ...state.pomodoroSettings, ...settings },
                }),
                false,
                'updatePomodoroSettings',
            ),

        advancePomodoroPhase: () => {
            const { pomodoroSettings } = get();
            const nextBreakState = !pomodoroSettings.isBreak;
            let nextSession = pomodoroSettings.currentSession;

            if (!nextBreakState) {
                nextSession += 1;
            }

            if (nextSession > pomodoroSettings.sessionsBeforeLongBreak) {
                nextSession = 1;
            }

            const nextMinutes = nextBreakState
                ? nextSession === pomodoroSettings.sessionsBeforeLongBreak
                    ? pomodoroSettings.longBreakMinutes
                    : pomodoroSettings.breakMinutes
                : pomodoroSettings.focusMinutes;

            set(
                {
                    pomodoroSettings: {
                        ...pomodoroSettings,
                        currentSession: nextSession,
                        isBreak: nextBreakState,
                    },
                    timerSeconds: nextMinutes * 60,
                    timerActive: true,
                },
                false,
                'advancePomodoroPhase',
            );
        },

        getCurrentModeSettings: () => {
            const { currentMode, modes } = get();
            return modes[currentMode];
        },
    })),
);
