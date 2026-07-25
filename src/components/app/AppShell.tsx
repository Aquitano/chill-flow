'use client';

import { AppHeader } from '@/components/app/AppHeader';
import { Button } from '@/components/ui/button';
import { CenterContent } from '@/components/app/CenterContent';
import { CommandPalette } from '@/components/app/CommandPalette';
import { PlayerDock } from '@/components/app/PlayerDock';
import { SettingsDialog } from '@/components/app/SettingsDialog';
import {
    usePreferencesQuery,
    useSessionRecoverMutation,
    useSessionsQuery,
    useTracksQuery,
    useUpdatePreferencesMutation,
    useTasksQuery,
} from '@/hooks/use-app-data';
import { selectQuoteForMode } from '@/lib/quotes';
import { readTimerSnapshot } from '@/lib/timer-persistence';
import { useWorkspaceHotkeys } from '@/hooks/use-workspace-hotkeys';
import { PomodoroCadence, TimerMode, TimerSnapshot, phaseDurationSeconds, useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const PREFERENCES_PERSIST_DEBOUNCE_MS = 800;

type WorkspacePersistPayload = {
    defaultMode: string;
    selectedBackgroundId: string | null;
    selectedTrackId: string;
    likedTrackIds: string[];
    volume: number;
    timerMode: TimerMode;
    timerPreset: string;
    customMinutes: string;
    pomodoroSettings: PomodoroCadence;
};

/**
 * Focus seconds this device can vouch for from its last snapshot: what the countdown had
 * already burned through, or the time an open-ended block had counted up. Call it after
 * restoreTimer, once the store holds the phase the snapshot describes.
 */
function provenFocusSeconds(snapshot: TimerSnapshot): number {
    if (snapshot.openEnded) {
        return snapshot.elapsedSeconds;
    }

    const phaseSeconds = phaseDurationSeconds(useAppStore.getState()) ?? 0;
    return Math.max(0, phaseSeconds - snapshot.remainingSeconds);
}

export function AppShell() {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const likedTrackIds = useAppStore((state) => state.likedTrackIds);
    const selectedBackgroundId = useAppStore((state) => state.selectedBackgroundId);
    const backgrounds = useAppStore((state) => state.backgrounds);
    const volume = useAppStore((state) => state.volume);
    const timerMode = useAppStore((state) => state.timerMode);
    const selectedPreset = useAppStore((state) => state.selectedPreset);
    const customMinutes = useAppStore((state) => state.customMinutes);
    const pomodoroSettings = useAppStore((state) => state.pomodoroSettings);

    const setTracks = useAppStore((state) => state.setTracks);
    const setTasks = useAppStore((state) => state.setTasks);
    const setBackgrounds = useAppStore((state) => state.setBackgrounds);
    const setSelectedBackgroundId = useAppStore((state) => state.setSelectedBackgroundId);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setLikedTrackIds = useAppStore((state) => state.setLikedTrackIds);
    const setSessionSummary = useAppStore((state) => state.setSessionSummary);
    const setMode = useAppStore((state) => state.setMode);
    const setCurrentQuote = useAppStore((state) => state.setCurrentQuote);
    const hydratePreferences = useAppStore((state) => state.hydratePreferences);
    const restoreTimer = useAppStore((state) => state.restoreTimer);

    const searchParams = useSearchParams();
    const tracksQuery = useTracksQuery();
    const tasksQuery = useTasksQuery();
    const preferencesQuery = usePreferencesQuery();
    const sessionsQuery = useSessionsQuery();
    const updatePreferences = useUpdatePreferencesMutation();
    const recoverSession = useSessionRecoverMutation();

    useWorkspaceHotkeys();

    const didHydratePreferences = useRef(false);
    // The workspace only mounts once this flips, so the timer dial never renders against
    // un-hydrated defaults — and the restored dial is in place before its effects run.
    const [isHydrated, setIsHydrated] = useState(false);
    const lastPersistedPreferencesRef = useRef('');
    const savingPreferencesRef = useRef<string | null>(null);
    const availableQuotes = preferencesQuery.data?.quotes ?? [];

    useEffect(() => {
        if (tracksQuery.data) {
            setTracks(tracksQuery.data);
        }
    }, [setTracks, tracksQuery.data]);

    useEffect(() => {
        if (tasksQuery.data) {
            setTasks(tasksQuery.data);
        }
    }, [setTasks, tasksQuery.data]);

    useEffect(() => {
        if (sessionsQuery.data) {
            setSessionSummary(sessionsQuery.data.summary);
        }
    }, [sessionsQuery.data, setSessionSummary]);

    useEffect(() => {
        // Hydrate workspace state from saved preferences exactly once. Re-running would
        // clobber live state (e.g. reset an in-progress timer) every time a preference
        // save invalidates and refetches this query.
        if (didHydratePreferences.current) {
            return;
        }
        if (!preferencesQuery.data || !tracksQuery.data) {
            return;
        }

        const { preferences, backgrounds: availableBackgrounds } = preferencesQuery.data;
        const cadence: PomodoroCadence = {
            focusMinutes: preferences.pomodoroSettings.focusMinutes,
            breakMinutes: preferences.pomodoroSettings.breakMinutes,
            longBreakMinutes: preferences.pomodoroSettings.longBreakMinutes,
            sessionsBeforeLongBreak: preferences.pomodoroSettings.sessionsBeforeLongBreak,
            autoStartBreaks: preferences.pomodoroSettings.autoStartBreaks,
            autoStartFocus: preferences.pomodoroSettings.autoStartFocus,
        };

        // A ?track= deep link (from /soundscapes) wins over the saved preference for this
        // visit. It only selects the track — playback still waits for a real gesture.
        const requestedTrackId = searchParams.get('track');
        const selectedTrack = tracksQuery.data?.length
            ? ((requestedTrackId
                  ? tracksQuery.data.find((track) => track.id === requestedTrackId)
                  : undefined) ??
              tracksQuery.data.find((track) => track.id === preferences.selectedTrackId) ??
              tracksQuery.data[0] ??
              null)
            : null;

        if (requestedTrackId) {
            // Drop the parameter so a later reload restores the saved track instead.
            window.history.replaceState(null, '', window.location.pathname);
        }

        // Seed the persist baseline with the exact shape we later write, so hydration
        // itself never triggers a redundant save. Uses the *resolved* track id.
        const seedPayload: WorkspacePersistPayload = {
            defaultMode: preferences.defaultMode,
            selectedBackgroundId: preferences.selectedBackgroundId,
            selectedTrackId: selectedTrack?.id ?? preferences.selectedTrackId ?? '',
            likedTrackIds: preferences.likedTrackIds,
            volume: preferences.volume,
            timerMode: preferences.timerMode,
            timerPreset: preferences.timerPreset,
            customMinutes: preferences.customMinutes,
            pomodoroSettings: cadence,
        };
        lastPersistedPreferencesRef.current = JSON.stringify(seedPayload);

        setBackgrounds(availableBackgrounds);
        setLikedTrackIds(preferences.likedTrackIds);
        setMode(preferences.defaultMode);
        setSelectedBackgroundId(preferences.selectedBackgroundId);
        hydratePreferences({
            volume: preferences.volume,
            timerMode: preferences.timerMode,
            timerPreset: preferences.timerPreset,
            customMinutes: preferences.customMinutes,
            pomodoroSettings: cadence,
        });

        if (selectedTrack) {
            setCurrentTrack(selectedTrack);
        }

        // Pick the dial back up where the last visit left it. A restore always lands
        // paused, so time the workspace was closed is never credited as focus.
        const snapshot = readTimerSnapshot();
        if (snapshot) {
            const outcome = restoreTimer(snapshot);
            if (outcome === 'finished') {
                toast('Your focus block finished while you were away', {
                    id: 'timer-restore',
                    description: 'The time you focused was recorded.',
                });
            } else if (outcome === 'restored' && snapshot.wasRunning) {
                toast('Picked up where you left off', {
                    id: 'timer-restore',
                    description: 'Your timer is paused — press play when you are ready.',
                });
            }

            // A crash or a killed tab leaves the session row open, because the unload flush
            // never ran. Settle that specific block with the focus time this device can still
            // prove; anything it can't is never credited. Reuses the restore toast slot so a
            // reload reports one thing, not two.
            if (snapshot.sessionId && outcome !== 'ignored') {
                recoverSession.mutate(
                    {
                        id: snapshot.sessionId,
                        elapsedSeconds: provenFocusSeconds(snapshot),
                        savedAtMs: snapshot.savedAt,
                    },
                    {
                        onSuccess: (recovery) => {
                            if (recovery.outcome !== 'completed') return;
                            const minutes = Math.max(1, Math.round(recovery.elapsedSeconds / 60));
                            toast('Your last block was saved', {
                                id: 'timer-restore',
                                description: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of focus were recorded.`,
                            });
                        },
                    },
                );
            }
        }

        didHydratePreferences.current = true;
        setIsHydrated(true);
    }, [
        preferencesQuery.data,
        hydratePreferences,
        setBackgrounds,
        setCurrentTrack,
        setLikedTrackIds,
        setMode,
        setSelectedBackgroundId,
        restoreTimer,
        searchParams,
        tracksQuery.data,
    ]);

    useEffect(() => {
        if (!availableQuotes.length) {
            return;
        }

        setCurrentQuote(selectQuoteForMode(availableQuotes, currentMode));
    }, [availableQuotes, currentMode, setCurrentQuote]);

    useEffect(() => {
        if (!didHydratePreferences.current || !currentTrack) {
            return;
        }

        const nextPayload: WorkspacePersistPayload = {
            defaultMode: currentMode,
            selectedBackgroundId,
            selectedTrackId: currentTrack.id,
            likedTrackIds,
            volume: volume[0] ?? 50,
            timerMode,
            timerPreset: selectedPreset,
            customMinutes,
            pomodoroSettings: {
                focusMinutes: pomodoroSettings.focusMinutes,
                breakMinutes: pomodoroSettings.breakMinutes,
                longBreakMinutes: pomodoroSettings.longBreakMinutes,
                sessionsBeforeLongBreak: pomodoroSettings.sessionsBeforeLongBreak,
                autoStartBreaks: pomodoroSettings.autoStartBreaks,
                autoStartFocus: pomodoroSettings.autoStartFocus,
            },
        };
        const serializedPayload = JSON.stringify(nextPayload);

        // Skip if this exact payload is already persisted or currently being saved.
        if (
            serializedPayload === lastPersistedPreferencesRef.current ||
            serializedPayload === savingPreferencesRef.current
        ) {
            return;
        }

        // Debounce: workspace prefs (volume slider, timer tweaks) can change rapidly.
        // Coalesce into one write after activity settles so we don't flood the API /
        // trip the per-user rate limit. The baseline only advances on a *successful*
        // save, so a failed save is retried on the next preference change rather than
        // silently dropped. `updatePreferences` is intentionally omitted from the deps
        // (mutate is stable) so a failed mutation doesn't re-run this effect and spiral
        // retries into the rate limit — retries are driven by real preference changes.
        const timeout = setTimeout(() => {
            savingPreferencesRef.current = serializedPayload;
            updatePreferences.mutate(nextPayload, {
                onSuccess: () => {
                    lastPersistedPreferencesRef.current = serializedPayload;
                },
                onSettled: () => {
                    if (savingPreferencesRef.current === serializedPayload) {
                        savingPreferencesRef.current = null;
                    }
                },
            });
        }, PREFERENCES_PERSIST_DEBOUNCE_MS);

        return () => clearTimeout(timeout);
    }, [
        currentMode,
        currentTrack,
        likedTrackIds,
        selectedBackgroundId,
        volume,
        timerMode,
        selectedPreset,
        customMinutes,
        pomodoroSettings,
    ]);

    const showBackground = modes[currentMode]?.showBackground || false;
    const activeBackground = backgrounds.find((background) => background.id === selectedBackgroundId);
    const backgroundUrl = (showBackground && activeBackground?.url) || null;

    // CSS background images emit no load/error events, so preload the scene through an
    // Image element and only paint it once it arrives. A blocked or offline image then
    // degrades to the plain night backdrop with a retry toast instead of a black screen.
    const [loadedBackgroundUrl, setLoadedBackgroundUrl] = useState<string | null>(null);
    const [backgroundRetry, setBackgroundRetry] = useState(0);

    useEffect(() => {
        if (!backgroundUrl) {
            setLoadedBackgroundUrl(null);
            return;
        }

        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (cancelled) return;
            toast.dismiss('background-load');
            setLoadedBackgroundUrl(backgroundUrl);
        };
        image.onerror = () => {
            if (cancelled) return;
            setLoadedBackgroundUrl(null);
            toast.error("Couldn't load the background scene", {
                id: 'background-load',
                description: 'Showing the plain backdrop instead. Check your connection.',
                action: { label: 'Retry', onClick: () => setBackgroundRetry((attempt) => attempt + 1) },
            });
        };
        image.src = backgroundUrl;

        return () => {
            cancelled = true;
        };
    }, [backgroundUrl, backgroundRetry]);

    const isLoading =
        tracksQuery.isLoading || tasksQuery.isLoading || preferencesQuery.isLoading || sessionsQuery.isLoading;
    const hasError = tracksQuery.isError || tasksQuery.isError || preferencesQuery.isError || sessionsQuery.isError;

    if (isLoading || (!isHydrated && !hasError)) {
        return (
            <main className="bg-night text-ink relative flex min-h-screen items-center justify-center">
                {/* Skeleton mirrors the workspace layout: dial in the center, player strip below. */}
                <div
                    className="aspect-square w-[min(560px,calc(100vw-2rem),calc(100vh-16rem))] animate-pulse rounded-full border border-white/10"
                    aria-hidden
                />
                <p className="sr-only">Loading your focus workspace</p>
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-white/5 bg-black/40 p-4">
                    <div className="h-12 w-12 animate-pulse rounded-md bg-white/10" aria-hidden />
                    <div className="space-y-2" aria-hidden>
                        <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                    </div>
                </div>
            </main>
        );
    }

    if (hasError) {
        return (
            <main className="bg-night text-ink flex min-h-screen items-center justify-center px-6">
                <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                    <h1 className="text-2xl font-semibold">Your workspace didn&apos;t load</h1>
                    <p className="text-ink-mid mt-3 text-sm">
                        We couldn&apos;t reach ChillFlow just now. Your sessions, tasks, and preferences are safe.
                    </p>
                    <Button
                        className="bg-ember text-night hover:bg-ember/90 mt-5"
                        onClick={() => {
                            void tracksQuery.refetch();
                            void tasksQuery.refetch();
                            void preferencesQuery.refetch();
                            void sessionsQuery.refetch();
                        }}
                    >
                        Try again
                    </Button>
                </div>
            </main>
        );
    }

    return (
        <main
            className={`bg-night text-ink relative min-h-screen w-screen overflow-hidden ${
                loadedBackgroundUrl ? 'bg-cover bg-center bg-no-repeat' : ''
            }`}
            style={loadedBackgroundUrl ? { backgroundImage: `url('${loadedBackgroundUrl}')` } : {}}
        >
            {loadedBackgroundUrl && <div className="absolute inset-0 bg-black/60" />}

            <AnimatePresence>
                {loadedBackgroundUrl && (
                    <motion.div
                        className="absolute inset-0"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.2 }}
                        style={{
                            background: 'radial-gradient(circle at top, rgba(255,255,255,0.12), transparent 55%)',
                        }}
                    />
                )}
            </AnimatePresence>

            <AppHeader />
            <SettingsDialog />
            <CenterContent />
            <PlayerDock />
            <CommandPalette />
        </main>
    );
}
