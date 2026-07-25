import { appEnv } from '@/lib/env';
import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { isTrustedOrigin } from '@/server/security/origin';
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
    if (input.outcome === 'completed') {
        await appRepository.completeSession(database, userId, input.id, input.elapsedSeconds);
    } else {
        await appRepository.cancelSession(database, userId, input.id);
    }

    return new NextResponse(null, { status: 204 });
}
