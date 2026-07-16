import { HTTPException } from 'hono/http-exception';
import { j, protectedDataProcedure, protectedMutationProcedure, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { deleteAmbientMixInputSchema, saveAmbientMixInputSchema, updateAmbientMixInputSchema } from '../validation/app';

const MAX_MIXES_PER_USER = 20;

export const ambientRouter = j.router({
    sounds: publicProcedure.query(async ({ c, ctx }) => {
        c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
        if (!ctx.db) {
            return c.superjson([]);
        }
        return c.superjson(await appRepository.listAmbientSounds(ctx.db));
    }),

    listMixes: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.listAmbientMixes(ctx.db, ctx.userId));
    }),

    saveMix: protectedMutationProcedure.input(saveAmbientMixInputSchema).mutation(async ({ c, ctx, input }) => {
        const existing = await appRepository.listAmbientMixes(ctx.db, ctx.userId);
        if (existing.length >= MAX_MIXES_PER_USER) {
            throw new HTTPException(422, {
                message: `You can keep up to ${MAX_MIXES_PER_USER} mixes — delete one first.`,
            });
        }
        return c.superjson(await appRepository.createAmbientMix(ctx.db, ctx.userId, input));
    }),

    updateMix: protectedMutationProcedure.input(updateAmbientMixInputSchema).mutation(async ({ c, ctx, input }) => {
        return c.superjson(
            await appRepository.updateAmbientMix(ctx.db, ctx.userId, input.id, {
                name: input.name,
                levels: input.levels,
            }),
        );
    }),

    deleteMix: protectedMutationProcedure.input(deleteAmbientMixInputSchema).mutation(async ({ c, ctx, input }) => {
        return c.superjson(await appRepository.deleteAmbientMix(ctx.db, ctx.userId, input.id));
    }),
});
