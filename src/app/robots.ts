import { siteOrigin } from '@/lib/site-url';
import type { MetadataRoute } from 'next';

// Only the landing page and the soundscapes catalog are public; everything else sits
// behind auth and would only waste crawl on redirects.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/api/', '/app', '/account', '/admin'],
        },
        sitemap: `${siteOrigin()}/sitemap.xml`,
    };
}
