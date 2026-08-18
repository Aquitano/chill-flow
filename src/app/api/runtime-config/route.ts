import { appEnv } from '@/lib/env';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json({ sentryDsn: appEnv.sentryDsn ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
