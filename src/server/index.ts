import { appEnv } from '@/lib/env';
import { cors } from 'hono/cors';
import { j } from './jstack';
import { ambientRouter } from './routers/ambient-router';
import { preferencesRouter } from './routers/preferences-router';
import { presetsRouter } from './routers/presets-router';
import { sessionsRouter } from './routers/sessions-router';
import { tasksRouter } from './routers/tasks-router';
import { tracksRouter } from './routers/tracks-router';
import { isTrustedOrigin } from './security/origin';

const api = j
    .router()
    .basePath('/api')
    .use(
        cors({
            allowHeaders: ['x-is-superjson', 'Content-Type'],
            allowMethods: ['GET', 'POST', 'OPTIONS'],
            credentials: true,
            exposeHeaders: ['x-is-superjson'],
            maxAge: 600,
            origin: (origin, c) => {
                if (!origin) {
                    return null;
                }

                return isTrustedOrigin(origin, c.req.url, appEnv.allowedCorsOrigins) ? origin : null;
            },
        }),
    )
    .onError(j.defaults.errorHandler);

const appRouter = j.mergeRouters(api, {
    ambient: ambientRouter,
    preferences: preferencesRouter,
    presets: presetsRouter,
    sessions: sessionsRouter,
    tasks: tasksRouter,
    tracks: tracksRouter,
});

export type AppRouter = typeof appRouter;

export default appRouter;
