import { appEnv } from '@/lib/env';
import { HTTPException } from 'hono/http-exception';
import { adminMutationProcedure, adminProcedure, j, publicProcedure } from '../jstack';
import { appRepository } from '../repositories/app-repository';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../storage/asset-upload';
import { getAudioStorage, presignUpload } from '../storage/audio-storage';
import {
    createTrackInputSchema,
    deleteTrackAdminInputSchema,
    presignTrackInputSchema,
    trackLookupInputSchema,
    updateTrackInputSchema,
} from '../validation/app';

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
        return c.superjson(await appRepository.updateTrack(ctx.db, id, fields));
    }),

    delete: adminMutationProcedure.input(deleteTrackAdminInputSchema).mutation(async ({ c, ctx, input }) => {
        const removed = await appRepository.deleteTrack(ctx.db, input.id);
        if (removed) {
            // Best-effort: a missing file shouldn't fail the row deletion.
            const storage = getAudioStorage();
            await Promise.all(
                [removed.storageKey, removed.thumbnailKey]
                    .filter((key): key is string => Boolean(key))
                    .map((key) => storage.remove(key).catch(() => {})),
            );
        }
        return c.superjson({ success: Boolean(removed) });
    }),

    create: adminMutationProcedure.input(createTrackInputSchema).mutation(async ({ c, ctx, input }) => {
        if (await appRepository.getTrackById(ctx.db, input.id)) {
            throw new HTTPException(409, { message: `A track with id "${input.id}" already exists.` });
        }
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
            const key = `${input.id}${input.audioExt}`;
            const signed = await presignUpload(key);
            if (signed) audio = { key, ...signed };
        }
        if (input.coverExt) {
            if (!IMAGE_EXTENSIONS.has(input.coverExt)) {
                throw new HTTPException(422, { message: `Unsupported image type: ${input.coverExt}` });
            }
            const key = `cover-${input.id}${input.coverExt}`;
            const signed = await presignUpload(key);
            if (signed) cover = { key, ...signed };
        }

        return c.superjson({ mode: 'r2' as const, audio, cover });
    }),
});
