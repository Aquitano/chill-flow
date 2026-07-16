import type { AppRouter } from '@/server';
import { createClient } from 'jstack';

/**
 * On the server, resolve from NEXT_PUBLIC_APP_URL / VERCEL_URL so production SSR never points
 * at localhost; in the browser, use the current origin.
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

export const client = createClient<AppRouter>({
    baseUrl: getApiBaseUrl(),
});
