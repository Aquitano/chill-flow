import { captureRequestError } from '@sentry/nextjs';

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('../instrumentation-server');
    }
}

export const onRequestError = captureRequestError;
