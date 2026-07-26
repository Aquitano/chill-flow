import { appEnv } from '@/lib/env';
import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { isTrustedOrigin } from '@/server/security/origin';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { flushSessionInputSchema } from '@/server/validation/app';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Last-chance write of a finished focus block as the page goes away.
 *
 * The workspace's own paths use the jstack mutations; this exists only for `keepalive`
 * requests, which the browser promises to finish after unload but which cannot carry the
 * jstack client's superjson envelope. Both repository calls are idempotent, so a beacon
 * that overlaps the in-app complete is harmless.
 */
export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const origin = request.headers.get('origin');
    if (origin && !isTrustedOrigin(origin, request.url, appEnv.allowedCorsOrigins)) {
        return NextResponse.json({ message: 'Untrusted origin.' }, { status: 403 });
    }

    const database = getDatabase();
    if (!database) {
        return NextResponse.json({ message: 'Database is not configured.' }, { status: 503 });
    }

    const parsed = flushSessionInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ message: 'Invalid session flush payload.' }, { status: 422 });
    }

    const input = parsed.data;

    // Draw from the same bucket as the jstack mutation this stands in for, rather than
    // handing every user a second 30/min allowance for the identical write. The middleware
    // can't be reused here: it throws, and a plain route handler has nothing to catch it.
    try {
        consumeRateLimit(userId, {
            key: input.outcome === 'completed' ? 'sessions:complete' : 'sessions:cancel',
            limit: 30,
            windowMs: 60_000,
        });
    } catch {
        return NextResponse.json({ message: 'Too many requests. Please retry later.' }, { status: 429 });
    }

    if (input.outcome === 'completed') {
        await appRepository.completeSession(database, userId, input.id, input.elapsedSeconds);
    } else {
        await appRepository.cancelSession(database, userId, input.id);
    }

    return new NextResponse(null, { status: 204 });
}
