import type { Metadata } from 'next';
import { Cormorant, Inter } from 'next/font/google';
import { Providers } from '../components/providers';

import { ClerkProvider } from '@clerk/nextjs';
import { appEnv } from '@/lib/env';

import './globals.css';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
});

const cormorant = Cormorant({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-cormorant',
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

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <ClerkProvider publishableKey={appEnv.clerkPublishableKey}>
            <html lang="en" className={`${inter.className} ${cormorant.className} dark`}>
                <body className="antialiased">
                    <Providers>{children}</Providers>
                </body>
            </html>
        </ClerkProvider>
    );
}
