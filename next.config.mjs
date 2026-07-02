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
        // Upload a larger set of source maps for prettier stack traces (increases build time)
        widenClientFileUpload: true,
        transpileClientSDK: false,

        // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
        // This can increase your server load as well as your hosting bill.
        // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
        // side errors will fail.
        // tunnelRoute: "/monitoring",

        hideSourceMaps: true,
        disableLogger: true,
        automaticVercelMonitors: true,
    },
);

const config = process.env.DEBUG_MILLION ? MillionLint.next({ rsc: true })(sentryConfig) : sentryConfig;

export default config;
