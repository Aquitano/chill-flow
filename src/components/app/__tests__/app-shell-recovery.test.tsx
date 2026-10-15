/**
 * Integration tests for AppShell's hydrate-and-recover path: a crash (or killed tab)
 * leaves a session row open and a snapshot in localStorage; the next load must restore
 * the dial paused and settle that row with only the focus time the device can prove —
 * unless another tab still owns it. Store and hooks are real; api and the child
 * components are mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
    preferences: {
        get: vi.fn(),
        update: vi.fn(),
    },
    tracks: {
        list: vi.fn(),
    },
    tasks: {
        list: vi.fn(),
    },
    sessions: {
        list: vi.fn(),
        recover: vi.fn(),
    },
}));

vi.mock('@/lib/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/api')>();
    return { ...actual, api: mockApi };
});

// The shell's own hydration logic is under test, not the workspace it mounts.
vi.mock('@/components/app/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/components/app/CenterContent', () => ({ CenterContent: () => null }));
vi.mock('@/components/app/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/app/PlayerDock', () => ({ PlayerDock: () => null }));
vi.mock('@/components/app/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { AppShell } from '@/components/app/AppShell';
import { TestBroadcastChannel } from '@/test/fake-broadcast-channel';
import type { Track, UserPreferences } from '@/models/app';
import type { TimerSnapshot } from '@/store/app-store';
import { useAppStore } from '@/store/app-store';

const initialStoreState = useAppStore.getState();

const track: Track = {
    id: 'track-1',
    title: 'Rain on glass',
    artist: 'Test',
    audioUrl: '/audio/rain.mp3',
    duration: 120,
    tags: [],
    category: 'nature',
};

const preferences: UserPreferences = {
    defaultMode: 'DeepWork',
    volume: 50,
    showNotifications: false,
    timerSound: false,
    timerMode: 'focus',
    timerPreset: '25m',
    customMinutes: '25',
    pomodoroSettings: {
        focusMinutes: 25,
        breakMinutes: 5,
        longBreakMinutes: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: true,
        autoStartFocus: true,
    },
    selectedTrackId: 'track-1',
    selectedBackgroundId: null,
    likedTrackIds: [],
};

/** A crash 20 minutes into a 25m block: the unload flush never ran, the row is open. */
function crashedSnapshot(nowMs: number): TimerSnapshot {
    return {
        version: 2,
        savedAt: nowMs - 60_000,
        timerMode: 'focus',
        selectedPreset: '25m',
        openEnded: false,
        wasRunning: true,
        remainingSeconds: 5 * 60,
        elapsedSeconds: 0,
        pomodoroSession: 1,
        pomodoroIsBreak: false,
        sessionId: 'session-9',
    };
}

function renderShell() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <AppShell />
        </QueryClientProvider>,
    );
}

async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('crash recovery on workspace load', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T09:00:00Z'));
        vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
        useAppStore.setState(initialStoreState, true);

        localStorage.setItem('chillflow:timer', JSON.stringify(crashedSnapshot(Date.now())));

        mockApi.preferences.get.mockResolvedValue({ preferences, backgrounds: [], quotes: [] });
        mockApi.tracks.list.mockResolvedValue([track]);
        mockApi.tasks.list.mockResolvedValue([]);
        mockApi.sessions.list.mockResolvedValue({
            summary: { totalSessions: 0, totalMinutes: 0, completedCycles: 0, currentStreak: 0 },
        });
        mockApi.sessions.recover.mockResolvedValue({ outcome: 'completed', elapsedSeconds: 20 * 60 });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        TestBroadcastChannel.buses.clear();
    });

    it('restores the dial paused and settles the abandoned row with proven time', async () => {
        const savedAt = Date.now() - 60_000;
        renderShell();

        // Queries resolve, hydration runs, and the ownership query times out unclaimed.
        await advance(500);

        expect(useAppStore.getState().timerActive).toBe(false);
        expect(useAppStore.getState().timerSeconds).toBe(5 * 60);

        expect(mockApi.sessions.recover).toHaveBeenCalledWith({
            id: 'session-9',
            elapsedSeconds: 20 * 60,
            savedAtMs: savedAt,
        });
    });

    it('leaves a row alone while another tab still owns it', async () => {
        const otherTab = new TestBroadcastChannel('chillflow:focus');
        otherTab.onmessage = ({ data }) => {
            const message = data as { type?: string; sessionId?: string };
            if (message.type === 'owner-query' && message.sessionId === 'session-9') {
                otherTab.postMessage({ type: 'owner-claim', sessionId: 'session-9' });
            }
        };

        renderShell();
        await advance(500);

        // The dial still restores for this tab; the open row is not touched.
        expect(useAppStore.getState().timerSeconds).toBe(5 * 60);
        expect(mockApi.sessions.recover).not.toHaveBeenCalled();
    });

    it('starts clean when there is no snapshot', async () => {
        localStorage.removeItem('chillflow:timer');

        renderShell();
        await advance(500);

        expect(useAppStore.getState().timerSeconds).toBe(25 * 60);
        expect(mockApi.sessions.recover).not.toHaveBeenCalled();
    });
});
