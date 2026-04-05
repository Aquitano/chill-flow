import { z } from 'zod';
import { j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';

export const tracksRouter = j.router({
    list: publicProcedure.query(({ c }) => {
        return c.superjson(appRepository.listTracks());
    }),

    getById: publicProcedure
        .input(
            z.object({
                id: z.string(),
            }),
        )
        .query(({ c, input }) => {
            return c.superjson(appRepository.getTrackById(input.id));
        }),
});
