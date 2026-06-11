import { j, protectedDataProcedure, protectedMutationProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { createRateLimitMiddleware } from '../security/rate-limit';
import { updatePreferencesInputSchema } from '../validation/app';

export const preferencesRouter = j.router({
    get: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.getPreferences(ctx.db, ctx.userId));
    }),

    update: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'preferences:update', limit: 20, windowMs: 60_000 }))
        .input(updatePreferencesInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.updatePreferences(ctx.db, ctx.userId, input));
        }),
});
