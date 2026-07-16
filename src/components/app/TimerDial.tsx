'use client';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { motion } from 'framer-motion';
import {
    Clock,
    Hourglass,
    Infinity as InfinityIcon,
    Pause,
    Play,
    RefreshCcw,
    Settings,
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
    { label: '∞', icon: InfinityIcon },
];

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

    const phaseLabel =
        timerMode === 'pomodoro'
            ? `${pomodoroSettings.isBreak ? 'Break' : 'Focus'} ${pomodoroSettings.currentSession}/${pomodoroSettings.sessionsBeforeLongBreak}`
            : isInfinite
              ? 'Open-ended focus'
              : `${selectedPreset} focus block`;

    return (
        <div className="relative z-20 flex h-full w-full flex-col items-center justify-center rounded-full">
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-1" aria-hidden>
                {TICKS.map((tick, index) => {
                    const lit = isInfinite || index / TICK_COUNT < ringProgress;
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
                                'text-ember': lit && !isBreak && !isInfinite,
                                'text-ink-mid': lit && isBreak,
                                'text-ember/30': lit && isInfinite,
                                'text-white/10': !lit,
                            })}
                        />
                    );
                })}
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

            <p className="text-ink-dim mt-5 text-[11px] tracking-[0.2em] uppercase">{phaseLabel}</p>

            <motion.div
                key={`${timerMode}-${selectedPreset}`}
                initial={{ scale: 0.94, opacity: 0.4 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                className="text-ink mt-1 text-6xl font-medium tabular-nums sm:text-7xl"
                role="timer"
                aria-live="off"
            >
                {isInfinite ? '∞' : formatTime(timerSeconds)}
            </motion.div>

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
                            <div className="space-y-1">
                                <label htmlFor={focusMinutesId} className="text-ink-dim text-xs">
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
                                <label htmlFor={breakMinutesId} className="text-ink-dim text-xs">
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
                                <label htmlFor={longBreakMinutesId} className="text-ink-dim text-xs">
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
                                <label htmlFor={sessionsId} className="text-ink-dim text-xs">
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
                            <div className="text-ink-mid mb-2 text-xs">Custom duration</div>
                            <div className="flex items-end gap-2">
                                <div className="flex flex-col">
                                    <label htmlFor={customHoursId} className="text-ink-dim mb-1 text-xs">
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
                                    <label htmlFor={customMinsId} className="text-ink-dim mb-1 text-xs">
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
                                aria-label={preset.label === '∞' ? 'Open-ended focus' : `${preset.label} focus block`}
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
                                    {preset.label !== '∞' && preset.label}
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
                </div>
            )}
        </div>
    );
};
