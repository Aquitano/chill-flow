import { getDatabase } from '@/server/db/client';
import { exportFileName, isExportFormat, sessionsToCsv } from '@/server/account-export';
import { appRepository } from '@/server/repositories/app-repository';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Hands the account its own data back, as the counterweight to the deletion webhook: the
 * product already erases five tables on request, so it has to be able to export them too.
 *
 * A plain route handler rather than a jstack procedure because the response is a file — the
 * superjson envelope the client wraps every procedure result in is the wrong shape for
 * something the browser saves to disk.
 */
export async function GET(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const format = new URL(request.url).searchParams.get('format') ?? 'json';
    if (!isExportFormat(format)) {
        return NextResponse.json({ message: 'Unsupported export format.' }, { status: 422 });
    }

    const database = getDatabase();
    if (!database) {
        return NextResponse.json({ message: 'Database is not configured.' }, { status: 503 });
    }

    // Every export reads the account's whole history, so it is metered far tighter than the
    // workspace's ordinary reads. The middleware can't be reused here: it throws, and a
    // plain route handler has nothing to catch it.
    try {
        consumeRateLimit(userId, { key: 'account:export', limit: 5, windowMs: 60_000 });
    } catch {
        return NextResponse.json({ message: 'Too many requests. Please retry later.' }, { status: 429 });
    }

    const archive = await appRepository.exportUserData(database, userId);
    const filename = exportFileName(format, new Date(archive.exportedAt));

    const body = format === 'csv' ? sessionsToCsv(archive.focusSessions) : JSON.stringify(archive, null, 2);
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';

    return new NextResponse(body, {
        headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`,
            // Personal data, and cheap to regenerate — no shared cache should hold a copy.
            'Cache-Control': 'no-store',
        },
    });
}
