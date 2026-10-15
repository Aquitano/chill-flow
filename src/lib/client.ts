import { siteOrigin } from '@/lib/site-url';
import type { AppRouter } from '@/server';
import { createClient } from 'jstack';

/**
 * In the browser, use the current origin; on the server, resolve through siteOrigin so
 * production SSR never points at localhost.
 */
function getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
        return `${window.location.origin}/api`;
    }
    return `${siteOrigin()}/api`;
}

export const client = createClient<AppRouter>({
    baseUrl: getApiBaseUrl(),
});
