import type { Track } from '@/models/app';
import { describe, expect, it } from 'vitest';
import { buildLibraryView } from '../library-view';
import { LIKED_SCENE } from '../tracks';

const track = (id: string, category?: string, title = id): Track => ({
    id,
    title,
    artist: 'Test',
    audioUrl: `/audio/${id}.mp3`,
    duration: 60,
    tags: [],
    category,
});

const library = [track('rain', 'nature', 'Rain on glass'), track('deep', 'focus', 'Deep current'), track('loose')];

const view = (overrides: Partial<Parameters<typeof buildLibraryView>[0]> = {}) =>
    buildLibraryView({ tracks: library, activeScene: null, likedTrackIds: [], query: '', ...overrides });

const ids = (tracks: Track[]) => tracks.map((entry) => entry.id);

describe('buildLibraryView', () => {
    it('groups the whole catalog by scene when nothing is filtered', () => {
        const { sections, rows } = view();

        expect(sections.map((section) => section.label)).toEqual(['Focus', 'Nature', 'Other']);
        expect(ids(rows)).toEqual(['deep', 'rain', 'loose']);
    });

    it('collapses to a flat list once a chip is active', () => {
        const { sections, rows } = view({ activeScene: 'nature' });

        expect(sections).toHaveLength(1);
        expect(sections[0]?.label).toBeNull();
        expect(ids(rows)).toEqual(['rain']);
    });

    it('searches titles, artists, and categories within the active filter', () => {
        expect(ids(view({ query: 'rain' }).rows)).toEqual(['rain']);
        expect(ids(view({ query: 'deep current' }).rows)).toEqual(['deep']);
        expect(ids(view({ activeScene: 'nature', query: 'rain' }).rows)).toEqual(['rain']);
    });

    it('widens past the active filter rather than dead-ending on no matches', () => {
        const { rows, widened } = view({ activeScene: 'nature', query: 'deep' });

        expect(widened).toBe(true);
        expect(ids(rows)).toEqual(['deep']);
    });

    it('reports no widening when the library has no match either', () => {
        const { rows, widened } = view({ activeScene: 'nature', query: 'nothing here' });

        expect(widened).toBe(false);
        expect(rows).toEqual([]);
    });

    it('never widens out of the unfiltered library, which is already everything', () => {
        expect(view({ query: 'nothing here' })).toMatchObject({ rows: [], widened: false });
    });

    it('shows the liked tracks for the liked filter', () => {
        expect(ids(view({ activeScene: LIKED_SCENE, likedTrackIds: ['loose', 'rain'] }).rows)).toEqual([
            'rain',
            'loose',
        ]);
    });
});
