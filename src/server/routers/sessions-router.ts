import { z } from 'zod';
import { j, protectedProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';

export const sessionsRouter = j.router({
    list: protectedProcedure.query(({ c, ctx }) => {
        return c.superjson({
            sessions: appRepository.listSessions(ctx.userId),
            summary: appRepository.getSessionSummary(ctx.userId),
        });
    }),

    start: protectedProcedure
        .input(
            z.object({
                mode: z.string(),
                durationSeconds: z.number().int().nonnegative(),
                trackId: z.string().nullable(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            return c.superjson(appRepository.startSession(ctx.userId, input));
        }),

    complete: protectedProcedure
        .input(
            z.object({
                id: z.string(),
                durationSeconds: z.number().int().nonnegative().optional(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            return c.superjson(appRepository.completeSession(ctx.userId, input.id, input.durationSeconds));
        }),
});
