import { appEnv } from '@/lib/env';
import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Clerk account lifecycle. Clerk owns identity, so `user.deleted` is the only signal that a
 * user's workspace data should go with them — without it, deleting an account leaves their
 * tasks, sessions, and preferences in our database indefinitely.
 *
 * Clerk retries on a non-2xx, so failures that a retry could fix (missing database) answer
 * 5xx, and anything unactionable is acknowledged.
 */
export async function POST(request: NextRequest) {
    if (!appEnv.isClerkWebhookConfigured) {
        return NextResponse.json({ message: 'Webhooks are not configured.' }, { status: 503 });
    }

    let event;
    try {
        event = await verifyWebhook(request, { signingSecret: appEnv.clerkWebhookSigningSecret });
    } catch {
        return NextResponse.json({ message: 'Invalid webhook signature.' }, { status: 400 });
    }

    if (event.type !== 'user.deleted' || !event.data.id) {
        return new NextResponse(null, { status: 204 });
    }

    const database = getDatabase();
    if (!database) {
        return NextResponse.json({ message: 'Database is not configured.' }, { status: 503 });
    }

    await appRepository.deleteUserData(database, event.data.id);

    return new NextResponse(null, { status: 204 });
}
