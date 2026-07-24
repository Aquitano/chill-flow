import { j, protectedDataProcedure, protectedMutationProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { createRateLimitMiddleware } from '../security/rate-limit';
import { createTaskInputSchema, deleteTaskInputSchema, updateTaskInputSchema } from '../validation/app';

export const tasksRouter = j.router({
    list: protectedDataProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.listTasks(ctx.db, ctx.userId));
    }),

    create: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'tasks:create', limit: 30, windowMs: 60_000 }))
        .input(createTaskInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.createTask(ctx.db, ctx.userId, input));
        }),

    update: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'tasks:update', limit: 60, windowMs: 60_000 }))
        .input(updateTaskInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            const task = await appRepository.updateTask(ctx.db, ctx.userId, input.id, input);
            return c.superjson(task);
        }),

    delete: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'tasks:delete', limit: 30, windowMs: 60_000 }))
        .input(deleteTaskInputSchema)
        .mutation(async ({ c, ctx, input }) => {
            return c.superjson(await appRepository.deleteTask(ctx.db, ctx.userId, input.id));
        }),

    clearCompleted: protectedMutationProcedure
        .use(createRateLimitMiddleware({ key: 'tasks:clearCompleted', limit: 10, windowMs: 60_000 }))
        .mutation(async ({ c, ctx }) => {
            return c.superjson(await appRepository.clearCompletedTasks(ctx.db, ctx.userId));
        }),
});
