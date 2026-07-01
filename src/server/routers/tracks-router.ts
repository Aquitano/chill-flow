import { appEnv } from '@/lib/env';
import { HTTPException } from 'hono/http-exception';
import { adminMutationProcedure, adminProcedure, j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, uniqueAssetKey } from '../storage/asset-upload';
import { getAudioStorage, presignUpload } from '../storage/audio-storage';
import {
    createTrackInputSchema,
    deleteTrackAdminInputSchema,
    presignTrackInputSchema,
    trackLookupInputSchema,
    updateTrackInputSchema,
} from '../validation/app';

async function removeStoredKeys(keys: (string | null | undefined)[]): Promise<void> {
    const storage = getAudioStorage();
    await Promise.all(
        keys.filter((key): key is string => Boolean(key)).map((key) => storage.remove(key).catch(() => {})),
    );
}

export const tracksRouter = j.router({
    list: publicProcedure.query(async ({ c, ctx }) => {
        c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
        if (!ctx.db) {
            return c.superjson([]);
        }
        return c.superjson(await appRepository.listTracks(ctx.db));
    }),

    getById: publicProcedure
        .input(trackLookupInputSchema)
        .query(async ({ c, ctx, input }) => {
            c.header('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
            if (!ctx.db) {
                return c.superjson(null);
            }
            return c.superjson(await appRepository.getTrackById(ctx.db, input.id));
        }),

    adminList: adminProcedure.query(async ({ c, ctx }) => {
        return c.superjson(await appRepository.adminListTracks(ctx.db));
    }),

    update: adminMutationProcedure.input(updateTrackInputSchema).mutation(async ({ c, ctx, input }) => {
        const { id, ...fields } = input;
        const replacesAsset = fields.storageKey !== undefined || fields.thumbnailKey !== undefined;
        const existing = replacesAsset ? await appRepository.getAdminTrackById(ctx.db, id) : null;

        const updated = await appRepository.updateTrack(ctx.db, id, fields);

        // Drop the superseded objects only after the row points at the new keys (mirrors the
        // multipart replace route). Presigned uploads always mint a fresh key, so a replace
        // would otherwise leak the previous object in R2.
        if (existing && updated) {
            await removeStoredKeys([
                fields.storageKey && existing.storageKey !== fields.storageKey ? existing.storageKey : null,
                fields.thumbnailKey && existing.thumbnailKey !== fields.thumbnailKey ? existing.thumbnailKey : null,
            ]);
        }
        return c.superjson(updated);
    }),

    delete: adminMutationProcedure.input(deleteTrackAdminInputSchema).mutation(async ({ c, ctx, input }) => {
        const removed = await appRepository.deleteTrack(ctx.db, input.id);
        if (removed) {
            // Best-effort: a missing file shouldn't fail the row deletion.
            await removeStoredKeys([removed.storageKey, removed.thumbnailKey]);
        }
        return c.superjson({ success: Boolean(removed) });
    }),

    create: adminMutationProcedure.input(createTrackInputSchema).mutation(async ({ c, ctx, input }) => {
        // The audio/cover were already PUT to R2 (unique keys, so no existing object was
        // overwritten); drop the now-orphaned uploads whenever the row isn't created.
        if (await appRepository.getTrackById(ctx.db, input.id)) {
            await removeStoredKeys([input.storageKey, input.thumbnailKey]);
            throw new HTTPException(409, { message: `A track with id "${input.id}" already exists.` });
        }
        try {
            return c.superjson(
                await appRepository.createTrack(ctx.db, {
                    id: input.id,
                    storageKey: input.storageKey,
                    title: input.title,
                    artist: input.artist,
                    category: input.category,
                    tags: input.tags,
                    durationSec: input.durationSec,
                    thumbnailKey: input.thumbnailKey ?? null,
                }),
            );
        } catch (error) {
            await removeStoredKeys([input.storageKey, input.thumbnailKey]);
            throw error;
        }
    }),

    // Hand the browser presigned PUT URLs so it uploads files straight to R2, bypassing the
    // serverless body-size limit. Falls back to 'local' (multipart route) when R2 is off.
    presignUpload: adminMutationProcedure.input(presignTrackInputSchema).mutation(async ({ c, input }) => {
        if (!appEnv.isR2Configured) {
            return c.superjson({ mode: 'local' as const });
        }

        let audio: { key: string; url: string; headers: Record<string, string> } | null = null;
        let cover: { key: string; url: string; headers: Record<string, string> } | null = null;

        if (input.audioExt) {
            if (!AUDIO_EXTENSIONS.has(input.audioExt)) {
                throw new HTTPException(422, { message: `Unsupported audio type: ${input.audioExt}` });
            }
            // Direct-to-R2 PUTs bypass the serverless body, so the multipart route's size cap
            // can't apply. Enforce it here on the declared size (the client also checks locally).
            if (input.audioBytes && input.audioBytes > MAX_AUDIO_BYTES) {
                throw new HTTPException(413, { message: 'Audio file exceeds the 50MB limit.' });
            }
            const key = uniqueAssetKey(input.id, input.audioExt);
            const signed = await presignUpload(key);
            if (signed) audio = { key, ...signed };
        }
        if (input.coverExt) {
            if (!IMAGE_EXTENSIONS.has(input.coverExt)) {
                throw new HTTPException(422, { message: `Unsupported image type: ${input.coverExt}` });
            }
            if (input.coverBytes && input.coverBytes > MAX_IMAGE_BYTES) {
                throw new HTTPException(413, { message: 'Cover image exceeds the 5MB limit.' });
            }
            const key = uniqueAssetKey(`cover-${input.id}`, input.coverExt);
            const signed = await presignUpload(key);
            if (signed) cover = { key, ...signed };
        }

        return c.superjson({ mode: 'r2' as const, audio, cover });
    }),
});
