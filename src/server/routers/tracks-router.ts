import { j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { trackLookupInputSchema } from '../validation/app';

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
});
