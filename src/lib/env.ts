import { parseAllowedOrigins } from '@/server/security/origin';
import { z } from 'zod';

const envSchema = z.object({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    DATABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
    ALLOWED_CORS_ORIGINS: z.string().optional(),
    AUDIO_BASE_URL: z.string().optional(),
});

const parsedEnv = envSchema.safeParse({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    ALLOWED_CORS_ORIGINS: process.env.ALLOWED_CORS_ORIGINS,
    AUDIO_BASE_URL: process.env.AUDIO_BASE_URL,
});

const rawEnv = parsedEnv.success ? parsedEnv.data : {};

// Base for resolving track storage keys to playable URLs. Server-only (not NEXT_PUBLIC):
// the catalog router resolves keys before sending them to the client. Dev serves audio
// same-origin from public/audio/ ('/audio'); prod points at the public R2 bucket.
const audioBaseUrl = (rawEnv.AUDIO_BASE_URL ?? '/audio').replace(/\/+$/, '');

export const appEnv = {
    clerkPublishableKey: rawEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: rawEnv.CLERK_SECRET_KEY,
    databaseUrl: rawEnv.DATABASE_URL,
    sentryDsn: rawEnv.NEXT_PUBLIC_SENTRY_DSN,
    allowedCorsOrigins: parseAllowedOrigins(rawEnv.ALLOWED_CORS_ORIGINS),
    audioBaseUrl,
    isClerkConfigured: Boolean(rawEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && rawEnv.CLERK_SECRET_KEY),
    isDatabaseConfigured: Boolean(rawEnv.DATABASE_URL),
    isSentryConfigured: Boolean(rawEnv.NEXT_PUBLIC_SENTRY_DSN),
};

export function getEnvWarnings() {
    const warnings: string[] = [];

    if (!appEnv.isClerkConfigured) {
        warnings.push('Clerk keys are missing. Sign-in and the protected workspace are disabled until Clerk is configured.');
    }

    if (!appEnv.isDatabaseConfigured) {
        warnings.push('DATABASE_URL is missing. Protected workspace APIs are disabled until the database is configured.');
    }

    if (!appEnv.isSentryConfigured) {
        warnings.push('NEXT_PUBLIC_SENTRY_DSN is missing. Sentry is disabled.');
    }

    return warnings;
}
