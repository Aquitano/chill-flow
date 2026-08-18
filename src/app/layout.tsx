import type { Metadata } from 'next';
import { Inter, Spectral } from 'next/font/google';
import { Providers } from '../components/providers';

import { ClerkProvider } from '@clerk/nextjs';
import { getClerkPublishableKey } from '@/lib/env';
import { connection } from 'next/server';

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
    title: 'ChillFlow - Focus and Productivity with Lo-Fi Beats',
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

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Defer rendering until request time so one container image can receive its Clerk key
    // from runtime environment variables instead of baking the key into the client bundle.
    await connection();
    const clerkPublishableKey = getClerkPublishableKey();

    return (
        <ClerkProvider publishableKey={clerkPublishableKey}>
            <html lang="en" className={`${inter.variable} ${spectral.variable} dark`}>
                <body className="antialiased">
                    <Providers>{children}</Providers>
                </body>
            </html>
        </ClerkProvider>
    );
}
