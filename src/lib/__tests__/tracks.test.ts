import { describe, expect, it } from 'vitest';
import type { Track } from '@/models/app';
import { LIKED_SCENE, deriveScenes, tracksInScene } from '../tracks';

const track = (id: string, category?: string): Track => ({
    id,
    title: id,
    artist: 'Test',
    audioUrl: `/audio/${id}.mp3`,
    duration: 60,
    tags: [],
    category,
});

describe('track scenes', () => {
    it('uses the same trimmed category for scene derivation and matching', () => {
        const tracks = [track('rain', '  nature  '), track('focus', 'focus')];

        expect(deriveScenes(tracks).map((scene) => scene.id)).toEqual(['focus', 'nature']);
        expect(tracksInScene(tracks, 'nature')).toEqual([tracks[0]]);
    });

    it('keeps the liked pseudo-scene out of the derived category list', () => {
        const tracks = [track('rain', 'nature'), track('focus', 'focus')];

        expect(deriveScenes(tracks).map((scene) => scene.id)).not.toContain(LIKED_SCENE);
    });

    it('filters to liked tracks in library order', () => {
        const tracks = [track('rain', 'nature'), track('focus', 'focus'), track('hum', 'ambient')];

        expect(tracksInScene(tracks, LIKED_SCENE, ['hum', 'rain'])).toEqual([tracks[0], tracks[2]]);
        expect(tracksInScene(tracks, LIKED_SCENE, [])).toEqual([]);
    });
});
