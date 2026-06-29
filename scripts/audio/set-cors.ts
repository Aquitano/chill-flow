import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { appEnv } from '../../src/lib/env';

// Apply scripts/audio/cors.json to the R2 bucket via the S3 API. Required because the audio
// engine uses crossOrigin="anonymous" + Web Audio, which fails silently without CORS.

const r2 = appEnv.r2;
if (!r2) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env.');
    process.exit(1);
}

const corsPath = path.join(process.cwd(), 'scripts', 'audio', 'cors.json');
const rules = JSON.parse(readFileSync(corsPath, 'utf8'));

const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
});

await client.send(new PutBucketCorsCommand({ Bucket: r2.bucket, CORSConfiguration: { CORSRules: rules } }));

console.log(`Applied CORS policy from cors.json to bucket "${r2.bucket}".`);
console.log('Reminder: cors.json must list your production origin(s) in AllowedOrigins.');
