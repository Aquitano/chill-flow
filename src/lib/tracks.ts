import { Track } from '@/models/app';

/*
 * Scenes are derived from the track categories that actually exist in the
 * library — nothing curated in the UI can ever be empty or fake. New categories
 * uploaded through the admin surface appear here automatically.
 */

export type Scene = {
    id: string;
    label: string;
    trackCount: number;
};

const SCENE_LABELS: Record<string, string> = {
    focus: 'Focus',
    ambient: 'Ambient',
    chill: 'Chill',
    nature: 'Nature',
    lofi: 'Lo-fi',
    classical: 'Classical',
    electronic: 'Electronic',
};

export function sceneLabel(category: string): string {
    return SCENE_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

export function deriveScenes(tracks: Track[]): Scene[] {
    const counts = new Map<string, number>();
    for (const track of tracks) {
        const category = track.category?.trim();
        if (!category) continue;
        counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([id, trackCount]) => ({ id, label: sceneLabel(id), trackCount }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function tracksInScene(tracks: Track[], scene: string | null): Track[] {
    if (!scene) return tracks;
    return tracks.filter((track) => track.category?.trim() === scene);
}

/** Deterministic fallback art for tracks without a cover — varies by track id. */
export function fallbackHue(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
        hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    // Stay in the warm band (30–90°) so fallbacks never clash with the palette.
    return 30 + (hash % 60);
}

/** Format whole seconds as m:ss for track durations. */
export function formatDuration(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '--:--';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
