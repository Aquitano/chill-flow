'use client';

import { AmbientMix, AmbientSound } from '@/models/app';

/*
 * Curated starting points. Levels reference catalog sound ids; a preset is only
 * offered when at least one of its sounds exists in the loaded catalog, so a
 * thin catalog never advertises a mix it can't play.
 */
export const BUILTIN_MIXES: AmbientMix[] = [
    {
        id: 'builtin-rainy-study',
        name: 'Rainy study',
        levels: { 'rain-soft': 60, 'thunder-distant': 30, 'wind-soft': 15 },
    },
    {
        id: 'builtin-campfire-night',
        name: 'Campfire night',
        levels: { 'fire-crackle': 65, 'crickets-night': 35, 'wind-soft': 15 },
    },
    {
        id: 'builtin-cafe-corner',
        name: 'Café corner',
        levels: { 'cafe-murmur': 55, 'rain-window': 35 },
    },
    {
        id: 'builtin-forest-morning',
        name: 'Forest morning',
        levels: { 'birds-forest': 50, 'stream-creek': 45, 'wind-soft': 20 },
    },
    {
        id: 'builtin-open-sea',
        name: 'Open sea',
        levels: { 'waves-ocean': 65, 'wind-soft': 25 },
    },
];

export function playableMixes(mixes: AmbientMix[], sounds: AmbientSound[]): AmbientMix[] {
    const known = new Set(sounds.map((sound) => sound.id));
    return mixes.filter((mix) => Object.keys(mix.levels).some((id) => known.has(id)));
}

/* Local fallback for signed-out visitors: mixes live in the browser only. */

const LOCAL_MIXES_KEY = 'audio.ambientMixes';
const MAX_LOCAL_MIXES = 20;

export function readLocalMixes(): AmbientMix[] {
    try {
        const raw = localStorage.getItem(LOCAL_MIXES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (mix): mix is AmbientMix =>
                Boolean(mix) &&
                typeof (mix as AmbientMix).id === 'string' &&
                typeof (mix as AmbientMix).name === 'string' &&
                typeof (mix as AmbientMix).levels === 'object',
        );
    } catch {
        return [];
    }
}

export function saveLocalMix(name: string, levels: Record<string, number>): AmbientMix | null {
    const mixes = readLocalMixes();
    if (mixes.length >= MAX_LOCAL_MIXES) return null;
    const mix: AmbientMix = { id: `local-${crypto.randomUUID()}`, name, levels };
    try {
        localStorage.setItem(LOCAL_MIXES_KEY, JSON.stringify([...mixes, mix]));
        return mix;
    } catch {
        return null;
    }
}

export function updateLocalMix(id: string, name: string, levels: Record<string, number>): AmbientMix | null {
    const mixes = readLocalMixes();
    const index = mixes.findIndex((mix) => mix.id === id);
    if (index === -1) return null;
    const updated: AmbientMix = { id, name, levels };
    const next = [...mixes];
    next[index] = updated;
    try {
        localStorage.setItem(LOCAL_MIXES_KEY, JSON.stringify(next));
        return updated;
    } catch {
        return null;
    }
}

export function deleteLocalMix(id: string): AmbientMix[] {
    const remaining = readLocalMixes().filter((mix) => mix.id !== id);
    try {
        localStorage.setItem(LOCAL_MIXES_KEY, JSON.stringify(remaining));
    } catch {
        /* storage unavailable */
    }
    return remaining;
}
