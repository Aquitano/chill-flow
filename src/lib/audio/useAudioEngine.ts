'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAudioDebugLogger } from './debug';
import { getAudioEngine } from './engine';

export function useAudioEngine() {
    const engine = useMemo(() => getAudioEngine(), []);
    const debugLogger = useMemo(() => getAudioDebugLogger(), []);

    useEffect(() => {
        debugLogger.debug('Hook', 'useAudioEngine initializing');
        engine.init().catch((err) => {
            debugLogger.error('Hook', 'Failed to initialize audio engine in hook', err);
        });
    }, [engine, debugLogger]);

    return engine;
}

export type AudioState = {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    bufferedPercent: number;
    volume: number; // 0..1
    muted: boolean;
    hasTrack: boolean;
};

export function useAudioEngineState() {
    const engine = useAudioEngine();
    const debugLogger = useMemo(() => getAudioDebugLogger(), []);
    const [state, setState] = useState<AudioState>(() => ({
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        bufferedPercent: 0,
        volume: engine.getMasterVolume?.() ?? 0.5,
        muted: false,
        hasTrack: engine.hasMainTrack(),
    }));

    useEffect(() => {
        const handleTime = (e: CustomEvent<{ currentTime: number; duration: number; bufferedPercent: number }>) => {
            setState((s) => ({
                ...s,
                currentTime: e.detail.currentTime,
                duration: e.detail.duration,
                bufferedPercent: e.detail.bufferedPercent,
                hasTrack: engine.hasMainTrack(),
            }));
        };
        const handleState = (e: CustomEvent<{ isPlaying: boolean }>) => {
            setState((s) => ({ ...s, isPlaying: e.detail.isPlaying }));
        };
        const handleVolume = (e: CustomEvent<{ volume: number; muted: boolean }>) => {
            setState((s) => ({ ...s, volume: e.detail.volume, muted: e.detail.muted }));
        };
        const handleError = (e: CustomEvent<{ message: string }>) => {
            // PlayerControls owns the user-facing toast + retry; here we only log for diagnostics.
            debugLogger.warn('Hook', 'Audio error received in state hook', e.detail);
        };

        engine.addEventListener('time', handleTime);
        engine.addEventListener('statechange', handleState);
        engine.addEventListener('volumechange', handleVolume);
        engine.addEventListener('error', handleError);

        // Prime initial time values in case metadata already loaded
        setState((s) => ({
            ...s,
            currentTime: engine.getCurrentTime?.() ?? 0,
            duration: engine.getDuration?.() ?? 0,
            bufferedPercent: engine.getBufferedPercent?.() ?? 0,
            volume: engine.getMasterVolume?.() ?? s.volume,
            hasTrack: engine.hasMainTrack(),
        }));

        return () => {
            engine.removeEventListener('time', handleTime);
            engine.removeEventListener('statechange', handleState);
            engine.removeEventListener('volumechange', handleVolume);
            engine.removeEventListener('error', handleError);
        };
    }, [engine, debugLogger]);

    return { engine, state };
}
