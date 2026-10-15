/**
 * Public origin of the deployment, for anything that must carry absolute URLs
 * (Open Graph metadata, the sitemap, server-side API calls): the explicit
 * NEXT_PUBLIC_APP_URL first, then Vercel's inferred URL, then local dev.
 */
export function siteOrigin(): string {
    const explicit = process.env.NEXT_PUBLIC_APP_URL;
    if (explicit) {
        return explicit.replace(/\/$/, '');
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return 'http://localhost:3000';
}
