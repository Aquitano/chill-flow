/**
 * Integration tests for the wiring that records focus time: TimerDial driving the
 * lifecycle reducer, the recorder, and the sessions API through real react-query
 * mutations. The store, reducer, and hooks are all real; only `api` is mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
    preferences: {
        get: vi.fn(),
    },
    sessions: {
        start: vi.fn(),
        complete: vi.fn(),
        completeCycle: vi.fn(),
        cancel: vi.fn(),
        recover: vi.fn(),
    },
    tasks: {
        update: vi.fn(),
    },
}));

vi.mock('@/lib/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/api')>();
    return { ...actual, api: mockApi };
});

import { TimerDial } from '@/components/app/TimerDial';
import { TestBroadcastChannel } from '@/test/fake-broadcast-channel';
import type { UserPreferences } from '@/models/app';
import { useAppStore } from '@/store/app-store';

const initialStoreState = useAppStore.getState();

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
    selectedTrackId: null,
    selectedBackgroundId: null,
    likedTrackIds: [],
};

function renderDial() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <TimerDial />
        </QueryClientProvider>,
    );
}

/** Flush pending microtasks (query/mutation settlement) under fake timers. */
async function flush() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
}

async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('the focus block lifecycle, dial to API', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T09:00:00Z'));
        vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
        useAppStore.setState(initialStoreState, true);

        mockApi.preferences.get.mockResolvedValue({ preferences, backgrounds: [], quotes: [] });
        mockApi.sessions.start.mockResolvedValue({ id: 'session-1' });
        mockApi.sessions.complete.mockResolvedValue({ id: 'session-1' });
        mockApi.sessions.cancel.mockResolvedValue({ id: 'session-1' });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        TestBroadcastChannel.buses.clear();
    });

    it('records a block that runs to completion', async () => {
        renderDial();
        await flush();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await flush();

        expect(mockApi.sessions.start).toHaveBeenCalledWith({
            mode: 'DeepWork',
            timerKind: 'focus',
            plannedDurationSeconds: 25 * 60,
            trackId: null,
            taskId: null,
        });

        await advance(25 * 60 * 1000 + 1000);

        expect(mockApi.sessions.complete).toHaveBeenCalledTimes(1);
        expect(mockApi.sessions.complete).toHaveBeenCalledWith({ id: 'session-1', elapsedSeconds: 25 * 60 });
        expect(useAppStore.getState().timerActive).toBe(false);
        expect(useAppStore.getState().timerSeconds).toBe(0);
    });

    it('spans a pause without opening a second session', async () => {
        renderDial();
        await flush();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await flush();
        await advance(5 * 60 * 1000);

        fireEvent.click(screen.getByLabelText('Pause timer'));
        // Ten minutes away from the desk count for nothing.
        await advance(10 * 60 * 1000);
        expect(mockApi.sessions.complete).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await advance(20 * 60 * 1000 + 1000);

        expect(mockApi.sessions.start).toHaveBeenCalledTimes(1);
        expect(mockApi.sessions.complete).toHaveBeenCalledTimes(1);
        expect(mockApi.sessions.complete).toHaveBeenCalledWith({ id: 'session-1', elapsedSeconds: 25 * 60 });
    });

    it('cancels a block reset before it earned a recordable minute', async () => {
        renderDial();
        await flush();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await flush();
        await advance(30 * 1000);

        fireEvent.click(screen.getByLabelText('Reset timer'));
        await flush();

        expect(mockApi.sessions.cancel).toHaveBeenCalledWith({ id: 'session-1' });
        expect(mockApi.sessions.complete).not.toHaveBeenCalled();
    });

    it('banks the block and stops when another tab takes the focus over', async () => {
        renderDial();
        await flush();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await flush();
        await advance(10 * 60 * 1000);

        const otherTab = new TestBroadcastChannel('chillflow:focus');
        act(() => {
            otherTab.postMessage({ type: 'focus-started' });
        });
        await flush();

        expect(mockApi.sessions.complete).toHaveBeenCalledWith({ id: 'session-1', elapsedSeconds: 10 * 60 });
        expect(useAppStore.getState().timerActive).toBe(false);
    });

    it('claims its session row when another tab asks who owns it', async () => {
        const { askSessionOwner } = await import('@/lib/focus-channel');

        renderDial();
        await flush();

        fireEvent.click(screen.getByLabelText('Start timer'));
        await flush();

        const owned = askSessionOwner('session-1');
        await flush();
        await expect(owned).resolves.toBe(true);

        const unclaimed = askSessionOwner('some-other-session');
        await advance(500);
        await expect(unclaimed).resolves.toBe(false);
    });
});
