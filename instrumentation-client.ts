import * as Sentry from '@sentry/nextjs';
import { appEnv } from '@/lib/env';

if (appEnv.sentryDsn) {
    Sentry.init({
        dsn: appEnv.sentryDsn,

        tracesSampleRate: 1,

        debug: false,

        replaysOnErrorSampleRate: 1.0,

        replaysSessionSampleRate: 0.1,

        integrations: [
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
    });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
