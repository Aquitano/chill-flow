import { siteOrigin } from '@/lib/site-url';
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
    const origin = siteOrigin();
    return [
        { url: origin, changeFrequency: 'monthly', priority: 1 },
        { url: `${origin}/soundscapes`, changeFrequency: 'weekly', priority: 0.8 },
    ];
}
