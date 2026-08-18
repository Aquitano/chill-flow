import * as Sentry from '@sentry/nextjs';

type RuntimeConfig = {
    sentryDsn: string | null;
};

async function initializeSentry() {
    try {
        const response = await fetch('/api/runtime-config', { cache: 'no-store' });
        if (!response.ok) return;

        const { sentryDsn } = (await response.json()) as RuntimeConfig;
        if (!sentryDsn) return;

        Sentry.init({
            dsn: sentryDsn,

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
    } catch {
        // Observability is optional and must never prevent the application from starting.
    }
}

void initializeSentry();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
