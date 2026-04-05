import { Background, FocusSession, Quote, Task, Track } from '@/models/app';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

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

    isMenuOpen: boolean;

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
    setVolume: (volume: number[]) => void;
    toggleMenu: () => void;
    setMenuOpen: (open: boolean) => void;
    setMode: (mode: string) => void;
    setTracks: (tracks: Track[]) => void;
    setTasks: (tasks: Task[]) => void;
    setBackgrounds: (backgrounds: Background[]) => void;
    setCurrentTrack: (track: Track | null) => void;
    setLikedTrackIds: (trackIds: string[]) => void;
    toggleTrackLike: (trackId: string) => void;
    nextTrack: () => void;
    previousTrack: () => void;
    setSelectedBackgroundId: (backgroundId: string | null) => void;
    setCurrentQuote: (quote: Quote | null) => void;
    setSessions: (sessions: FocusSession[], summary: AppState['sessionSummary']) => void;
    toggleRepeat: () => void;

    setTimerMode: (mode: TimerMode) => void;
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

const defaultModes: Record<string, ModeSettings> = {
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
        isMenuOpen: false,
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
        setVolume: (volume) => set({ volume }, false, 'setVolume'),
        toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen }), false, 'toggleMenu'),
        setMenuOpen: (open) => set({ isMenuOpen: open }, false, 'setMenuOpen'),
        setMode: (mode) => set({ currentMode: mode }, false, 'setMode'),
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
                    if (state.tracks.length === 0) return state;
                    const currentIndex = state.currentTrack
                        ? state.tracks.findIndex((track) => track.id === state.currentTrack?.id)
                        : -1;
                    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % state.tracks.length : 0;
                    return {
                        lastTrack: state.currentTrack,
                        currentTrack: state.tracks[nextIndex] ?? null,
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

                    if (state.tracks.length === 0) return state;

                    const currentIndex = state.currentTrack
                        ? state.tracks.findIndex((track) => track.id === state.currentTrack?.id)
                        : 0;
                    const previousIndex = currentIndex <= 0 ? state.tracks.length - 1 : currentIndex - 1;

                    return {
                        lastTrack: state.currentTrack,
                        currentTrack: state.tracks[previousIndex] ?? null,
                    };
                },
                false,
                'previousTrack',
            ),
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

        startTimer: () => {
            const state = get();
            if (!state.isPlaying) {
                set({ isPlaying: true }, false, 'startPlaybackWithTimer');
            }
            set({ timerActive: true }, false, 'startTimer');
        },

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
            const nextState =
                state.timerMode === 'focus'
                    ? {
                          selectedPreset: preset,
                          timerSeconds: seconds,
                          focusTimerSeconds: seconds,
                          timerActive: false,
                      }
                    : {
                          selectedPreset: preset,
                          timerSeconds: seconds,
                          pomodoroTimerSeconds: seconds,
                          timerActive: false,
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

            const nextState =
                state.timerMode === 'focus'
                    ? {
                          customMinutes: minutes,
                          timerSeconds: seconds,
                          focusTimerSeconds: seconds,
                          selectedPreset: displayLabel,
                          timerActive: false,
                      }
                    : {
                          customMinutes: minutes,
                          timerSeconds: seconds,
                          pomodoroTimerSeconds: seconds,
                          selectedPreset: displayLabel,
                          timerActive: false,
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
