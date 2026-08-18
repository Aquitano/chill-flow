import { appEnv, getClerkPublishableKey } from '@/lib/env';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/app(.*)', '/admin(.*)']);

export default clerkMiddleware(
    async (auth, req) => {
        if (!appEnv.isClerkConfigured) {
            return;
        }

        if (isProtectedRoute(req) && !appEnv.isDatabaseConfigured) {
            return NextResponse.redirect(new URL('/account', req.url));
        }

        if (isProtectedRoute(req)) {
            await auth.protect();
        }
    },
    () => ({ publishableKey: getClerkPublishableKey() }),
);

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params.
        // Public operational endpoints are excluded too: neither liveness nor browser runtime
        // config should depend on Clerk being configured successfully.
        '/((?!_next|api/(?:health|runtime-config)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)((?!/(?:health|runtime-config)$).*)',
    ],
};
