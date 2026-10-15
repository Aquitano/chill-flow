import type { Metadata } from 'next';
import { Inter, Spectral } from 'next/font/google';
import { Providers } from '../components/providers';

import { ClerkProvider } from '@clerk/nextjs';
import { appEnv } from '@/lib/env';
import { siteOrigin } from '@/lib/site-url';

import './globals.css';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
});

const spectral = Spectral({
    subsets: ['latin'],
    weight: ['300', '400', '500'],
    style: ['normal', 'italic'],
    display: 'swap',
    variable: '--font-spectral',
});

export const metadata: Metadata = {
    metadataBase: new URL(siteOrigin()),
    title: {
        default: 'ChillFlow - Focus and Productivity with Lo-Fi Beats',
        template: '%s - ChillFlow',
    },
    description:
        'Boost your productivity with curated lo-fi beats and ambient sounds. ChillFlow helps you achieve deep focus and flow state.',
    icons: [{ rel: 'icon', url: '/favicon.ico' }],
    keywords: ['lofi', 'productivity', 'focus', 'ambient sounds', 'pomodoro', 'flow state'],
    openGraph: {
        title: 'ChillFlow - Focus and Productivity with Lo-Fi Beats',
        description: 'Boost your productivity with curated lo-fi beats and ambient sounds',
        siteName: 'ChillFlow',
        locale: 'en_US',
        type: 'website',
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <ClerkProvider publishableKey={appEnv.clerkPublishableKey}>
            <html lang="en" className={`${inter.variable} ${spectral.variable} dark`}>
                <body className="antialiased">
                    <Providers>{children}</Providers>
                </body>
            </html>
        </ClerkProvider>
    );
}
