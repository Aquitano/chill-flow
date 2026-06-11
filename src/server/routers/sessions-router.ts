import { j, protectedDataProcedure, protectedMutationProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { createRateLimitMiddleware } from '../security/rate-limit';
import { cancelSessionInputSchema, completeSessionInputSchema, startSessionInputSchema } from '../validation/app';

export const sessionsRouter = j.router({
    list: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson({
            sessions: await appRepository.listSessions(ctx.db, ctx.userId),
            summary: await appRepository.getSessionSummary(ctx.db, ctx.userId),
        });
    }),

    start: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:start', limit: 15, windowMs: 60_000 }))
        .input(startSessionInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.startSession(ctx.db, ctx.userId, input));
        }),

    complete: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:complete', limit: 30, windowMs: 60_000 }))
        .input(completeSessionInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.completeSession(ctx.db, ctx.userId, input.id, input.elapsedSeconds));
        }),

    cancel: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:cancel', limit: 30, windowMs: 60_000 }))
        .input(cancelSessionInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.cancelSession(ctx.db, ctx.userId, input.id));
        }),
});
