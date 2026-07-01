import { appEnv } from '@/lib/env';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded audio/cover files physically live. Selected at runtime: R2 when its
 * credentials are configured, otherwise the local public/audio/ backend (dev only — the
 * filesystem is read-only on Vercel).
 */
export interface AudioStorage {
    put(key: string, bytes: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
}

const PUBLIC_AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function contentTypeForKey(key: string): string {
    switch (path.extname(key).toLowerCase()) {
        case '.mp3':
            return 'audio/mpeg';
        case '.m4a':
            return 'audio/mp4';
        case '.aac':
            return 'audio/aac';
        case '.ogg':
        case '.opus':
            return 'audio/ogg';
        case '.webm':
            return 'audio/webm';
        case '.wav':
            return 'audio/wav';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
}

class LocalAudioStorage implements AudioStorage {
    async put(key: string, bytes: Uint8Array): Promise<void> {
        await mkdir(PUBLIC_AUDIO_DIR, { recursive: true });
        await writeFile(path.join(PUBLIC_AUDIO_DIR, key), bytes);
    }

    async remove(key: string): Promise<void> {
        await rm(path.join(PUBLIC_AUDIO_DIR, key), { force: true });
    }
}

// The R2 config is fixed for the process lifetime, so build the S3Client once and share it
// across every put/remove/presign instead of paying the credential-provider + HTTP-handler
// setup on each admin request.
let cachedClient: S3Client | null = null;

function getR2Client(config: NonNullable<typeof appEnv.r2>): S3Client {
    if (!cachedClient) {
        cachedClient = new S3Client({
            region: 'auto',
            endpoint: config.endpoint,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
            // Don't bake a CRC32 checksum into presigned URLs — R2 + browser PUT can't satisfy the
            // precomputed placeholder, which breaks the upload. Harmless for server-side puts.
            requestChecksumCalculation: 'WHEN_REQUIRED',
        });
    }
    return cachedClient;
}

class R2AudioStorage implements AudioStorage {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(config: NonNullable<typeof appEnv.r2>) {
        this.client = getR2Client(config);
        this.bucket = config.bucket;
    }

    async put(key: string, bytes: Uint8Array): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: bytes,
                ContentType: contentTypeForKey(key),
                CacheControl: IMMUTABLE_CACHE,
            }),
        );
    }

    async remove(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
}

export function getAudioStorage(): AudioStorage {
    return appEnv.r2 ? new R2AudioStorage(appEnv.r2) : new LocalAudioStorage();
}

export type PresignedUpload = { url: string; headers: Record<string, string> };

/**
 * A presigned PUT URL so the browser can upload a file straight to R2, bypassing the
 * serverless function (and its body-size limit). Returns null when R2 isn't configured —
 * callers then fall back to the multipart route (dev/local backend). The client must send
 * back the exact headers returned here, since they are part of the signature.
 */
export async function presignUpload(key: string): Promise<PresignedUpload | null> {
    if (!appEnv.r2) return null;

    const client = getR2Client(appEnv.r2);
    const contentType = contentTypeForKey(key);
    const command = new PutObjectCommand({
        Bucket: appEnv.r2.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: IMMUTABLE_CACHE,
    });
    const url = await getSignedUrl(client, command, { expiresIn: 600 });
    return { url, headers: { 'Content-Type': contentType, 'Cache-Control': IMMUTABLE_CACHE } };
}
