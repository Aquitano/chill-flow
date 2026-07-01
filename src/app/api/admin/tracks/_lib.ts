import { appEnv } from '@/lib/env';
import { getDatabase, type Database } from '@/server/db/client';
import { isAdminUser } from '@/server/security/admin';
import { isTrustedOrigin } from '@/server/security/origin';
import {
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    fileExtension,
} from '@/server/storage/asset-upload';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Auth + admin-role + trusted-origin + db guard shared by the multipart upload/replace
 * routes. The origin check mirrors adminMutationProcedure (jstack) so these hand-written
 * handlers get the same CSRF protection as the rest of the admin API.
 */
export async function requireAdminRequest(request: Request): Promise<{ database: Database } | { response: NextResponse }> {
    const { userId } = await auth();
    if (!userId) {
        return { response: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) };
    }
    if (!(await isAdminUser(userId))) {
        return { response: NextResponse.json({ message: 'Admin access required.' }, { status: 403 }) };
    }

    const origin = request.headers.get('origin');
    if (origin && !isTrustedOrigin(origin, request.url, appEnv.allowedCorsOrigins)) {
        return { response: NextResponse.json({ message: 'Untrusted origin.' }, { status: 403 }) };
    }

    const database = getDatabase();
    if (!database) {
        return { response: NextResponse.json({ message: 'Database is not configured.' }, { status: 503 }) };
    }

    return { database };
}

const ASSET_RULES = {
    audio: { extensions: AUDIO_EXTENSIONS, maxBytes: MAX_AUDIO_BYTES, fallbackExt: '.mp3', label: 'Audio file', typeLabel: 'audio' },
    image: { extensions: IMAGE_EXTENSIONS, maxBytes: MAX_IMAGE_BYTES, fallbackExt: '.jpg', label: 'Cover image', typeLabel: 'image' },
} as const;

/** Validate an uploaded file's size + extension, returning the normalized extension or a 4xx. */
export function validateAsset(file: File, kind: keyof typeof ASSET_RULES): { ext: string } | { response: NextResponse } {
    const rule = ASSET_RULES[kind];
    if (file.size > rule.maxBytes) {
        const limitMb = Math.round(rule.maxBytes / (1024 * 1024));
        return { response: NextResponse.json({ message: `${rule.label} exceeds the ${limitMb}MB limit.` }, { status: 413 }) };
    }
    const ext = fileExtension(file, rule.fallbackExt);
    if (!rule.extensions.has(ext)) {
        return { response: NextResponse.json({ message: `Unsupported ${rule.typeLabel} type: ${ext}` }, { status: 422 }) };
    }
    return { ext };
}
