'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useSessionCompleteMutation, useSessionStartMutation } from '@/hooks/use-app-data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimerMode, useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { ChevronDown, Clock, Pause, Play, RefreshCcw, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export const TimerPanel: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);

    const timerMode = useAppStore((state) => state.timerMode);
    const timerSeconds = useAppStore((state) => state.timerSeconds);
    const timerActive = useAppStore((state) => state.timerActive);
    const selectedPreset = useAppStore((state) => state.selectedPreset);
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

    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const activeSessionIdRef = useRef<string | null>(null);
    const previousTimerActiveRef = useRef(false);

    const [customHours, setCustomHours] = useState('0');
    const [customMins, setCustomMins] = useState('25');
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const startSession = useSessionStartMutation();
    const completeSession = useSessionCompleteMutation();

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

    useEffect(() => {
        if (timerActive && !previousTimerActiveRef.current && timerMode === 'focus' && !activeSessionIdRef.current) {
            startSession.mutate(
                {
                    mode: currentMode,
                    durationSeconds: timerSeconds,
                    trackId: currentTrack?.id ?? null,
                },
                {
                    onSuccess: (session) => {
                        activeSessionIdRef.current = session.id;
                    },
                },
            );
        }

        if (!timerActive && previousTimerActiveRef.current && timerMode === 'focus' && timerSeconds === 0) {
            if (activeSessionIdRef.current) {
                completeSession.mutate({
                    id: activeSessionIdRef.current,
                    durationSeconds: selectedPreset === '∞' ? 0 : timerSeconds,
                });
                activeSessionIdRef.current = null;
            }
        }

        if (!timerActive && timerSeconds > 0 && !startSession.isPending) {
            activeSessionIdRef.current = null;
        }

        previousTimerActiveRef.current = timerActive;
    }, [
        completeSession,
        currentMode,
        currentTrack?.id,
        selectedPreset,
        startSession,
        timerActive,
        timerMode,
        timerSeconds,
    ]);

    const formatTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const focusPresetTimes = [
        { label: '15m', minutes: 15 },
        { label: '25m', minutes: 25 },
        { label: '45m', minutes: 45 },
        { label: '60m', minutes: 60 },
        { label: '∞', minutes: 0 },
    ];

    const pomodoroPresetTimes = [
        { label: '15m', minutes: 15 },
        { label: '25m', minutes: 25 },
        { label: '45m', minutes: 45 },
        { label: '60m', minutes: 60 },
    ];

    const handleSetCustomTime = () => {
        const hours = parseInt(customHours) || 0;
        const mins = parseInt(customMins) || 0;
        const totalMinutes = hours * 60 + mins;

        if (totalMinutes > 0) {
            setCustomTime(totalMinutes.toString());
            setTimeout(() => setDropdownOpen(false), 300);
        }
    };

    const handleTimerModeChange = (mode: TimerMode) => {
        if (timerActive) {
            pauseTimer();
        }

        setTimerMode(mode);

        if (dropdownOpen) {
            setDropdownOpen(false);
        }
    };

    const showTimer = modes[currentMode]?.showTimer ?? false;
    if (!showTimer) return null;

    return (
        <motion.aside
            key="timer-panel"
            className="absolute top-24 right-6 z-20 w-72 rounded-md bg-black/70 p-4 shadow-lg"
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 50, opacity: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center text-lg font-semibold">
                    <Clock className="mr-2 h-5 w-5" /> Timer
                </h3>
            </div>

            <Tabs defaultValue="focus" value={timerMode} onValueChange={(v) => handleTimerModeChange(v as TimerMode)}>
                <div className="mb-4 flex justify-end">
                    <TabsList className="h-7 bg-black/50">
                        <TabsTrigger value="focus" className="h-6 px-3 text-xs">
                            Focus
                        </TabsTrigger>
                        <TabsTrigger value="pomodoro" className="h-6 px-3 text-xs">
                            Pomodoro
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="focus" className="mt-0 space-y-4">
                    <div className="flex flex-col items-center justify-center py-3">
                        <div className="text-5xl font-medium tabular-nums">
                            {selectedPreset === '∞' ? '∞' : formatTime(timerSeconds)}
                        </div>

                        <div className="mt-4 flex items-center space-x-3">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 rounded-full border-white/20 bg-black/40"
                                onClick={resetTimer}
                            >
                                <RefreshCcw size={16} />
                            </Button>

                            <Button
                                onClick={() => {
                                    if (timerActive) {
                                        pauseTimer();
                                    } else {
                                        startTimer();
                                    }
                                }}
                                className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30"
                            >
                                {timerActive ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                            </Button>

                            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="border-white/20 bg-black/40">
                                        {selectedPreset}
                                        <ChevronDown size={14} className="ml-1 opacity-70" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-black/90 backdrop-blur-md">
                                    {focusPresetTimes.map((preset) => (
                                        <DropdownMenuItem
                                            key={preset.label}
                                            onClick={() => setTimerPreset(preset.label)}
                                            className={selectedPreset === preset.label ? 'bg-white/10' : ''}
                                        >
                                            {preset.label}
                                        </DropdownMenuItem>
                                    ))}

                                    <div className="border-t border-white/10 p-2">
                                        <div className="mb-2 text-xs text-neutral-300">Custom Duration</div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex flex-col">
                                                <label className="mb-1 text-xs text-neutral-400">Hours</label>
                                                <Input
                                                    value={customHours}
                                                    onChange={(e) => setCustomHours(e.target.value)}
                                                    className="h-7 w-full bg-transparent"
                                                    type="number"
                                                    min="0"
                                                    max="12"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                            <div className="flex flex-col">
                                                <label className="mb-1 text-xs text-neutral-400">Minutes</label>
                                                <Input
                                                    value={customMins}
                                                    onChange={(e) => setCustomMins(e.target.value)}
                                                    className="h-7 w-full bg-transparent"
                                                    type="number"
                                                    min="0"
                                                    max="59"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="mt-auto"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSetCustomTime();
                                                }}
                                            >
                                                Set
                                            </Button>
                                        </div>
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="pomodoro" className="mt-0 space-y-4">
                    <div className="flex flex-col items-center justify-center py-3">
                        <div className="mb-2 text-center text-xs text-neutral-400">
                            {pomodoroSettings.isBreak
                                ? `Break ${pomodoroSettings.currentSession}/${pomodoroSettings.sessionsBeforeLongBreak}`
                                : `Focus ${pomodoroSettings.currentSession}/${pomodoroSettings.sessionsBeforeLongBreak}`}
                        </div>

                        <div className="text-5xl font-medium tabular-nums">{formatTime(timerSeconds)}</div>

                        <div className="mt-4 flex items-center space-x-3">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 rounded-full border-white/20 bg-black/40"
                                onClick={resetTimer}
                            >
                                <RefreshCcw size={16} />
                            </Button>

                            <Button
                                onClick={() => {
                                    if (timerActive) {
                                        pauseTimer();
                                    } else {
                                        startTimer();
                                    }
                                }}
                                className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30"
                            >
                                {timerActive ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="border-white/20 bg-black/40" size="icon">
                                        <Settings size={16} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="space-y-2 bg-black/90 p-3 backdrop-blur-md">
                                    <div className="space-y-1">
                                        <label htmlFor={focusMinutesId} className="text-xs text-neutral-400">
                                            Focus (minutes)
                                        </label>
                                        <Input
                                            id={focusMinutesId}
                                            type="number"
                                            value={pomodoroSettings.focusMinutes}
                                            onChange={(e) =>
                                                updatePomodoroSettings({
                                                    focusMinutes: parseInt(e.target.value) || 25,
                                                })
                                            }
                                            className="h-6 bg-transparent"
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
                                                updatePomodoroSettings({
                                                    breakMinutes: parseInt(e.target.value) || 5,
                                                })
                                            }
                                            className="h-6 bg-transparent"
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
                                                updatePomodoroSettings({
                                                    longBreakMinutes: parseInt(e.target.value) || 15,
                                                })
                                            }
                                            className="h-6 bg-transparent"
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
                                            className="h-6 bg-transparent"
                                            min="1"
                                            max="10"
                                        />
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <div className="mt-4 grid w-full grid-cols-2 gap-2 text-center text-xs">
                            <div
                                className={`rounded border border-white/10 p-2 ${!pomodoroSettings.isBreak ? 'bg-neutral-700/30' : 'bg-black/30'}`}
                            >
                                <div className="text-neutral-400">Focus</div>
                                <div>{pomodoroSettings.focusMinutes}m</div>
                            </div>
                            <div
                                className={`rounded border border-white/10 p-2 ${pomodoroSettings.isBreak ? 'bg-neutral-700/30' : 'bg-black/30'}`}
                            >
                                <div className="text-neutral-400">Break</div>
                                <div>{pomodoroSettings.breakMinutes}m</div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 flex items-center justify-center">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="border-white/20 bg-black/40">
                                    Presets
                                    <ChevronDown size={14} className="ml-1 opacity-70" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center" className="bg-black/90 backdrop-blur-md">
                                {pomodoroPresetTimes.map((preset) => (
                                    <DropdownMenuItem key={preset.label} onClick={() => setTimerPreset(preset.label)}>
                                        {preset.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </TabsContent>
            </Tabs>
        </motion.aside>
    );
};
