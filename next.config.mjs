import MillionLint from '@million/lint';
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // Emits .next/standalone with a self-contained server.js, so the runtime image ships only
    // traced dependencies instead of the full node_modules tree.
    output: 'standalone',
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
        // Wider source-map upload buys readable stack traces at the cost of build time.
        widenClientFileUpload: true,
        transpileClientSDK: false,

        hideSourceMaps: true,
        disableLogger: true,
        automaticVercelMonitors: true,
    },
);

const config = process.env.DEBUG_MILLION ? MillionLint.next({ rsc: true })(sentryConfig) : sentryConfig;

export default config;
