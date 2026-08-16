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
            // Unliking the last liked track also drops the Liked filter, so a rollback has to
            // put the scene back too or the panel and the queue disagree with the restored list.
            const { likedTrackIds: previousLikes, activeScene: previousScene } = useAppStore.getState();
            const outcome = useAppStore.getState().toggleTrackLike(trackId);

            if (outcome === 'limit-reached') {
                toast.error(LIKE_LIMIT_TOAST.title, LIKE_LIMIT_TOAST.options);
                return outcome;
            }

            const attempted = useAppStore.getState().likedTrackIds;

            persist(
                { likedTrackIds: attempted },
                {
                    onError: (error) => {
                        // A newer toggle has already moved the list on; rolling back to this
                        // call's snapshot would throw that newer like away.
                        if (useAppStore.getState().likedTrackIds === attempted) {
                            useAppStore.getState().setLikedTrackIds(previousLikes);
                            useAppStore.getState().setActiveScene(previousScene);
                        }
                        toast.error("Couldn't save that like", { description: describeApiError(error) });
                    },
                },
            );

            return outcome;
        },
        [persist],
    );
}
