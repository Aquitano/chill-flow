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

const sentryConfig = withSentryConfig(nextConfig, {
    silent: true,
    telemetry: false,
    // A public, reusable image has no single Sentry project to upload source maps to.
    sourcemaps: { disable: true },
    webpack: { treeshake: { removeDebugLogging: true } },
});

const config = process.env.DEBUG_MILLION ? MillionLint.next({ rsc: true })(sentryConfig) : sentryConfig;

export default config;
