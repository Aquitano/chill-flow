import { z } from 'zod';
import { j, protectedProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';

export const tasksRouter = j.router({
    list: protectedProcedure.query(({ c, ctx }) => {
        return c.superjson(appRepository.listTasks(ctx.userId));
    }),

    create: protectedProcedure
        .input(
            z.object({
                text: z.string().min(1).max(120),
                priority: z.enum(['low', 'medium', 'high']).default('medium'),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            return c.superjson(appRepository.createTask(ctx.userId, input));
        }),

    update: protectedProcedure
        .input(
            z.object({
                id: z.string(),
                text: z.string().min(1).max(120).optional(),
                priority: z.enum(['low', 'medium', 'high']).optional(),
                isCompleted: z.boolean().optional(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            const task = appRepository.updateTask(ctx.userId, input.id, input);
            return c.superjson(task);
        }),

    complete: protectedProcedure
        .input(
            z.object({
                id: z.string(),
                isCompleted: z.boolean(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            const task = appRepository.updateTask(ctx.userId, input.id, {
                isCompleted: input.isCompleted,
            });

            return c.superjson(task);
        }),

    delete: protectedProcedure
        .input(
            z.object({
                id: z.string(),
            }),
        )
        .mutation(({ c, ctx, input }) => {
            return c.superjson(appRepository.deleteTask(ctx.userId, input.id));
        }),
});
