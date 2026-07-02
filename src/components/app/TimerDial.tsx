'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    usePreferencesQuery,
    useSessionCancelMutation,
    useSessionCompleteMutation,
    useSessionStartMutation,
} from '@/hooks/use-app-data';
import {
    FocusSessionEvent,
    FocusSessionState,
    MIN_RECORDED_SECONDS,
    focusSessionReducer,
    initialFocusSessionState,
} from '@/lib/focus-session';
import { getNotificationPermission, requestNotificationPermission, showTimerNotification } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { TimerMode, presetToMinutes, useAppStore } from '@/store/app-store';
import { Pause, Play, RefreshCcw, Settings } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

const FOCUS_PRESETS = ['15m', '25m', '45m', '60m', '∞'];

function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * The timer as the centerpiece of the workspace: a progress ring hugging the central
 * circle with the countdown and controls inside it. Owns the full focus-session
 * lifecycle (start/pause/complete/cancel recording) exactly as the old side panel did.
 */
export const TimerDial: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);

    const timerMode = useAppStore((state) => state.timerMode);
    const timerSeconds = useAppStore((state) => state.timerSeconds);
    const timerActive = useAppStore((state) => state.timerActive);
    const selectedPreset = useAppStore((state) => state.selectedPreset);
    const customMinutes = useAppStore((state) => state.customMinutes);
    const pomodoroSettings = useAppStore((state) => state.pomodoroSettings);
    const currentTrack = useAppStore((state) => state.currentTrack);

    const setTimerMode = useAppStore((state) => state.setTimerMode);
    const startTimer = useAppStore((state) => state.startTimer);
    const pauseTimer = useAppStore((state) => state.pauseTimer);
    const resetTimer = useAppStore((state) => state.resetTimer);
    const setTimerPreset = useAppStore((state) => state.setTimerPreset);
    const setCustomTime = useAppStore((state) => state.setCustomTime);
    const decrementTimer = useAppStore((state) => state.decrementTimer);
    const updatePomodoroSettings = useAppStore((state) => state.updatePomodoroSettings);

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

    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const activeSessionIdRef = useRef<string | null>(null);
    const sessionStateRef = useRef<FocusSessionState>(initialFocusSessionState);
    const prevFocusRunningRef = useRef(false);
    const prevTimerSecondsRef = useRef(timerSeconds);
    const prevIsBreakRef = useRef(pomodoroSettings.isBreak);

    const [customHours, setCustomHours] = useState('0');
    const [customMins, setCustomMins] = useState('25');
    const [customOpen, setCustomOpen] = useState(false);

    const startSession = useSessionStartMutation();
    const completeSession = useSessionCompleteMutation();
    const cancelSession = useSessionCancelMutation();

    // Mutations and contextual values change identity each render; mirror them through
    // refs so the session dispatcher can stay stable and avoid stale closures.
    const mutationsRef = useRef({ start: startSession, complete: completeSession, cancel: cancelSession });
    mutationsRef.current = { start: startSession, complete: completeSession, cancel: cancelSession };
    const contextRef = useRef({ mode: currentMode, trackId: currentTrack?.id ?? null });
    contextRef.current = { mode: currentMode, trackId: currentTrack?.id ?? null };

    // Single entry point for the focus-session lifecycle: feed an event to the pure
    // reducer, persist the next state, and execute the resulting API command.
    const dispatchSession = useCallback((event: FocusSessionEvent) => {
        const { state, command } = focusSessionReducer(sessionStateRef.current, event);
        sessionStateRef.current = state;

        const { start, complete, cancel } = mutationsRef.current;
        switch (command.type) {
            case 'START_SESSION':
                start.mutate(
                    {
                        mode: contextRef.current.mode,
                        plannedDurationSeconds: command.plannedSeconds,
                        trackId: contextRef.current.trackId,
                    },
                    {
                        onSuccess: (session) => {
                            activeSessionIdRef.current = session.id;
                        },
                    },
                );
                break;
            case 'COMPLETE_SESSION':
                if (activeSessionIdRef.current) {
                    complete.mutate(
                        { id: activeSessionIdRef.current, elapsedSeconds: command.elapsedSeconds },
                        {
                            // A null result means no row was recorded (already completed, or
                            // truly gone) — surface it instead of silently dropping the time.
                            onSuccess: (session) => {
                                if (!session) {
                                    toast.warning("Couldn't save your focus time", {
                                        description: 'This session may have been replaced in another tab.',
                                    });
                                }
                            },
                        },
                    );
                    activeSessionIdRef.current = null;
                }
                break;
            case 'CANCEL_SESSION':
                if (activeSessionIdRef.current) {
                    cancel.mutate({ id: activeSessionIdRef.current });
                    activeSessionIdRef.current = null;
                }
                break;
            default:
                break;
        }
    }, []);

    useEffect(() => {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }

        if (timerActive) {
            timerIntervalRef.current = setInterval(() => {
                decrementTimer();
            }, 1000);
        }

        return () => {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }
        };
    }, [timerActive, decrementTimer]);

    // Translate timer-state transitions into focus-session lifecycle events. A "focus
    // phase" is any running focus countdown — finite or infinite focus mode, or a
    // Pomodoro focus block (not a break).
    useEffect(() => {
        const isFocusPhase = timerMode === 'focus' || (timerMode === 'pomodoro' && !pomodoroSettings.isBreak);
        const focusRunning = timerActive && isFocusPhase;
        const wasRunning = prevFocusRunningRef.current;
        const now = Date.now();

        if (!wasRunning && focusRunning) {
            if (sessionStateRef.current.status === 'paused') {
                dispatchSession({ type: 'RESUME', atMs: now });
            } else {
                const isInfinite = selectedPreset === '∞';
                if (isInfinite || timerSeconds >= MIN_RECORDED_SECONDS) {
                    dispatchSession({ type: 'START', plannedSeconds: isInfinite ? 0 : timerSeconds, atMs: now });
                }
            }
        } else if (wasRunning && !focusRunning) {
            if (timerActive) {
                // Still active but no longer a focus phase → Pomodoro focus rolled into a
                // break: the focus block finished.
                dispatchSession({ type: 'COMPLETE', atMs: now });
            } else if (timerMode === 'focus' && timerSeconds === 0) {
                // Finite focus countdown reached zero.
                dispatchSession({ type: 'COMPLETE', atMs: now });
            } else {
                // Timer paused by the user; keep the session resumable.
                dispatchSession({ type: 'PAUSE', atMs: now });
            }
        }

        prevFocusRunningRef.current = focusRunning;
    }, [timerActive, timerMode, pomodoroSettings.isBreak, timerSeconds, selectedPreset, dispatchSession]);

    // Best-effort flush when the tab is being closed/navigated away mid-session so the
    // focus time isn't silently lost. (Hard closes may not always deliver the request.)
    useEffect(() => {
        const handlePageHide = () => {
            if (sessionStateRef.current.status === 'idle' || !activeSessionIdRef.current) {
                return;
            }
            dispatchSession({ type: 'COMPLETE', atMs: Date.now() });
        };
        window.addEventListener('pagehide', handlePageHide);
        return () => window.removeEventListener('pagehide', handlePageHide);
    }, [dispatchSession]);

    // Notify on focus-countdown completion (finite focus reaching 0:00). Infinite focus
    // (selectedPreset '∞', which also sets timerSeconds to 0) is excluded so selecting it
    // doesn't read as a completion. Gated by the showNotifications preference + permission.
    useEffect(() => {
        const prevSeconds = prevTimerSecondsRef.current;
        prevTimerSecondsRef.current = timerSeconds;

        if (!showNotificationsPref) return;
        if (timerMode === 'focus' && selectedPreset !== '∞' && prevSeconds > 0 && timerSeconds === 0) {
            showTimerNotification('Focus session complete', 'Nice work — time to step away for a bit.');
        }
    }, [timerSeconds, timerMode, selectedPreset, showNotificationsPref]);

    // Notify on Pomodoro phase changes. `isBreak` only flips via advancePomodoroPhase
    // (a real phase boundary), so watching it covers focus→break and break→focus.
    useEffect(() => {
        const prevIsBreak = prevIsBreakRef.current;
        prevIsBreakRef.current = pomodoroSettings.isBreak;

        if (prevIsBreak === pomodoroSettings.isBreak) return;
        if (!showNotificationsPref || timerMode !== 'pomodoro') return;

        if (pomodoroSettings.isBreak) {
            showTimerNotification('Break time', 'Focus block done — take your break.');
        } else {
            showTimerNotification('Back to focus', 'Break over — back into the flow.');
        }
    }, [pomodoroSettings.isBreak, showNotificationsPref, timerMode]);

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

    const handleSetCustomTime = () => {
        const hours = parseInt(customHours) || 0;
        const mins = parseInt(customMins) || 0;
        const totalMinutes = hours * 60 + mins;

        if (totalMinutes > 0) {
            setCustomTime(totalMinutes.toString());
            setCustomOpen(false);
        }
    };

    const handleTimerModeChange = (mode: TimerMode) => {
        if (timerActive) {
            pauseTimer();
        }
        // Switching timer modes abandons any in-flight focus block (focus or Pomodoro).
        dispatchSession({ type: 'CANCEL' });
        setTimerMode(mode);
    };

    const isInfinite = timerMode === 'focus' && selectedPreset === '∞';
    const isBreak = timerMode === 'pomodoro' && pomodoroSettings.isBreak;

    // The full duration of the current phase, for the progress ring.
    const totalSeconds = (() => {
        if (timerMode === 'focus') {
            const minutes = presetToMinutes(selectedPreset, customMinutes);
            return minutes === null ? null : minutes * 60;
        }
        const minutes = pomodoroSettings.isBreak
            ? pomodoroSettings.currentSession === pomodoroSettings.sessionsBeforeLongBreak
                ? pomodoroSettings.longBreakMinutes
                : pomodoroSettings.breakMinutes
            : pomodoroSettings.focusMinutes;
        return minutes * 60;
    })();
    const ringProgress =
        totalSeconds && totalSeconds > 0 ? Math.min(Math.max(1 - timerSeconds / totalSeconds, 0), 1) : 0;

    const circumference = 2 * Math.PI * 49;

    const phaseLabel =
        timerMode === 'pomodoro'
            ? `${pomodoroSettings.isBreak ? 'Break' : 'Focus'} ${pomodoroSettings.currentSession}/${pomodoroSettings.sessionsBeforeLongBreak}`
            : isInfinite
              ? 'Open-ended focus'
              : `${selectedPreset} focus block`;

    return (
        <div className="relative z-20 flex h-full w-full flex-col items-center justify-center rounded-full">
            {/* Progress ring hugging the circle's border */}
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-1 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="49" fill="none" strokeWidth="0.8" stroke="oklch(1 0 0 / 0.07)" />
                <circle
                    cx="50"
                    cy="50"
                    r="49"
                    fill="none"
                    strokeWidth="0.8"
                    className={cn('transition-[stroke-dashoffset] duration-1000 ease-linear', {
                        'stroke-ember': !isBreak && !isInfinite,
                        'stroke-ink-mid': isBreak,
                        'stroke-ember/35': isInfinite,
                    })}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={isInfinite ? 0 : circumference * (1 - ringProgress)}
                />
            </svg>

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

            <p className="mt-5 text-[11px] tracking-[0.2em] text-ink-dim uppercase">{phaseLabel}</p>

            <div className="mt-1 text-6xl font-medium tabular-nums text-ink sm:text-7xl" role="timer" aria-live="off">
                {isInfinite ? '∞' : formatTime(timerSeconds)}
            </div>

            <div className="mt-6 flex items-center gap-4">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full border-white/15 bg-black/40 hover:bg-white/10"
                    onClick={() => {
                        dispatchSession({ type: 'CANCEL' });
                        resetTimer();
                    }}
                    aria-label="Reset timer"
                >
                    <RefreshCcw size={15} />
                </Button>

                <Button
                    onClick={handleToggleTimer}
                    className="h-14 w-14 rounded-full bg-ember text-night shadow-[0_0_40px_-10px_oklch(0.81_0.1_75/0.7)] hover:bg-ember/90"
                    aria-label={timerActive ? 'Pause timer' : 'Start timer'}
                >
                    {timerActive ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
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
                            <div className="space-y-1">
                                <label htmlFor={focusMinutesId} className="text-xs text-neutral-400">
                                    Focus (minutes)
                                </label>
                                <Input
                                    id={focusMinutesId}
                                    type="number"
                                    value={pomodoroSettings.focusMinutes}
                                    onChange={(e) =>
                                        updatePomodoroSettings({ focusMinutes: parseInt(e.target.value) || 25 })
                                    }
                                    className="h-7 bg-transparent"
                                    min="1"
                                    max="60"
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor={breakMinutesId} className="text-xs text-neutral-400">
                                    Break (minutes)
                                </label>
                                <Input
                                    id={breakMinutesId}
                                    type="number"
                                    value={pomodoroSettings.breakMinutes}
                                    onChange={(e) =>
                                        updatePomodoroSettings({ breakMinutes: parseInt(e.target.value) || 5 })
                                    }
                                    className="h-7 bg-transparent"
                                    min="1"
                                    max="30"
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor={longBreakMinutesId} className="text-xs text-neutral-400">
                                    Long break (minutes)
                                </label>
                                <Input
                                    id={longBreakMinutesId}
                                    type="number"
                                    value={pomodoroSettings.longBreakMinutes}
                                    onChange={(e) =>
                                        updatePomodoroSettings({ longBreakMinutes: parseInt(e.target.value) || 15 })
                                    }
                                    className="h-7 bg-transparent"
                                    min="1"
                                    max="60"
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor={sessionsId} className="text-xs text-neutral-400">
                                    Sessions before long break
                                </label>
                                <Input
                                    id={sessionsId}
                                    type="number"
                                    value={pomodoroSettings.sessionsBeforeLongBreak}
                                    onChange={(e) =>
                                        updatePomodoroSettings({
                                            sessionsBeforeLongBreak: parseInt(e.target.value) || 4,
                                        })
                                    }
                                    className="h-7 bg-transparent"
                                    min="1"
                                    max="10"
                                />
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <DropdownMenu open={customOpen} onOpenChange={setCustomOpen}>
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
                            <div className="mb-2 text-xs text-neutral-300">Custom duration</div>
                            <div className="flex items-end gap-2">
                                <div className="flex flex-col">
                                    <label htmlFor={customHoursId} className="mb-1 text-xs text-neutral-400">
                                        Hours
                                    </label>
                                    <Input
                                        id={customHoursId}
                                        value={customHours}
                                        onChange={(e) => setCustomHours(e.target.value)}
                                        className="h-7 w-16 bg-transparent"
                                        type="number"
                                        min="0"
                                        max="12"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label htmlFor={customMinsId} className="mb-1 text-xs text-neutral-400">
                                        Minutes
                                    </label>
                                    <Input
                                        id={customMinsId}
                                        value={customMins}
                                        onChange={(e) => setCustomMins(e.target.value)}
                                        className="h-7 w-16 bg-transparent"
                                        type="number"
                                        min="0"
                                        max="59"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => {
                                        e.stopPropagation();
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
                <div className="mt-6 flex items-center gap-1.5" role="group" aria-label="Timer presets">
                    {FOCUS_PRESETS.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => setTimerPreset(preset)}
                            aria-pressed={selectedPreset === preset}
                            className={cn(
                                'min-w-10 rounded-full border px-2.5 py-1 text-xs transition',
                                selectedPreset === preset
                                    ? 'border-ember/50 bg-ember/15 text-ember'
                                    : 'border-white/10 text-ink-mid hover:border-white/25 hover:text-ink',
                            )}
                        >
                            {preset}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="mt-6 flex items-center gap-2 text-xs" aria-label="Pomodoro cadence">
                    <span
                        className={cn(
                            'rounded-full border px-3 py-1',
                            !pomodoroSettings.isBreak
                                ? 'border-ember/50 bg-ember/15 text-ember'
                                : 'border-white/10 text-ink-dim',
                        )}
                    >
                        Focus {pomodoroSettings.focusMinutes}m
                    </span>
                    <span
                        className={cn(
                            'rounded-full border px-3 py-1',
                            pomodoroSettings.isBreak
                                ? 'border-white/40 bg-white/10 text-ink'
                                : 'border-white/10 text-ink-dim',
                        )}
                    >
                        Break {pomodoroSettings.breakMinutes}m
                    </span>
                </div>
            )}
        </div>
    );
};
