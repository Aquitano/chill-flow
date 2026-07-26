'use client';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
    usePreferencesQuery,
    useSessionCancelMutation,
    useSessionCompleteMutation,
    useSessionCycleCompleteMutation,
    useSessionStartMutation,
    useUpdateTaskMutation,
} from '@/hooks/use-app-data';
import {
    FocusSessionEvent,
    FocusSessionState,
    MIN_RECORDED_SECONDS,
    focusSessionReducer,
    initialFocusSessionState,
    sessionEventForTransition,
} from '@/lib/focus-session';
import { playTimerChime } from '@/lib/audio/chime';
import { FocusChannel, openFocusChannel } from '@/lib/focus-channel';
import { getNotificationPermission, requestNotificationPermission, showTimerNotification } from '@/lib/notifications';
import { flushSessionBeacon } from '@/lib/session-beacon';
import {
    RecorderEffect,
    RecorderResult,
    RecorderState,
    idleRecorder,
    recordedSessionId,
    recorderFinish,
    recorderStartFailed,
    recorderStarted,
    recorderStarting,
} from '@/lib/session-recorder';
import { writeTimerSnapshot } from '@/lib/timer-persistence';
import { cn } from '@/lib/utils';
import {
    OPEN_ENDED_PRESET,
    TimerMode,
    liveTimerSeconds,
    phaseDurationSeconds,
    timerSnapshotOf,
    useAppStore,
} from '@/store/app-store';
import { motion } from 'framer-motion';
import {
    Clock,
    Hourglass,
    Infinity as InfinityIcon,
    Pause,
    Play,
    RefreshCcw,
    Settings,
    SkipForward,
    Timer,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

const FOCUS_PRESETS: { label: string; icon: LucideIcon }[] = [
    { label: '15m', icon: Zap },
    { label: '25m', icon: Timer },
    { label: '45m', icon: Hourglass },
    { label: '60m', icon: Clock },
    { label: OPEN_ENDED_PRESET, icon: InfinityIcon },
];

/** Mirrors the 12-hour cap the server applies to a session's planned duration. */
const MAX_CUSTOM_MINUTES = 12 * 60;

/**
 * How often a running block re-stamps its snapshot. Recovery can only credit focus up to
 * the last write, so this bounds what a crash costs; every path the browser warns us about
 * (hide, unload) writes one of its own.
 */
const SNAPSHOT_REFRESH_MS = 15_000;

/** How a lifecycle command reaches the server: a normal mutation, or the unload beacon. */
type SessionTransport = 'mutation' | 'beacon';

const TICK_COUNT = 72;
const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => {
    const angle = (index / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
    return {
        x1: 50 + 47.2 * Math.cos(angle),
        y1: 50 + 47.2 * Math.sin(angle),
        x2: 50 + 49.2 * Math.cos(angle),
        y2: 50 + 49.2 * Math.sin(angle),
    };
});

function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Spoken form of the dial, so the live region reads "24 minutes" not "24:00". */
function speakTime(seconds: number): string {
    const mins = Math.round(seconds / 60);
    if (mins < 1) return 'under a minute';
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Number field for the cadence popovers. Edits live in a local draft and only commit on
 * blur, so a half-typed "3" on the way to "30" is never snapped back to a default. Keys
 * are kept from the surrounding menu, which would otherwise treat them as typeahead.
 */
function CadenceField({
    id,
    label,
    value,
    min,
    max,
    onCommit,
    className,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    onCommit: (next: number) => void;
    className?: string;
}) {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const commit = () => {
        const next = clampNumber(parseInt(draft, 10), min, max, value);
        setDraft(String(next));
        if (next !== value) onCommit(next);
    };

    return (
        <div className="space-y-1">
            <label htmlFor={id} className="text-ink-dim text-xs">
                {label}
            </label>
            <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
                    if (event.key === 'Enter') event.currentTarget.blur();
                }}
                className={cn('h-7 bg-transparent', className)}
            />
        </div>
    );
}

function CadenceToggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-ink-mid text-xs">{label}</span>
            <ToggleSwitch checked={checked} onChange={onChange} label={label} />
        </div>
    );
}

export const TimerDial: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);

    const timerMode = useAppStore((state) => state.timerMode);
    const timerSeconds = useAppStore((state) => state.timerSeconds);
    const timerActive = useAppStore((state) => state.timerActive);
    const countUpSeconds = useAppStore((state) => state.countUpSeconds);
    const timerResetCount = useAppStore((state) => state.timerResetCount);
    const selectedPreset = useAppStore((state) => state.selectedPreset);
    const customMinutes = useAppStore((state) => state.customMinutes);
    const pomodoroSettings = useAppStore((state) => state.pomodoroSettings);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const focusTaskId = useAppStore((state) => state.focusTaskId);

    const setTimerMode = useAppStore((state) => state.setTimerMode);
    const startTimer = useAppStore((state) => state.startTimer);
    const pauseTimer = useAppStore((state) => state.pauseTimer);
    const resetTimer = useAppStore((state) => state.resetTimer);
    const setTimerPreset = useAppStore((state) => state.setTimerPreset);
    const setCustomTime = useAppStore((state) => state.setCustomTime);
    const tickTimer = useAppStore((state) => state.tickTimer);
    const updatePomodoroSettings = useAppStore((state) => state.updatePomodoroSettings);
    const advancePomodoroPhase = useAppStore((state) => state.advancePomodoroPhase);

    const focusMinutesId = useId();
    const breakMinutesId = useId();
    const longBreakMinutesId = useId();
    const sessionsId = useId();
    const customHoursId = useId();
    const customMinsId = useId();

    const preferencesQuery = usePreferencesQuery();
    // Default to false until the real preference is loaded, so we never prompt for
    // notification permission (or fire one) for a user who has them turned off.
    const showNotificationsPref = preferencesQuery.data?.preferences.showNotifications ?? false;
    const timerSoundPref = preferencesQuery.data?.preferences.timerSound ?? false;

    const isOpenEnded = timerMode === 'focus' && selectedPreset === OPEN_ENDED_PRESET;
    const isBreak = timerMode === 'pomodoro' && pomodoroSettings.isBreak;

    const recorderRef = useRef<RecorderState>(idleRecorder);
    const focusChannelRef = useRef<FocusChannel | null>(null);
    // A completed Pomodoro focus block waiting for its break to finish; once it does,
    // the block is marked as a full focus-plus-break cycle.
    const pendingCycleSessionIdRef = useRef<string | null>(null);
    const sessionStateRef = useRef<FocusSessionState>(initialFocusSessionState);
    const prevFocusRunningRef = useRef(false);
    const prevResetCountRef = useRef(timerResetCount);
    const prevTimerSecondsRef = useRef(timerSeconds);
    const prevIsBreakRef = useRef(pomodoroSettings.isBreak);
    // Set by handleSkipBreak so the boundary effect can tell an explicit skip from a break
    // that ran out; the two differ in wording and in whether the user is present.
    const skippedBreakRef = useRef(false);

    const [customHours, setCustomHours] = useState('0');
    const [customMins, setCustomMins] = useState('25');
    const [customOpen, setCustomOpen] = useState(false);
    const [announcement, setAnnouncement] = useState('');

    const updateTask = useUpdateTaskMutation();
    const startSession = useSessionStartMutation();
    const completeSession = useSessionCompleteMutation();
    const completeCycle = useSessionCycleCompleteMutation();
    const cancelSession = useSessionCancelMutation();

    // Mutations and contextual values change identity each render; mirror them through
    // refs so the session dispatcher can stay stable and avoid stale closures.
    const mutationsRef = useRef({
        start: startSession,
        complete: completeSession,
        completeCycle,
        cancel: cancelSession,
    });
    mutationsRef.current = { start: startSession, complete: completeSession, completeCycle, cancel: cancelSession };
    const updateTaskRef = useRef(updateTask);
    updateTaskRef.current = updateTask;
    const timerKind = timerMode === 'pomodoro' ? ('pomodoro' as const) : ('focus' as const);
    const contextRef = useRef({
        mode: currentMode,
        timerKind,
        trackId: currentTrack?.id ?? null,
        taskId: focusTaskId,
    });
    contextRef.current = { mode: currentMode, timerKind, trackId: currentTrack?.id ?? null, taskId: focusTaskId };

    const runRecorderEffect = useCallback((effect: RecorderEffect, transport: SessionTransport) => {
        if (effect.type === 'NONE') return;

        if (transport === 'beacon') {
            flushSessionBeacon(effect);
            return;
        }

        const { complete, cancel } = mutationsRef.current;

        if (effect.type === 'CANCEL') {
            cancel.mutate({ id: effect.id });
            return;
        }

        complete.mutate(
            { id: effect.id, elapsedSeconds: effect.elapsedSeconds },
            {
                // A null result means no row was updated — already recorded, or truly gone.
                // Surface it instead of silently dropping the time.
                onSuccess: (session) => {
                    if (!session) {
                        toast.warning("Couldn't save your focus time", {
                            description: 'This session may have been replaced in another tab.',
                        });
                    }
                },
                onError: () => {
                    toast.error("Couldn't save your focus time", {
                        description: 'Check your connection — this block was not recorded.',
                    });
                },
            },
        );
    }, []);

    // Keep a device-local snapshot of the dial so closing the tab mid-block doesn't throw
    // the position away. It names the open session row too, so the next load can settle
    // exactly the block this device abandoned.
    const saveTimerSnapshot = useCallback(() => {
        writeTimerSnapshot(timerSnapshotOf(useAppStore.getState(), Date.now(), recordedSessionId(recorderRef.current)));
    }, []);

    // Single entry point for the focus-session lifecycle: feed an event to the pure reducer,
    // persist the next state, and execute the resulting API command. `sessions.start` is a
    // round trip, so the recorder holds a finish that lands before the row's id does.
    const dispatchSession = useCallback(
        (event: FocusSessionEvent, transport: SessionTransport = 'mutation') => {
            const { state, command } = focusSessionReducer(sessionStateRef.current, event);
            sessionStateRef.current = state;

            const settle = (result: RecorderResult) => {
                recorderRef.current = result.state;
                runRecorderEffect(result.effect, transport);
            };

            switch (command.type) {
                case 'START_SESSION':
                    recorderRef.current = recorderStarting();
                    focusChannelRef.current?.announceStart();
                    mutationsRef.current.start.mutate(
                        {
                            mode: contextRef.current.mode,
                            timerKind: contextRef.current.timerKind,
                            plannedDurationSeconds: command.plannedSeconds,
                            trackId: contextRef.current.trackId,
                            taskId: contextRef.current.taskId,
                        },
                        {
                            onSuccess: (session) => {
                                settle(recorderStarted(recorderRef.current, session.id));
                                // Nothing the snapshot effect watches changes when the id
                                // lands, so without this a block that runs straight through
                                // to a crash leaves a snapshot naming no session at all.
                                saveTimerSnapshot();
                            },
                            onError: () => {
                                settle(recorderStartFailed());
                                toast.error('This block is not being recorded', {
                                    description: "We couldn't reach the server when it started.",
                                });
                            },
                        },
                    );
                    break;
                case 'COMPLETE_SESSION':
                    settle(
                        recorderFinish(recorderRef.current, {
                            type: 'complete',
                            elapsedSeconds: command.elapsedSeconds,
                        }),
                    );
                    break;
                case 'CANCEL_SESSION':
                    settle(recorderFinish(recorderRef.current, { type: 'cancel' }));
                    break;
                default:
                    break;
            }
        },
        [runRecorderEffect, saveTimerSnapshot],
    );

    // Two jobs on one channel. A remote start means the server has already canceled this
    // tab's row, so bank what this block earned before the handover and stop the clock
    // rather than letting two dials count the same minutes. An ownership query means some
    // tab is deciding whether to recover a row; answering keeps this block from being
    // completed out from under it.
    useEffect(() => {
        const channel = openFocusChannel({
            onRemoteStart: () => {
                if (sessionStateRef.current.status !== 'running') return;

                dispatchSession({ type: 'COMPLETE', atMs: Date.now() });
                pauseTimer();
                toast('Focus moved to another tab', {
                    id: 'focus-handover',
                    description: 'This block was saved, so the time is only counted once.',
                    action: { label: 'Take over', onClick: () => startTimer() },
                });
            },
            ownsSession: (sessionId) => recordedSessionId(recorderRef.current) === sessionId,
        });
        focusChannelRef.current = channel;

        return () => {
            focusChannelRef.current = null;
            channel.close();
        };
    }, [dispatchSession, pauseTimer, startTimer]);

    // The dial is derived from a wall-clock deadline, so this interval only repaints it.
    // Background tabs throttle (and sleeping machines stop) timers, so also resync the
    // moment the tab comes back rather than waiting for the next throttled tick.
    useEffect(() => {
        if (!timerActive) {
            return;
        }

        const interval = setInterval(tickTimer, 1000);
        document.addEventListener('visibilitychange', tickTimer);
        window.addEventListener('focus', tickTimer);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', tickTimer);
            window.removeEventListener('focus', tickTimer);
        };
    }, [timerActive, tickTimer]);

    useEffect(() => {
        saveTimerSnapshot();
        document.addEventListener('visibilitychange', saveTimerSnapshot);

        return () => document.removeEventListener('visibilitychange', saveTimerSnapshot);
    }, [
        saveTimerSnapshot,
        timerActive,
        timerMode,
        selectedPreset,
        customMinutes,
        pomodoroSettings.isBreak,
        pomodoroSettings.currentSession,
    ]);

    // A block that runs uninterrupted changes none of the state above, so nothing else
    // re-stamps the snapshot between its start and the crash recovery is there for — and
    // the countdown it holds would still read as the full duration.
    useEffect(() => {
        if (!timerActive) return;

        const interval = setInterval(saveTimerSnapshot, SNAPSHOT_REFRESH_MS);
        return () => clearInterval(interval);
    }, [timerActive, saveTimerSnapshot]);

    // Translate timer-state transitions into focus-session lifecycle events. A "focus
    // phase" is any running focus countdown — finite or infinite focus mode, or a
    // Pomodoro focus block (not a break).
    useEffect(() => {
        const focusRunning = timerActive && !isBreak;
        const wasFocusRunning = prevFocusRunningRef.current;
        const wasReset = timerResetCount !== prevResetCountRef.current;
        const now = Date.now();

        prevFocusRunningRef.current = focusRunning;
        prevResetCountRef.current = timerResetCount;

        // A focus phase that gave way to a break finished, whether or not the break started
        // itself. Its cycle completes when the break does.
        if (wasFocusRunning && !focusRunning && isBreak) {
            pendingCycleSessionIdRef.current = recordedSessionId(recorderRef.current);
        }

        const event = sessionEventForTransition({
            wasFocusRunning,
            isFocusRunning: focusRunning,
            isBreak,
            timerMode,
            timerSeconds,
            isOpenEnded,
            wasReset,
            sessionStatus: sessionStateRef.current.status,
            atMs: now,
        });

        if (event) {
            dispatchSession(event);
        }
    }, [timerActive, timerMode, isBreak, timerSeconds, isOpenEnded, timerResetCount, dispatchSession]);

    // Close the block out when the tab goes away, over a transport the browser won't abandon
    // mid-flight. A bfcache restore then brings the dial back with no session behind it, so
    // pageshow opens a fresh one for the time still to come.
    useEffect(() => {
        const handlePageHide = () => {
            // Snapshot first: the flush clears the recorder, and the snapshot needs the id
            // so a beacon that never arrives can still be settled on the next load.
            saveTimerSnapshot();
            if (sessionStateRef.current.status === 'idle') return;
            dispatchSession({ type: 'COMPLETE', atMs: Date.now() }, 'beacon');
        };

        const handlePageShow = (event: PageTransitionEvent) => {
            if (!event.persisted || sessionStateRef.current.status !== 'idle') return;

            const state = useAppStore.getState();
            const onBreak = state.timerMode === 'pomodoro' && state.pomodoroSettings.isBreak;
            if (!state.timerActive || onBreak) return;

            const openEnded = state.timerMode === 'focus' && state.selectedPreset === OPEN_ENDED_PRESET;
            const remaining = liveTimerSeconds(state, Date.now());
            // A sub-minute remainder would never be recorded, so leave it alone.
            if (!openEnded && remaining < MIN_RECORDED_SECONDS) return;

            dispatchSession({ type: 'START', plannedSeconds: openEnded ? 0 : remaining, atMs: Date.now() });
        };

        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('pageshow', handlePageShow);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('pageshow', handlePageShow);
        };
    }, [dispatchSession, saveTimerSnapshot]);

    // Closes the loop between the two halves of the workspace: a block aimed at a task
    // ends by asking whether that task is done, instead of the list and the dial never
    // touching. Reads the store imperatively so completion effects need no extra deps.
    const promptFocusTask = useCallback(() => {
        const { focusTaskId: taskId, tasks } = useAppStore.getState();
        const task = tasks.find((entry) => entry.id === taskId);
        if (!task || task.isCompleted) return;

        toast(`Finished a block on “${task.text}”`, {
            id: 'focus-task-complete',
            action: {
                label: 'Mark done',
                onClick: () => updateTaskRef.current.mutate({ id: task.id, isCompleted: true }),
            },
        });
    }, []);

    // Announce focus-countdown completion (finite focus reaching 0:00). Open-ended focus
    // also sits at timerSeconds 0, so it is excluded to keep selecting it from reading as
    // a completion. The chime and the live region always fire; the browser notification is
    // gated on the preference plus permission.
    useEffect(() => {
        const prevSeconds = prevTimerSecondsRef.current;
        prevTimerSecondsRef.current = timerSeconds;

        if (timerMode !== 'focus' || isOpenEnded || prevSeconds <= 0 || timerSeconds !== 0) return;

        setAnnouncement('Focus session complete.');
        if (timerSoundPref) playTimerChime('complete');
        if (showNotificationsPref) {
            showTimerNotification('Focus session complete', 'Nice work — time to step away for a bit.');
        }
        promptFocusTask();
    }, [timerSeconds, timerMode, isOpenEnded, showNotificationsPref, timerSoundPref, promptFocusTask]);

    // Pomodoro phase boundaries. `isBreak` only flips via advancePomodoroPhase (a real
    // boundary), so watching it covers focus→break and break→focus regardless of whether
    // the next phase started itself.
    useEffect(() => {
        const prevIsBreak = prevIsBreakRef.current;
        prevIsBreakRef.current = pomodoroSettings.isBreak;

        if (prevIsBreak === pomodoroSettings.isBreak || timerMode !== 'pomodoro') return;

        if (pomodoroSettings.isBreak) {
            setAnnouncement('Focus block done. Break time.');
            if (timerSoundPref) playTimerChime('complete');
            if (showNotificationsPref) showTimerNotification('Break time', 'Focus block done — take your break.');
            promptFocusTask();
            return;
        }

        const skipped = skippedBreakRef.current;
        skippedBreakRef.current = false;

        // The break ran out, so the block that was waiting on it is a full focus-plus-break
        // cycle — earned by the break finishing, not by the next block being started. A skip
        // clears the pending mark before reaching here, so it earns nothing.
        if (pendingCycleSessionIdRef.current) {
            mutationsRef.current.completeCycle.mutate({ id: pendingCycleSessionIdRef.current });
            pendingCycleSessionIdRef.current = null;
        }
        // This effect owns the announcement for both boundaries; handleSkipBreak setting its
        // own would be overwritten here on the very next commit.
        setAnnouncement(skipped ? 'Break skipped. Back to focus.' : 'Break over. Back to focus.');
        if (timerSoundPref) playTimerChime('resume');
        // No notification for a skip: the user just pressed the button, so they are here.
        if (showNotificationsPref && !skipped) {
            showTimerNotification('Back to focus', 'Break over — back into the flow.');
        }
    }, [pomodoroSettings.isBreak, showNotificationsPref, timerSoundPref, timerMode, promptFocusTask]);

    // Start/pause the timer. On the first start with notifications enabled, ask for
    // permission inside this gesture (browsers reject permission prompts otherwise).
    const handleToggleTimer = useCallback(() => {
        if (timerActive) {
            pauseTimer();
            return;
        }
        if (showNotificationsPref && getNotificationPermission() === 'default') {
            void requestNotificationPermission();
        }
        startTimer();
    }, [timerActive, pauseTimer, startTimer, showNotificationsPref]);

    // Seed the fields from the duration currently in play each time the popover opens.
    const handleCustomOpenChange = (open: boolean) => {
        if (open) {
            const total = clampNumber(parseInt(customMinutes, 10), 1, MAX_CUSTOM_MINUTES, 25);
            setCustomHours(String(Math.floor(total / 60)));
            setCustomMins(String(total % 60));
        }
        setCustomOpen(open);
    };

    const handleSetCustomTime = () => {
        const hours = parseInt(customHours, 10) || 0;
        const mins = parseInt(customMins, 10) || 0;
        const totalMinutes = Math.min(hours * 60 + mins, MAX_CUSTOM_MINUTES);

        if (totalMinutes > 0) {
            setCustomTime(totalMinutes.toString());
            setCustomOpen(false);
        }
    };

    const handleTimerModeChange = (mode: TimerMode) => {
        if (timerActive) {
            pauseTimer();
        }
        // Switching timer modes abandons any in-flight focus block (focus or Pomodoro)
        // and any Pomodoro cycle still waiting on its break.
        dispatchSession({ type: 'CANCEL' });
        pendingCycleSessionIdRef.current = null;
        setTimerMode(mode);
    };

    const handleSkipBreak = () => {
        // A skipped break is not a completed focus-plus-break cycle, so the block waiting
        // on this break never earns its cycle mark.
        pendingCycleSessionIdRef.current = null;
        skippedBreakRef.current = true;
        advancePomodoroPhase();
        // Skipping is an explicit "back to work now", so it runs even for someone who
        // starts their focus blocks by hand.
        startTimer();
    };

    const displaySeconds = isOpenEnded ? countUpSeconds : timerSeconds;
    const totalSeconds = phaseDurationSeconds({ timerMode, selectedPreset, customMinutes, pomodoroSettings });
    // Open-ended focus has no target to fill, so the ring reads as an hour hand: it sweeps
    // once per hour of real focus rather than sitting inert.
    const ringProgress = isOpenEnded
        ? (countUpSeconds % 3600) / 3600
        : totalSeconds && totalSeconds > 0
          ? Math.min(Math.max(1 - timerSeconds / totalSeconds, 0), 1)
          : 0;

    const phaseLabel =
        timerMode === 'pomodoro'
            ? `${pomodoroSettings.isBreak ? 'Break' : 'Focus'} ${pomodoroSettings.currentSession}/${pomodoroSettings.sessionsBeforeLongBreak}`
            : isOpenEnded
              ? 'Open-ended focus'
              : `${selectedPreset} focus block`;

    return (
        <div className="relative z-20 flex h-full w-full flex-col items-center justify-center rounded-full">
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-1" aria-hidden>
                {TICKS.map((tick, index) => {
                    const lit = index / TICK_COUNT < ringProgress;
                    return (
                        <line
                            key={index}
                            x1={tick.x1}
                            y1={tick.y1}
                            x2={tick.x2}
                            y2={tick.y2}
                            strokeWidth="0.55"
                            strokeLinecap="round"
                            className={cn('stroke-current transition-colors duration-500', {
                                'text-ember': lit && !isBreak,
                                'text-ink-mid': lit && isBreak,
                                'text-white/10': !lit,
                            })}
                        />
                    );
                })}
            </svg>

            {/* The dial itself is aria-live="off" — a per-second countdown would flood a
                screen reader — so boundaries are announced here instead. */}
            <p className="sr-only" role="status" aria-live="polite">
                {announcement}
            </p>

            <Tabs value={timerMode} onValueChange={(value) => handleTimerModeChange(value as TimerMode)}>
                <TabsList className="h-7 bg-black/50">
                    <TabsTrigger value="focus" className="h-6 px-3 text-xs">
                        Focus
                    </TabsTrigger>
                    <TabsTrigger value="pomodoro" className="h-6 px-3 text-xs">
                        Pomodoro
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <p className="text-ink-dim mt-5 text-[11px] tracking-[0.2em] uppercase">{phaseLabel}</p>

            <motion.div
                key={`${timerMode}-${selectedPreset}`}
                initial={{ scale: 0.94, opacity: 0.4 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                className="text-ink mt-1 text-6xl font-medium tabular-nums sm:text-7xl"
                role="timer"
                aria-live="off"
                aria-label={`${isOpenEnded ? 'Focused for' : 'Remaining'} ${speakTime(displaySeconds)}`}
            >
                {formatTime(displaySeconds)}
            </motion.div>

            <div className="mt-6 flex items-center gap-4">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full border-white/15 bg-black/40 hover:bg-white/10"
                    onClick={resetTimer}
                    aria-label={isOpenEnded ? 'Finish open-ended focus' : 'Reset timer'}
                >
                    <RefreshCcw size={15} />
                </Button>

                <Button
                    size="icon"
                    onClick={handleToggleTimer}
                    className="bg-ember text-night hover:bg-ember/90 h-14 w-14 rounded-full shadow-[0_0_40px_-10px_oklch(0.81_0.1_75/0.7)] [&_svg]:size-[22px]"
                    aria-label={timerActive ? 'Pause timer' : 'Start timer'}
                >
                    {timerActive ? (
                        <Pause fill="currentColor" />
                    ) : (
                        <Play fill="currentColor" className="translate-x-[1px]" />
                    )}
                </Button>

                {timerMode === 'pomodoro' ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-full border-white/15 bg-black/40 hover:bg-white/10"
                                aria-label="Pomodoro settings"
                            >
                                <Settings size={15} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="space-y-2 bg-black/90 p-3 backdrop-blur-md">
                            <CadenceField
                                id={focusMinutesId}
                                label="Focus (minutes)"
                                value={pomodoroSettings.focusMinutes}
                                min={1}
                                max={240}
                                onCommit={(focusMinutes) => updatePomodoroSettings({ focusMinutes })}
                            />
                            <CadenceField
                                id={breakMinutesId}
                                label="Break (minutes)"
                                value={pomodoroSettings.breakMinutes}
                                min={1}
                                max={120}
                                onCommit={(breakMinutes) => updatePomodoroSettings({ breakMinutes })}
                            />
                            <CadenceField
                                id={longBreakMinutesId}
                                label="Long break (minutes)"
                                value={pomodoroSettings.longBreakMinutes}
                                min={1}
                                max={240}
                                onCommit={(longBreakMinutes) => updatePomodoroSettings({ longBreakMinutes })}
                            />
                            <CadenceField
                                id={sessionsId}
                                label="Sessions before long break"
                                value={pomodoroSettings.sessionsBeforeLongBreak}
                                min={1}
                                max={12}
                                onCommit={(sessionsBeforeLongBreak) =>
                                    updatePomodoroSettings({ sessionsBeforeLongBreak })
                                }
                            />

                            <div className="space-y-2 border-t border-white/10 pt-2">
                                <CadenceToggle
                                    label="Start breaks automatically"
                                    checked={pomodoroSettings.autoStartBreaks}
                                    onChange={(autoStartBreaks) => updatePomodoroSettings({ autoStartBreaks })}
                                />
                                <CadenceToggle
                                    label="Start focus automatically"
                                    checked={pomodoroSettings.autoStartFocus}
                                    onChange={(autoStartFocus) => updatePomodoroSettings({ autoStartFocus })}
                                />
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <DropdownMenu open={customOpen} onOpenChange={handleCustomOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-full border-white/15 bg-black/40 hover:bg-white/10"
                                aria-label="Custom duration"
                            >
                                <Settings size={15} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="bg-black/90 p-3 backdrop-blur-md">
                            <div className="text-ink-mid mb-2 text-xs">Custom duration</div>
                            <div className="flex items-end gap-2">
                                <CadenceField
                                    id={customHoursId}
                                    label="Hours"
                                    value={parseInt(customHours, 10) || 0}
                                    min={0}
                                    max={12}
                                    onCommit={(hours) => setCustomHours(String(hours))}
                                    className="w-16"
                                />
                                <CadenceField
                                    id={customMinsId}
                                    label="Minutes"
                                    value={parseInt(customMins, 10) || 0}
                                    min={0}
                                    max={59}
                                    onCommit={(minutes) => setCustomMins(String(minutes))}
                                    className="w-16"
                                />
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleSetCustomTime();
                                    }}
                                >
                                    Set
                                </Button>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {timerMode === 'focus' ? (
                <div className="mt-6 flex items-center gap-1" role="group" aria-label="Timer presets">
                    {FOCUS_PRESETS.map((preset) => {
                        const active = selectedPreset === preset.label;
                        const Icon = preset.icon;
                        return (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => setTimerPreset(preset.label)}
                                aria-pressed={active}
                                aria-label={
                                    preset.label === OPEN_ENDED_PRESET
                                        ? 'Open-ended focus'
                                        : `${preset.label} focus block`
                                }
                                className={cn(
                                    'focus-visible:outline-ember relative rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-2',
                                    active ? 'text-ember' : 'text-ink-mid hover:text-ink',
                                )}
                            >
                                {active && (
                                    <motion.span
                                        layoutId="focus-preset-pill"
                                        className="border-ember/50 bg-ember/12 absolute inset-0 rounded-full border"
                                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                                    />
                                )}
                                <span className="relative flex items-center gap-1.5">
                                    <Icon className="h-3 w-3" aria-hidden />
                                    {preset.label !== OPEN_ENDED_PRESET && preset.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="mt-6 flex items-center gap-2 text-xs" aria-label="Pomodoro cadence">
                    <span
                        className={cn(
                            'rounded-full border px-3 py-1',
                            !pomodoroSettings.isBreak
                                ? 'border-ember/50 bg-ember/15 text-ember'
                                : 'text-ink-dim border-white/10',
                        )}
                    >
                        Focus {pomodoroSettings.focusMinutes}m
                    </span>
                    <span
                        className={cn(
                            'rounded-full border px-3 py-1',
                            pomodoroSettings.isBreak
                                ? 'text-ink border-white/40 bg-white/10'
                                : 'text-ink-dim border-white/10',
                        )}
                    >
                        Break {pomodoroSettings.breakMinutes}m
                    </span>
                    {isBreak && (
                        <button
                            type="button"
                            onClick={handleSkipBreak}
                            className="text-ink-dim hover:text-ink focus-visible:outline-ember flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors focus-visible:outline-2"
                        >
                            <SkipForward className="h-3 w-3" aria-hidden />
                            Skip break
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
