import { appEnv } from '@/lib/env';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/app(.*)', '/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
    if (!appEnv.isClerkConfigured) {
        return;
    }

    if (isProtectedRoute(req) && !appEnv.isDatabaseConfigured) {
        return NextResponse.redirect(new URL('/account', req.url));
    }

    if (isProtectedRoute(req)) {
        await auth.protect();
    }
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params.
        // /api/health is excluded too: clerkMiddleware throws when Clerk keys are missing, and
        // a liveness probe that depends on auth config can't report "the process is up".
        '/((?!_next|api/health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)((?!/health$).*)',
    ],
};
