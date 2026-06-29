import { parseAllowedOrigins } from '@/server/security/origin';
import { z } from 'zod';

const envSchema = z.object({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    DATABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
    ALLOWED_CORS_ORIGINS: z.string().optional(),
    AUDIO_BASE_URL: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_JURISDICTION: z.string().optional(),
});

const parsedEnv = envSchema.safeParse({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    ALLOWED_CORS_ORIGINS: process.env.ALLOWED_CORS_ORIGINS,
    AUDIO_BASE_URL: process.env.AUDIO_BASE_URL,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_JURISDICTION: process.env.R2_JURISDICTION,
});

const rawEnv = parsedEnv.success ? parsedEnv.data : {};

// R2 upload backend is active only when all four credentials are present; otherwise admin
// uploads fall back to the local public/audio/ backend (dev only).
// R2 buckets in a jurisdiction (e.g. "eu") use a region-prefixed S3 endpoint; the default
// jurisdiction uses the bare account endpoint.
function r2Endpoint(accountId: string, jurisdiction?: string): string {
    const region = jurisdiction?.trim().toLowerCase();
    const infix = region && region !== 'default' ? `${region}.` : '';
    return `https://${accountId}.${infix}r2.cloudflarestorage.com`;
}

const r2 =
    rawEnv.R2_ACCOUNT_ID && rawEnv.R2_ACCESS_KEY_ID && rawEnv.R2_SECRET_ACCESS_KEY && rawEnv.R2_BUCKET
        ? {
              accountId: rawEnv.R2_ACCOUNT_ID,
              accessKeyId: rawEnv.R2_ACCESS_KEY_ID,
              secretAccessKey: rawEnv.R2_SECRET_ACCESS_KEY,
              bucket: rawEnv.R2_BUCKET,
              endpoint: r2Endpoint(rawEnv.R2_ACCOUNT_ID, rawEnv.R2_JURISDICTION),
          }
        : null;

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
    r2,
    isR2Configured: Boolean(r2),
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
