import { z } from 'zod';
import { j, protectedProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';

export const preferencesRouter = j.router({
    get: protectedProcedure.query(({ c, ctx }) => {
        return c.superjson(appRepository.getPreferences(ctx.userId));
    }),

    update: protectedProcedure
        .input(
            z.object({
                defaultMode: z.string().optional(),
                autoPlay: z.boolean().optional(),
                transitionSpeed: z.number().optional(),
                volume: z.number().optional(),
                showNotifications: z.boolean().optional(),
                theme: z.enum(['light', 'dark', 'system']).optional(),
                selectedTrackId: z.string().nullable().optional(),
                selectedBackgroundId: z.string().nullable().optional(),
                likedTrackIds: z.array(z.string()).optional(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            return c.superjson(appRepository.updatePreferences(ctx.userId, input));
        }),
});
