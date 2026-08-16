import MillionLint from '@million/lint';
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'images.unsplash.com',
            },
            // R2 track assets (covers) served from the project CDN.
            {
                protocol: 'https',
                hostname: 'chill-data.aquitano.me',
            },
        ],
    },
};

const sentryConfig = withSentryConfig(
    nextConfig,
    {
        silent: true,
        org: 'aquitano',
        project: 'chill-flow',
    },
    {
        // Increases build time.
        widenClientFileUpload: true,
        transpileClientSDK: false,

        hideSourceMaps: true,
        disableLogger: true,
        automaticVercelMonitors: true,
    },
);

const config = process.env.DEBUG_MILLION ? MillionLint.next({ rsc: true })(sentryConfig) : sentryConfig;

export default config;
