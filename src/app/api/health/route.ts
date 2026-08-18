import { NextResponse } from 'next/server';

// Liveness only — deliberately no database or R2 call, so a container restart loop can't be
// triggered by a transient dependency outage.
export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json({ status: 'ok' });
}
