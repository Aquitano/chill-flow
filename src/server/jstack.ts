import { appEnv } from '@/lib/env';
import { auth } from '@clerk/nextjs/server';
import { env } from 'hono/adapter';
import { HTTPException } from 'hono/http-exception';
import { jstack } from 'jstack';
import { getDatabase } from './db/client';
import { isTrustedOrigin } from './security/origin';

interface Env {
    Bindings: { DATABASE_URL?: string };
}

export const j = jstack.init<Env>();

/**
 * Type-safely injects database into all procedures
 *
 * @see https://jstack.app/docs/backend/middleware
 */
const databaseMiddleware = j.middleware(async ({ c, next }) => {
    const { DATABASE_URL } = env(c);
    const db = getDatabase(DATABASE_URL ?? appEnv.databaseUrl);

    if (!db) {
        return await next({ db: null });
    }

    return await next({ db });
});

/**
 * Public (unauthenticated) procedures
 *
 * This is the base piece you use to build new queries and mutations on your API.
 */
export const publicProcedure = j.procedure.use(databaseMiddleware);

const authMiddleware = j.middleware(async ({ next }) => {
    if (!appEnv.isClerkConfigured) {
        throw new HTTPException(500, { message: 'Authentication is not configured.' });
    }

    const authState = await auth();

    if (!authState.userId) {
        throw new HTTPException(401, { message: 'Unauthorized' });
    }

    return next({ userId: authState.userId });
});

export const protectedProcedure = publicProcedure.use(authMiddleware);
export const protectedDataProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    if (!ctx.db) {
        throw new HTTPException(503, { message: 'Database access is not configured.' });
    }

    return next({ db: ctx.db });
});

export const protectedMutationProcedure = protectedDataProcedure.use(async ({ c, next }) => {
    const requestOrigin = c.req.header('origin');

    if (requestOrigin && !isTrustedOrigin(requestOrigin, c.req.url, appEnv.allowedCorsOrigins)) {
        throw new HTTPException(403, { message: 'Untrusted origin.' });
    }

    return next();
});
