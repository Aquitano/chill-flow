import { j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { trackLookupInputSchema } from '../validation/app';

export const tracksRouter = j.router({
    list: publicProcedure.query(({ c }) => {
        c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
        return c.superjson(appRepository.listTracks());
    }),

    getById: publicProcedure
        .input(trackLookupInputSchema)
        .query(({ c, input }) => {
            c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
            return c.superjson(appRepository.getTrackById(input.id));
        }),
});
