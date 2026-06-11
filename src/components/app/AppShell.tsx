'use client';

import { AppHeader } from '@/components/app/AppHeader';
import { CenterContent } from '@/components/app/CenterContent';
import { FeatureMenu } from '@/components/app/FeatureMenu';
import { PlayerControls } from '@/components/app/PlayerControls';
import {
    usePreferencesQuery,
    useSessionsQuery,
    useTracksQuery,
    useUpdatePreferencesMutation,
    useTasksQuery,
} from '@/hooks/use-app-data';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

export function AppShell() {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const likedTrackIds = useAppStore((state) => state.likedTrackIds);
    const selectedBackgroundId = useAppStore((state) => state.selectedBackgroundId);
    const backgrounds = useAppStore((state) => state.backgrounds);

    const setTracks = useAppStore((state) => state.setTracks);
    const setTasks = useAppStore((state) => state.setTasks);
    const setBackgrounds = useAppStore((state) => state.setBackgrounds);
    const setSelectedBackgroundId = useAppStore((state) => state.setSelectedBackgroundId);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setLikedTrackIds = useAppStore((state) => state.setLikedTrackIds);
    const setSessions = useAppStore((state) => state.setSessions);
    const setMode = useAppStore((state) => state.setMode);
    const setCurrentQuote = useAppStore((state) => state.setCurrentQuote);

    const tracksQuery = useTracksQuery();
    const tasksQuery = useTasksQuery();
    const preferencesQuery = usePreferencesQuery();
    const sessionsQuery = useSessionsQuery();
    const updatePreferences = useUpdatePreferencesMutation();

    const didHydratePreferences = useRef(false);
    const lastPersistedPreferencesRef = useRef('');
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
            setSessions(sessionsQuery.data.sessions, sessionsQuery.data.summary);
        }
    }, [sessionsQuery.data, setSessions]);

    useEffect(() => {
        if (!preferencesQuery.data) {
            return;
        }

        const { preferences, backgrounds: availableBackgrounds } = preferencesQuery.data;
        lastPersistedPreferencesRef.current = JSON.stringify({
            defaultMode: preferences.defaultMode,
            selectedBackgroundId: preferences.selectedBackgroundId,
            selectedTrackId: preferences.selectedTrackId,
            likedTrackIds: preferences.likedTrackIds,
        });

        setBackgrounds(availableBackgrounds);
        setLikedTrackIds(preferences.likedTrackIds);
        setMode(preferences.defaultMode);
        setSelectedBackgroundId(preferences.selectedBackgroundId);

        if (tracksQuery.data?.length) {
            const selectedTrack =
                tracksQuery.data.find((track) => track.id === preferences.selectedTrackId) ?? tracksQuery.data[0] ?? null;
            setCurrentTrack(selectedTrack);
        }
        didHydratePreferences.current = true;
    }, [
        preferencesQuery.data,
        setBackgrounds,
        setCurrentTrack,
        setLikedTrackIds,
        setMode,
        setSelectedBackgroundId,
        tracksQuery.data,
    ]);

    useEffect(() => {
        if (!availableQuotes.length) {
            return;
        }

        const nextQuote = availableQuotes.find((quote) => quote.tags.includes(currentMode.toLowerCase())) ?? availableQuotes[0] ?? null;
        setCurrentQuote(nextQuote);
    }, [availableQuotes, currentMode, setCurrentQuote]);

    useEffect(() => {
        if (!didHydratePreferences.current || !currentTrack) {
            return;
        }

        const nextPayload = {
            defaultMode: currentMode,
            selectedBackgroundId,
            selectedTrackId: currentTrack.id,
            likedTrackIds,
        };
        const serializedPayload = JSON.stringify(nextPayload);

        if (serializedPayload === lastPersistedPreferencesRef.current) {
            return;
        }

        lastPersistedPreferencesRef.current = serializedPayload;
        updatePreferences.mutate(nextPayload);
    }, [currentMode, currentTrack, likedTrackIds, selectedBackgroundId, updatePreferences]);

    const showBackground = modes[currentMode]?.showBackground || false;
    const activeBackground = backgrounds.find((background) => background.id === selectedBackgroundId);

    if (tracksQuery.isLoading || tasksQuery.isLoading || preferencesQuery.isLoading || sessionsQuery.isLoading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-black text-white">
                <div className="space-y-3 text-center">
                    <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">ChillFlow</p>
                    <p className="text-2xl font-medium">Loading your focus workspace...</p>
                </div>
            </main>
        );
    }

    if (tracksQuery.isError || tasksQuery.isError || preferencesQuery.isError || sessionsQuery.isError) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
                <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                    <h1 className="text-2xl font-semibold">Workspace failed to load</h1>
                    <p className="mt-3 text-sm text-neutral-400">
                        The API could not initialize the current ChillFlow workspace. Refresh the page or check your env
                        configuration.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main
            className={`relative min-h-screen w-screen overflow-hidden text-white ${
                showBackground ? 'bg-cover bg-center bg-no-repeat' : 'bg-black'
            }`}
            style={showBackground && activeBackground?.url ? { backgroundImage: `url('${activeBackground.url}')` } : {}}
        >
            {showBackground && <div className="absolute inset-0 bg-black/60" />}

            <AnimatePresence>
                {showBackground && (
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
            <FeatureMenu />
            <CenterContent />
            <PlayerControls />
        </main>
    );
}
