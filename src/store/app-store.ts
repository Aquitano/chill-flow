import { MAX_LIKED_TRACKS, type TrackLikeOutcome } from '@/lib/likes';
import { LIKED_SCENE, tracksInScene } from '@/lib/tracks';
import { Background, Quote, Task, Track } from '@/models/app';
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
    | 'focusMinutes'
    | 'breakMinutes'
    | 'longBreakMinutes'
    | 'sessionsBeforeLongBreak'
    | 'autoStartBreaks'
    | 'autoStartFocus'
>;

/** Workspace timer/volume defaults restored from persisted preferences. */
export type HydratablePreferences = {
    volume: number;
    timerMode: TimerMode;
    timerPreset: string;
    customMinutes: string;
    pomodoroSettings: PomodoroCadence;
};

/** Preset label for open-ended focus: no countdown, the dial counts up instead. */
export const OPEN_ENDED_PRESET = '∞';

/** Resolve a preset label (and custom-minute fallback) to whole minutes; null means open-ended. */
export function presetToMinutes(preset: string, customMinutes: string): number | null {
    if (preset === OPEN_ENDED_PRESET) return null;
    // Presets read '25m', '2h', or '1h 30m' — the last form is what setCustomTime writes.
    const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(preset.trim());
    const minutes = (match?.[1] ? parseInt(match[1], 10) * 60 : 0) + (match?.[2] ? parseInt(match[2], 10) : 0);
    if (minutes > 0) return minutes;
    const custom = parseInt(customMinutes, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 25;
}

type PhaseInput = Pick<AppState, 'timerMode' | 'selectedPreset' | 'customMinutes' | 'pomodoroSettings'>;

/** Length of a Pomodoro phase: the long break lands on the last session of the cadence. */
function pomodoroPhaseMinutes(settings: PomodoroSettings, isBreak: boolean, session: number): number {
    if (!isBreak) return settings.focusMinutes;
    return session === settings.sessionsBeforeLongBreak ? settings.longBreakMinutes : settings.breakMinutes;
}

/**
 * Full duration of the phase currently on the dial — the focus preset, or the Pomodoro
 * phase in play (long break included). Null for open-ended focus. Reset and the progress
 * ring both read this so they can never disagree about how long the phase is.
 */
export function phaseDurationSeconds(state: PhaseInput): number | null {
    if (state.timerMode === 'focus') {
        const minutes = presetToMinutes(state.selectedPreset, state.customMinutes);
        return minutes === null ? null : minutes * 60;
    }

    const pomodoro = state.pomodoroSettings;
    return pomodoroPhaseMinutes(pomodoro, pomodoro.isBreak, pomodoro.currentSession) * 60;
}

function isOpenEnded(state: Pick<AppState, 'timerMode' | 'selectedPreset'>): boolean {
    return state.timerMode === 'focus' && state.selectedPreset === OPEN_ENDED_PRESET;
}

function remainingSecondsAt(endsAt: number, nowMs: number): number {
    return Math.max(0, Math.ceil((endsAt - nowMs) / 1000));
}

function countUpSecondsAt(state: Pick<AppState, 'countUpBankedSeconds' | 'countUpStartedAt'>, nowMs: number): number {
    const runningMs = state.countUpStartedAt == null ? 0 : Math.max(0, nowMs - state.countUpStartedAt);
    return Math.floor(state.countUpBankedSeconds + runningMs / 1000);
}

/** Seconds on the dial right now: the live countdown, or the open-ended time counted up. */
export function liveTimerSeconds(state: AppState, nowMs: number): number {
    if (isOpenEnded(state)) return countUpSecondsAt(state, nowMs);
    return state.timerEndsAt == null ? state.timerSeconds : remainingSecondsAt(state.timerEndsAt, nowMs);
}

const IDLE_COUNT_UP = { countUpSeconds: 0, countUpStartedAt: null, countUpBankedSeconds: 0 } as const;

/** Mirror the visible countdown into the per-mode slot so switching modes preserves it. */
function timerSecondsPatch(mode: TimerMode, seconds: number) {
    return mode === 'focus'
        ? { timerSeconds: seconds, focusTimerSeconds: seconds }
        : { timerSeconds: seconds, pomodoroTimerSeconds: seconds };
}

function timerDurationPatch(mode: TimerMode, seconds: number) {
    return { ...timerSecondsPatch(mode, seconds), timerActive: false, timerEndsAt: null, ...IDLE_COUNT_UP };
}

/**
 * Device-local snapshot of the dial, so closing the tab mid-block doesn't throw the
 * position away. Deliberately holds resolved seconds rather than the deadline: a restore
 * always lands *paused* where the user left off, never crediting time the app was closed.
 */
export interface TimerSnapshot {
    version: 2;
    savedAt: number;
    timerMode: TimerMode;
    selectedPreset: string;
    openEnded: boolean;
    wasRunning: boolean;
    /** Countdown left at save time; 0 for open-ended blocks. */
    remainingSeconds: number;
    /** Open-ended focus counted up at save time; 0 for countdowns. */
    elapsedSeconds: number;
    pomodoroSession: number;
    pomodoroIsBreak: boolean;
    /**
     * The session row this device left open, so a reload can settle that specific block.
     * Every tab shares this storage, so the id alone says nothing about who still owns the
     * row — see `askSessionOwner`, which recovery asks before touching it.
     */
    sessionId: string | null;
}

export type TimerRestoreOutcome = 'ignored' | 'restored' | 'finished';

export function timerSnapshotOf(state: AppState, nowMs: number, sessionId: string | null): TimerSnapshot {
    const openEnded = isOpenEnded(state);
    return {
        version: 2,
        savedAt: nowMs,
        timerMode: state.timerMode,
        selectedPreset: state.selectedPreset,
        openEnded,
        wasRunning: state.timerActive,
        remainingSeconds: openEnded ? 0 : liveTimerSeconds(state, nowMs),
        elapsedSeconds: openEnded ? countUpSecondsAt(state, nowMs) : 0,
        pomodoroSession: state.pomodoroSettings.currentSession,
        pomodoroIsBreak: state.pomodoroSettings.isBreak,
        sessionId,
    };
}

export type PomodoroSettings = {
    focusMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    sessionsBeforeLongBreak: number;
    /** Roll straight into the break when a focus block ends, instead of waiting for play. */
    autoStartBreaks: boolean;
    /** Roll straight into the next focus block when a break ends. */
    autoStartFocus: boolean;
    currentSession: number;
    isBreak: boolean;
};

interface AppState {
    isPlaying: boolean;
    currentTrack: Track | null;
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
    /** The task the current focus block is for; recorded with the session. */
    focusTaskId: string | null;
    backgrounds: Background[];
    selectedBackgroundId: string | null;
    sessionSummary: {
        totalSessions: number;
        totalMinutes: number;
        completedCycles: number;
        currentStreak: number;
    };

    timerMode: TimerMode;
    timerSeconds: number;
    timerActive: boolean;
    /**
     * Epoch ms at which the running countdown reaches zero; null while paused, idle, or
     * open-ended. The dial is derived from this rather than from tick counting, so a
     * throttled background tab or a sleeping machine can't slow the timer down.
     */
    timerEndsAt: number | null;
    /** Open-ended focus counted up, in whole seconds. */
    countUpSeconds: number;
    /** Epoch ms the current open-ended run segment started; null while paused. */
    countUpStartedAt: number | null;
    /** Open-ended seconds banked by earlier run segments. */
    countUpBankedSeconds: number;
    /**
     * Bumped by every resetTimer. Reset and pause both stop the dial, so the focus-session
     * lifecycle can only tell them apart by watching this — and reset reaches the store
     * from the dial button, ⇧S, and the command palette alike.
     */
    timerResetCount: number;
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
    setFocusTask: (taskId: string | null) => void;
    setBackgrounds: (backgrounds: Background[]) => void;
    setCurrentTrack: (track: Track | null) => void;
    setLikedTrackIds: (trackIds: string[]) => void;
    /** Returns what happened, so callers can explain a like that was refused at the cap. */
    toggleTrackLike: (trackId: string) => TrackLikeOutcome;
    nextTrack: () => void;
    previousTrack: () => void;
    setActiveScene: (scene: string | null) => void;
    setOverlay: (overlay: WorkspaceOverlay | null) => void;
    toggleOverlay: (overlay: WorkspaceOverlay) => void;
    /** Tracks eligible for next/previous under the active scene filter. */
    getQueue: () => Track[];
    setSelectedBackgroundId: (backgroundId: string | null) => void;
    setCurrentQuote: (quote: Quote | null) => void;
    setSessionSummary: (summary: AppState['sessionSummary']) => void;
    toggleRepeat: () => void;

    setTimerMode: (mode: TimerMode) => void;
    hydratePreferences: (prefs: HydratablePreferences) => void;
    restoreTimer: (snapshot: TimerSnapshot) => TimerRestoreOutcome;
    startTimer: () => void;
    pauseTimer: () => void;
    resetTimer: () => void;
    setTimerPreset: (preset: string) => void;
    setCustomTime: (minutes: string) => void;
    /** Re-derive the dial from the wall clock. Safe to call at any cadence. */
    tickTimer: () => void;
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
        focusTaskId: null,
        backgrounds: [],
        selectedBackgroundId: null,
        sessionSummary: {
            totalSessions: 0,
            totalMinutes: 0,
            completedCycles: 0,
            currentStreak: 0,
        },
        timerMode: 'focus',
        timerSeconds: 25 * 60,
        timerActive: false,
        timerEndsAt: null,
        countUpSeconds: 0,
        countUpStartedAt: null,
        countUpBankedSeconds: 0,
        timerResetCount: 0,
        selectedPreset: '25m',
        customMinutes: '25',
        focusTimerSeconds: 25 * 60,
        pomodoroTimerSeconds: 25 * 60,
        pomodoroSettings: {
            focusMinutes: 25,
            breakMinutes: 5,
            longBreakMinutes: 15,
            sessionsBeforeLongBreak: 4,
            autoStartBreaks: true,
            autoStartFocus: true,
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
        setTasks: (tasks) =>
            set(
                (state) => {
                    // A task that got completed or deleted elsewhere is no longer something
                    // to focus on, so the dial stops claiming it is.
                    const focused = tasks.find((task) => task.id === state.focusTaskId);
                    return { tasks, focusTaskId: focused && !focused.isCompleted ? state.focusTaskId : null };
                },
                false,
                'setTasks',
            ),
        setFocusTask: (taskId) => set({ focusTaskId: taskId }, false, 'setFocusTask'),
        setBackgrounds: (backgrounds) =>
            set(
                (state) => ({
                    backgrounds,
                    selectedBackgroundId: state.selectedBackgroundId ?? backgrounds[0]?.id ?? null,
                }),
                false,
                'setBackgrounds',
            ),
        setCurrentTrack: (track) => set({ currentTrack: track }, false, 'setCurrentTrack'),
        setLikedTrackIds: (trackIds) => set({ likedTrackIds: trackIds }, false, 'setLikedTrackIds'),
        toggleTrackLike: (trackId) => {
            const { likedTrackIds, activeScene } = get();

            if (likedTrackIds.includes(trackId)) {
                const remaining = likedTrackIds.filter((id) => id !== trackId);
                set(
                    {
                        likedTrackIds: remaining,
                        // Unliking the last one leaves the liked filter with nothing to play,
                        // so hand next/previous the whole library back instead of an empty queue.
                        activeScene: activeScene === LIKED_SCENE && remaining.length === 0 ? null : activeScene,
                    },
                    false,
                    'unlikeTrack',
                );
                return 'unliked';
            }

            // Refuse at the cap instead of adding a like the server will reject. See
            // MAX_LIKED_TRACKS for what an over-long list does to later preference saves.
            if (likedTrackIds.length >= MAX_LIKED_TRACKS) {
                return 'limit-reached';
            }

            set({ likedTrackIds: [...likedTrackIds, trackId] }, false, 'likeTrack');
            return 'liked';
        },
        nextTrack: () =>
            set(
                (state) => {
                    const queue = tracksInScene(state.tracks, state.activeScene, state.likedTrackIds);
                    if (queue.length === 0) return state;
                    const currentIndex = state.currentTrack
                        ? queue.findIndex((track) => track.id === state.currentTrack?.id)
                        : -1;
                    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % queue.length : 0;
                    return { currentTrack: queue[nextIndex] ?? null };
                },
                false,
                'nextTrack',
            ),
        previousTrack: () =>
            set(
                (state) => {
                    const queue = tracksInScene(state.tracks, state.activeScene, state.likedTrackIds);
                    if (queue.length === 0) return state;

                    const currentIndex = state.currentTrack
                        ? queue.findIndex((track) => track.id === state.currentTrack?.id)
                        : 0;
                    const previousIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;

                    return { currentTrack: queue[previousIndex] ?? null };
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
            const { tracks, activeScene, likedTrackIds } = get();
            return tracksInScene(tracks, activeScene, likedTrackIds);
        },
        setSelectedBackgroundId: (backgroundId) => set({ selectedBackgroundId: backgroundId }, false, 'setBackgroundId'),
        setCurrentQuote: (quote) => set({ currentQuote: quote }, false, 'setCurrentQuote'),
        setSessionSummary: (summary) => set({ sessionSummary: summary }, false, 'setSessionSummary'),
        toggleRepeat: () => set((state) => ({ repeatEnabled: !state.repeatEnabled }), false, 'toggleRepeat'),

        setTimerMode: (mode) => {
            const state = get();
            if (mode === state.timerMode) {
                return;
            }

            // Bank whatever is live on the dial into the mode we're leaving, so coming
            // back to it resumes where it stood rather than at the full duration.
            const liveSeconds = liveTimerSeconds(state, Date.now());
            const savedSeconds =
                state.timerMode === 'focus'
                    ? { focusTimerSeconds: isOpenEnded(state) ? 0 : liveSeconds }
                    : { pomodoroTimerSeconds: liveSeconds };

            if (mode === 'focus') {
                const focusSeconds =
                    state.focusTimerSeconds > 0
                        ? state.focusTimerSeconds
                        : (phaseDurationSeconds({ ...state, timerMode: 'focus' }) ?? 0);
                set(
                    {
                        ...savedSeconds,
                        timerMode: mode,
                        ...timerSecondsPatch('focus', focusSeconds),
                        timerActive: false,
                        timerEndsAt: null,
                        ...IDLE_COUNT_UP,
                    },
                    false,
                    'switchToFocusMode',
                );
                return;
            }

            // Pomodoro is a cadence rather than a resumable countdown, so entering it
            // always starts the current phase at its configured length.
            const phaseSeconds = phaseDurationSeconds({ ...state, timerMode: 'pomodoro' }) ?? 25 * 60;

            set(
                {
                    ...savedSeconds,
                    timerMode: mode,
                    ...timerSecondsPatch('pomodoro', phaseSeconds),
                    timerActive: false,
                    timerEndsAt: null,
                    ...IDLE_COUNT_UP,
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
                        timerEndsAt: null,
                        ...IDLE_COUNT_UP,
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

        restoreTimer: (snapshot) => {
            const state = get();

            // The account's saved preset wins over a device-local snapshot that no longer
            // matches it — the workspace should open the way the user last configured it.
            if (
                snapshot.version !== 2 ||
                snapshot.timerMode !== state.timerMode ||
                snapshot.selectedPreset !== state.selectedPreset
            ) {
                return 'ignored';
            }

            const pomodoroPatch =
                snapshot.timerMode === 'pomodoro'
                    ? {
                          pomodoroSettings: {
                              ...state.pomodoroSettings,
                              currentSession: snapshot.pomodoroSession,
                              isBreak: snapshot.pomodoroIsBreak,
                          },
                      }
                    : {};

            if (snapshot.openEnded) {
                set(
                    {
                        ...timerSecondsPatch('focus', 0),
                        timerActive: false,
                        timerEndsAt: null,
                        countUpSeconds: snapshot.elapsedSeconds,
                        countUpBankedSeconds: snapshot.elapsedSeconds,
                        countUpStartedAt: null,
                    },
                    false,
                    'restoreOpenEndedTimer',
                );
                return 'restored';
            }

            set(
                {
                    ...pomodoroPatch,
                    ...timerSecondsPatch(snapshot.timerMode, snapshot.remainingSeconds),
                    timerActive: false,
                    timerEndsAt: null,
                    ...IDLE_COUNT_UP,
                },
                false,
                'restoreTimer',
            );

            return snapshot.wasRunning && snapshot.remainingSeconds === 0 ? 'finished' : 'restored';
        },

        // Timer and playback are deliberately independent: starting a focus block must
        // not force the music on (and vice versa).
        startTimer: () =>
            set(
                (state) => {
                    const now = Date.now();

                    if (isOpenEnded(state)) {
                        return { timerActive: true, timerEndsAt: null, countUpStartedAt: now };
                    }

                    // Pressing play on a finished block restarts it instead of doing nothing.
                    const seconds = state.timerSeconds > 0 ? state.timerSeconds : (phaseDurationSeconds(state) ?? 0);
                    if (seconds <= 0) {
                        return {};
                    }

                    return {
                        ...timerSecondsPatch(state.timerMode, seconds),
                        timerActive: true,
                        timerEndsAt: now + seconds * 1000,
                    };
                },
                false,
                'startTimer',
            ),

        pauseTimer: () =>
            set(
                (state) => {
                    const now = Date.now();

                    if (isOpenEnded(state)) {
                        const banked = countUpSecondsAt(state, now);
                        return {
                            timerActive: false,
                            countUpStartedAt: null,
                            countUpBankedSeconds: banked,
                            countUpSeconds: banked,
                        };
                    }

                    return {
                        ...timerSecondsPatch(state.timerMode, liveTimerSeconds(state, now)),
                        timerActive: false,
                        timerEndsAt: null,
                    };
                },
                false,
                'pauseTimer',
            ),

        resetTimer: () => {
            const state = get();
            const resetCount = state.timerResetCount + 1;

            if (isOpenEnded(state)) {
                set(
                    {
                        ...timerSecondsPatch('focus', 0),
                        timerActive: false,
                        timerEndsAt: null,
                        ...IDLE_COUNT_UP,
                        timerResetCount: resetCount,
                    },
                    false,
                    'resetOpenEndedTimer',
                );
                return;
            }

            set(
                {
                    ...timerDurationPatch(state.timerMode, phaseDurationSeconds(state) ?? 0),
                    timerResetCount: resetCount,
                },
                false,
                'resetTimer',
            );
        },

        setTimerPreset: (preset) => {
            const state = get();

            // Presets describe focus blocks; Pomodoro phase lengths are set through the
            // cadence settings, so a preset picked outside focus mode changes nothing.
            if (state.timerMode !== 'focus') {
                return;
            }

            if (preset === OPEN_ENDED_PRESET) {
                set(
                    { ...timerDurationPatch('focus', 0), selectedPreset: preset },
                    false,
                    'setOpenEndedTimerPreset',
                );
                return;
            }

            const minutes = presetToMinutes(preset, state.customMinutes) ?? 25;

            set(
                { ...timerDurationPatch('focus', minutes * 60), selectedPreset: preset },
                false,
                'setTimerPreset',
            );
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

        tickTimer: () => {
            const state = get();

            if (!state.timerActive) {
                return;
            }

            const now = Date.now();

            if (isOpenEnded(state)) {
                const elapsed = countUpSecondsAt(state, now);
                if (elapsed !== state.countUpSeconds) {
                    set({ countUpSeconds: elapsed }, false, 'tickOpenEndedTimer');
                }
                return;
            }

            if (state.timerEndsAt == null) {
                return;
            }

            const remaining = remainingSecondsAt(state.timerEndsAt, now);
            if (remaining > 0) {
                if (remaining !== state.timerSeconds) {
                    set(timerSecondsPatch(state.timerMode, remaining), false, 'tickTimer');
                }
                return;
            }

            if (state.timerMode === 'pomodoro') {
                get().advancePomodoroPhase();
                return;
            }

            set(
                { ...timerSecondsPatch('focus', 0), timerActive: false, timerEndsAt: null },
                false,
                'timerCompleted',
            );
        },

        updatePomodoroSettings: (settings) =>
            set(
                (state) => {
                    const pomodoroSettings = { ...state.pomodoroSettings, ...settings };
                    // Retuning the cadence while the dial sits idle should be visible right
                    // away; a running phase keeps its deadline until it hands over.
                    if (state.timerMode !== 'pomodoro' || state.timerActive) {
                        return { pomodoroSettings };
                    }

                    // Only a change to *this* phase's length may move the dial. The auto-start
                    // toggles are policy and carry no duration, and retuning a phase the dial
                    // isn't showing must not restart the one it is — either would throw away
                    // the remaining time of a phase paused at a boundary.
                    const phaseSeconds = phaseDurationSeconds({ ...state, pomodoroSettings });
                    if (phaseSeconds == null || phaseSeconds === phaseDurationSeconds(state)) {
                        return { pomodoroSettings };
                    }

                    return { pomodoroSettings, ...timerSecondsPatch('pomodoro', phaseSeconds) };
                },
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

            const nextSeconds = pomodoroPhaseMinutes(pomodoroSettings, nextBreakState, nextSession) * 60;
            // The phase always changes; whether its clock starts itself is the user's call.
            const autoStart = nextBreakState ? pomodoroSettings.autoStartBreaks : pomodoroSettings.autoStartFocus;

            set(
                {
                    pomodoroSettings: {
                        ...pomodoroSettings,
                        currentSession: nextSession,
                        isBreak: nextBreakState,
                    },
                    ...timerSecondsPatch('pomodoro', nextSeconds),
                    timerActive: autoStart,
                    timerEndsAt: autoStart ? Date.now() + nextSeconds * 1000 : null,
                },
                false,
                'advancePomodoroPhase',
            );
        },

        getCurrentModeSettings: () => {
            const { currentMode, modes } = get();
            return modes[currentMode] ?? defaultModes.DeepWork!;
        },
    })),
);
