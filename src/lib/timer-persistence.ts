'use client';

import type { TimerSnapshot } from '@/store/app-store';

const STORAGE_KEY = 'chillflow:timer';

/**
 * Beyond this the snapshot describes a session the user has long since walked away from;
 * reopening the workspace the next morning should start clean, not resume yesterday.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isSnapshot(value: unknown): value is TimerSnapshot {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
        candidate.version === 1 &&
        typeof candidate.savedAt === 'number' &&
        (candidate.timerMode === 'focus' || candidate.timerMode === 'pomodoro') &&
        typeof candidate.selectedPreset === 'string' &&
        typeof candidate.openEnded === 'boolean' &&
        typeof candidate.wasRunning === 'boolean' &&
        typeof candidate.remainingSeconds === 'number' &&
        typeof candidate.elapsedSeconds === 'number' &&
        typeof candidate.pomodoroSession === 'number' &&
        typeof candidate.pomodoroIsBreak === 'boolean'
    );
}

export function readTimerSnapshot(nowMs: number = Date.now()): TimerSnapshot | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isSnapshot(parsed) || nowMs - parsed.savedAt > MAX_AGE_MS) return null;
        return parsed;
    } catch {
        // Malformed or unavailable storage: fall back to a fresh timer.
        return null;
    }
}

export function writeTimerSnapshot(snapshot: TimerSnapshot): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // Ignore storage write failures (private mode, quota, etc.).
    }
}
