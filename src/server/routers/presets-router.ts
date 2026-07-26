import { HTTPException } from 'hono/http-exception';
import { j, protectedDataProcedure, protectedMutationProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { createRateLimitMiddleware } from '../security/rate-limit';
import {
    deleteWorkspacePresetInputSchema,
    saveWorkspacePresetInputSchema,
    updateWorkspacePresetInputSchema,
} from '../validation/app';

/** A picker, not a library: past this the list is harder to scan than rebuilding the setup. */
const MAX_PRESETS_PER_USER = 20;

export const presetsRouter = j.router({
    list: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.listSavedPresets(ctx.db, ctx.userId));
    }),

    save: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'presets:save', limit: 20, windowMs: 60_000 }))
        .input(saveWorkspacePresetInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            const existing = await appRepository.listSavedPresets(ctx.db, ctx.userId);
            if (existing.length >= MAX_PRESETS_PER_USER) {
                throw new HTTPException(422, {
                    message: `You can keep up to ${MAX_PRESETS_PER_USER} presets — delete one first.`,
                });
            }

            return c.superjson(await appRepository.createSavedPreset(ctx.db, ctx.userId, input));
        }),

    update: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'presets:update', limit: 30, windowMs: 60_000 }))
        .input(updateWorkspacePresetInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            const { id, ...preset } = input;
            return c.superjson(await appRepository.updateSavedPreset(ctx.db, ctx.userId, id, preset));
        }),

    delete: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'presets:delete', limit: 30, windowMs: 60_000 }))
        .input(deleteWorkspacePresetInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.deleteSavedPreset(ctx.db, ctx.userId, input.id));
        }),
});
