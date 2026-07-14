import * as Sentry from '@sentry/nextjs';
import { appEnv } from '@/lib/env';

if (appEnv.sentryDsn) {
    Sentry.init({
        dsn: appEnv.sentryDsn,

        tracesSampleRate: 1,

        debug: false,

        spotlight: process.env.NODE_ENV === 'development',
        enabled: process.env.NODE_ENV === 'production',
    });
}
