import type { AppRouter } from '@/server';
import { createClient } from 'jstack';

/**
 * Resolve the API base URL. In the browser, use the current origin. On the server (SSR),
 * prefer an explicit app URL, then Vercel's deployment URL, falling back to localhost for
 * local dev — never hardcode localhost in production.
 */
function getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
        return `${window.location.origin}/api`;
    }
    const explicit = process.env.NEXT_PUBLIC_APP_URL;
    if (explicit) {
        return `${explicit.replace(/\/$/, '')}/api`;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}/api`;
    }
    return 'http://localhost:3000/api';
}

/**
 * Your type-safe API client
 * @see https://jstack.app/docs/backend/api-client
 */
export const client = createClient<AppRouter>({
    baseUrl: getApiBaseUrl(),
});
