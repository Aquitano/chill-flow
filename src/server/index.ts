import { j } from './jstack';
import { preferencesRouter } from './routers/preferences-router';
import { sessionsRouter } from './routers/sessions-router';
import { tasksRouter } from './routers/tasks-router';
import { tracksRouter } from './routers/tracks-router';

/**
 * This is your base API.
 * Here, you can handle errors, not-found responses, cors and more.
 *
 * @see https://jstack.app/docs/backend/app-router
 */
const api = j.router().basePath('/api').use(j.defaults.cors).onError(j.defaults.errorHandler);

/**
 * This is the main router for your server.
 * All routers in /server/routers should be added here manually.
 */
const appRouter = j.mergeRouters(api, {
    preferences: preferencesRouter,
    sessions: sessionsRouter,
    tasks: tasksRouter,
    tracks: tracksRouter,
});

export type AppRouter = typeof appRouter;

export default appRouter;
