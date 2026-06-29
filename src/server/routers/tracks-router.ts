import { adminMutationProcedure, adminProcedure, j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { getAudioStorage } from '../storage/audio-storage';
import { deleteTrackAdminInputSchema, trackLookupInputSchema, updateTrackInputSchema } from '../validation/app';

export const tracksRouter = j.router({
    list: publicProcedure.query(async ({ c, ctx }) => {
        c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
        if (!ctx.db) {
            return c.superjson([]);
        }
        return c.superjson(await appRepository.listTracks(ctx.db));
    }),

    getById: publicProcedure
        .input(trackLookupInputSchema)
        .query(async ({ c, ctx, input }) => {
            c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
            if (!ctx.db) {
                return c.superjson(null);
            }
            return c.superjson(await appRepository.getTrackById(ctx.db, input.id));
        }),

    adminList: adminProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.adminListTracks(ctx.db));
    }),

    update: adminMutationProcedure.input(updateTrackInputSchema).mutation(async ({ c, ctx, input }) => {
        const { id, ...fields } = input;
        return c.superjson(await appRepository.updateTrack(ctx.db, id, fields));
    }),

    delete: adminMutationProcedure.input(deleteTrackAdminInputSchema).mutation(async ({ c, ctx, input }) => {
        const removed = await appRepository.deleteTrack(ctx.db, input.id);
        if (removed?.storageKey) {
            // Best-effort: a missing file shouldn't fail the row deletion.
            await getAudioStorage()
                .remove(removed.storageKey)
                .catch(() => {});
        }
        return c.superjson({ success: Boolean(removed) });
    }),
});
