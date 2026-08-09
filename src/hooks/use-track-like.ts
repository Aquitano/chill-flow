'use client';

import { useUpdatePreferencesMutation } from '@/hooks/use-app-data';
import { describeApiError } from '@/lib/api';
import { LIKE_LIMIT_TOAST, type TrackLikeOutcome } from '@/lib/likes';
import { useAppStore } from '@/store/app-store';
import { useCallback } from 'react';
import { toast } from 'sonner';

/**
 * Like or unlike a track and persist the list. Likes ride along on the preferences row, so a
 * refused save puts the heart back rather than leaving a like that was never stored.
 */
export function useTrackLike(): (trackId: string) => TrackLikeOutcome {
    const updatePreferences = useUpdatePreferencesMutation();
    const persist = updatePreferences.mutate;

    return useCallback(
        (trackId: string) => {
            const previousLikes = useAppStore.getState().likedTrackIds;
            const outcome = useAppStore.getState().toggleTrackLike(trackId);

            if (outcome === 'limit-reached') {
                toast.error(LIKE_LIMIT_TOAST.title, LIKE_LIMIT_TOAST.options);
                return outcome;
            }

            persist(
                { likedTrackIds: useAppStore.getState().likedTrackIds },
                {
                    onError: (error) => {
                        useAppStore.getState().setLikedTrackIds(previousLikes);
                        toast.error("Couldn't save that like", { description: describeApiError(error) });
                    },
                },
            );

            return outcome;
        },
        [persist],
    );
}
