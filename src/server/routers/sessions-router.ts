import { j, protectedDataProcedure, protectedMutationProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { createRateLimitMiddleware } from '../security/rate-limit';
import {
    cancelSessionInputSchema,
    completeCycleInputSchema,
    completeSessionInputSchema,
    recoverSessionInputSchema,
    sessionSummaryInputSchema,
    startSessionInputSchema,
} from '../validation/app';

export const sessionsRouter = j.router({
    // Summary only: the workspace renders totals, and the full history of every completed
    // session is an unbounded payload nothing reads.
    list: protectedDataProcedure.input(sessionSummaryInputSchema).query(async ({ c, ctx, input }) => {
        return c.superjson({ summary: await appRepository.getSessionSummary(ctx.db, ctx.userId, input.timeZone) });
    }),

    // Loaded on demand by the progress panel, so the workspace's first paint stays four
    // numbers rather than a list nothing is showing yet.
    history: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.listRecentSessions(ctx.db, ctx.userId));
    }),

    // Per-day focus totals behind the progress panel's trend strip; the zone travels with
    // the request for the same reason it does on `list`.
    daily: protectedDataProcedure.input(sessionSummaryInputSchema).query(async ({ c, ctx, input }) => {
        return c.superjson(await appRepository.listDailyFocus(ctx.db, ctx.userId, input.timeZone));
    }),

    // Per-task focus time for the task list. Grouped in the database over the user's whole
    // history rather than summed from `history`, which only reaches back a fixed window.
    taskTotals: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.listTaskFocusTotals(ctx.db, ctx.userId));
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

    completeCycle: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:completeCycle', limit: 30, windowMs: 60_000 }))
        .input(completeCycleInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.completeSessionCycle(ctx.db, ctx.userId, input.id));
        }),

    cancel: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:cancel', limit: 30, windowMs: 60_000 }))
        .input(cancelSessionInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.cancelSession(ctx.db, ctx.userId, input.id));
        }),

    // Fires once per workspace load, only when the device left a block open.
    recover: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'sessions:recover', limit: 10, windowMs: 60_000 }))
        .input(recoverSessionInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(
                await appRepository.recoverSession(
                    ctx.db,
                    ctx.userId,
                    input.id,
                    input.elapsedSeconds,
                    input.savedAtMs,
                ),
            );
        }),
});
