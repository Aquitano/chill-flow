import type { MetadataRoute } from 'next';

// The manifest is what makes ChillFlow installable: Android offers it as a PWA, and iOS
// Safari only permits Web Notifications for an app added to the Home Screen — so the
// timer-notification preference depends on this existing (see lib/notifications.ts).
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'ChillFlow',
        short_name: 'ChillFlow',
        description: 'Curated lo-fi beats, ambient sound, and focus timers for deep work.',
        start_url: '/app',
        display: 'standalone',
        background_color: '#0e0c08',
        theme_color: '#0e0c08',
        icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
}
