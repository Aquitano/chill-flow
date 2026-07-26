/**
 * Liked tracks are stored as a JSON array on the preferences row and ride along with every
 * workspace preference save, so the list is bounded by what belongs in a single settings
 * write rather than by anything about the product. 50 ids is around a kilobyte on the wire —
 * generous as a favourites list, and nowhere near heavy enough to matter.
 *
 * Enforced on both sides. Without the client-side half, the 51st like is added locally, the
 * save is rejected, and every *later* preference write is rejected too until the list
 * shrinks — one refused like would quietly stop volume, mode, and timer settings persisting.
 */
export const MAX_LIKED_TRACKS = 50;

export type TrackLikeOutcome = 'liked' | 'unliked' | 'limit-reached';

/** The cap is explained the same way wherever a like is refused. */
export const LIKE_LIMIT_TOAST = {
    title: `You've liked ${MAX_LIKED_TRACKS} tracks`,
    options: { id: 'like-limit', description: 'Unlike one to make room for another.' },
} as const;
