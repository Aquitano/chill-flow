import { deriveScenes, tracksInScene } from '@/lib/tracks';
import type { Track } from '@/models/app';

export type LibrarySection = {
    key: string;
    headingId: string;
    /** Null for a flat list; a scene name when the catalog is shown grouped. */
    label: string | null;
    tracks: Track[];
};

export type LibraryView = {
    sections: LibrarySection[];
    /** Every visible track in display order — what the keyboard highlight walks. */
    rows: Track[];
    /** The active filter had no match, so results come from the whole library instead. */
    widened: boolean;
};

function matchesTokens(track: Track, tokens: string[]): boolean {
    const haystack = `${track.title} ${track.artist} ${track.tags.join(' ')} ${track.category ?? ''}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
}

/**
 * What the library panel shows for the current filter and search.
 *
 * Unfiltered and unsearched, the catalog is grouped by scene so a long list stays
 * scannable; a chip or a query collapses it to one flat list of matches.
 */
export function buildLibraryView({
    tracks,
    activeScene,
    likedTrackIds,
    query,
}: {
    tracks: Track[];
    activeScene: string | null;
    likedTrackIds: string[];
    query: string;
}): LibraryView {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scenes = deriveScenes(tracks);

    if (activeScene === null && tokens.length === 0 && scenes.length > 1) {
        const uncategorized = tracks.filter((track) => !track.category?.trim());
        const sections: LibrarySection[] = [
            ...scenes.map((scene, index) => ({
                key: `scene:${scene.id}`,
                headingId: `library-group-scene-${index}`,
                label: scene.label,
                tracks: tracksInScene(tracks, scene.id),
            })),
            ...(uncategorized.length > 0
                ? [
                      {
                          key: 'uncategorized',
                          headingId: 'library-group-uncategorized',
                          label: 'Other',
                          tracks: uncategorized,
                      },
                  ]
                : []),
        ];
        return { sections, rows: sections.flatMap((section) => section.tracks), widened: false };
    }

    const scoped = tracksInScene(tracks, activeScene, likedTrackIds);
    const scopedMatches = tokens.length === 0 ? scoped : scoped.filter((track) => matchesTokens(track, tokens));
    // A search that comes up empty inside the active filter reads as "the library doesn't
    // have that track", so widen to the whole catalog rather than leaving a dead end.
    const widened = tokens.length > 0 && scopedMatches.length === 0 && activeScene !== null;
    const rows = widened ? tracks.filter((track) => matchesTokens(track, tokens)) : scopedMatches;

    return {
        sections: [{ key: 'results', headingId: 'library-group-results', label: null, tracks: rows }],
        rows,
        widened: widened && rows.length > 0,
    };
}
