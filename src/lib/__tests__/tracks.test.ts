import { describe, expect, it } from 'vitest';
import type { Track } from '@/models/app';
import { deriveScenes, tracksInScene } from '../tracks';

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
});
