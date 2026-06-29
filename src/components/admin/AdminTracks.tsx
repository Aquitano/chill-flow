'use client';

import { Button } from '@/components/ui/button';
import {
    useAdminTracksQuery,
    useDeleteTrackMutation,
    useUpdateTrackMutation,
    useUploadTrackMutation,
} from '@/hooks/use-admin-data';
import { describeApiError } from '@/lib/api';
import { AdminTrack } from '@/models/app';
import { useState } from 'react';
import { toast } from 'sonner';

const inputClass =
    'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none';

function formatDuration(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function ImportForm() {
    const upload = useUploadTrackMutation();
    const [file, setFile] = useState<File | null>(null);
    const [id, setId] = useState('');
    const [idTouched, setIdTouched] = useState(false);
    const [title, setTitle] = useState('');
    const [artist, setArtist] = useState('');
    const [category, setCategory] = useState('focus');
    const [tags, setTags] = useState('');

    const reset = () => {
        setFile(null);
        setId('');
        setIdTouched(false);
        setTitle('');
        setArtist('');
        setCategory('focus');
        setTags('');
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!file) {
            toast.error('Choose an audio file to import.');
            return;
        }
        const form = new FormData();
        form.set('file', file);
        form.set('id', id);
        form.set('title', title);
        form.set('artist', artist);
        form.set('category', category);
        form.set('tags', tags);

        upload.mutate(form, {
            onSuccess: (track) => {
                toast.success(`Imported "${track.title}"`);
                reset();
            },
            onError: (error) => toast.error('Import failed', { description: describeApiError(error) }),
        });
    };

    return (
        <form onSubmit={handleSubmit} className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-lg font-semibold">Import a track</h2>
            <p className="mt-1 text-sm text-neutral-400">
                Upload an audio file; duration is detected automatically. Files are stored under{' '}
                <code className="text-neutral-300">public/audio/</code> in development.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="md:col-span-2">
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">Audio file</span>
                    <input
                        type="file"
                        accept="audio/*"
                        className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white`}
                        onChange={(event) => {
                            const next = event.target.files?.[0] ?? null;
                            setFile(next);
                            if (next && !idTouched && !id) setId(slugify(next.name.replace(/\.[^.]+$/, '')));
                        }}
                    />
                </label>

                <label>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">Title</span>
                    <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Relax & Recharge" />
                </label>
                <label>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">Artist</span>
                    <input className={inputClass} value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="UnioMystica" />
                </label>
                <label>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                        Id (used for the file name)
                    </span>
                    <input
                        className={inputClass}
                        value={id}
                        onChange={(e) => {
                            setIdTouched(true);
                            setId(e.target.value);
                        }}
                        placeholder="relax-recharge-01"
                    />
                </label>
                <label>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">Category</span>
                    <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="focus" />
                </label>
                <label className="md:col-span-2">
                    <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                        Tags (comma-separated)
                    </span>
                    <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="focus, electronic" />
                </label>
            </div>

            <div className="mt-4 flex justify-end">
                <Button type="submit" disabled={upload.isPending} className="bg-white text-black hover:bg-neutral-200">
                    {upload.isPending ? 'Importing…' : 'Import track'}
                </Button>
            </div>
        </form>
    );
}

function TrackRow({ track }: { track: AdminTrack }) {
    const update = useUpdateTrackMutation();
    const remove = useDeleteTrackMutation();
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(track.title);
    const [artist, setArtist] = useState(track.artist);
    const [category, setCategory] = useState(track.category ?? '');
    const [tags, setTags] = useState(track.tags.join(', '));
    const [durationSec, setDurationSec] = useState(String(track.duration));

    const cancel = () => {
        setTitle(track.title);
        setArtist(track.artist);
        setCategory(track.category ?? '');
        setTags(track.tags.join(', '));
        setDurationSec(String(track.duration));
        setIsEditing(false);
    };

    const save = () => {
        update.mutate(
            {
                id: track.id,
                title,
                artist,
                category,
                tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
                durationSec: Number(durationSec) || 0,
            },
            {
                onSuccess: () => {
                    toast.success('Track updated');
                    setIsEditing(false);
                },
                onError: (error) => toast.error('Update failed', { description: describeApiError(error) }),
            },
        );
    };

    const handleDelete = () => {
        if (!window.confirm(`Delete "${track.title}"? This also removes its audio file.`)) return;
        remove.mutate(
            { id: track.id },
            {
                onSuccess: () => toast.success('Track deleted'),
                onError: (error) => toast.error('Delete failed', { description: describeApiError(error) }),
            },
        );
    };

    if (isEditing) {
        return (
            <tr className="border-t border-white/10 align-top">
                <td className="p-3" colSpan={6}>
                    <div className="grid gap-3 md:grid-cols-2">
                        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
                        <input className={inputClass} value={artist} onChange={(e) => setArtist(e.target.value)} aria-label="Artist" />
                        <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" />
                        <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
                        <input
                            className={inputClass}
                            type="number"
                            min={0}
                            value={durationSec}
                            onChange={(e) => setDurationSec(e.target.value)}
                            aria-label="Duration in seconds"
                        />
                        <p className="self-center text-xs text-neutral-500">
                            key: <code className="text-neutral-400">{track.storageKey}</code>
                        </p>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <Button onClick={save} disabled={update.isPending} className="bg-white text-black hover:bg-neutral-200">
                            {update.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button onClick={cancel} variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">
                            Cancel
                        </Button>
                    </div>
                </td>
            </tr>
        );
    }

    return (
        <tr className="border-t border-white/10">
            <td className="p-3">
                <div className="font-medium">{track.title}</div>
                <div className="text-xs text-neutral-500">{track.id}</div>
            </td>
            <td className="p-3 text-neutral-300">{track.artist}</td>
            <td className="p-3 text-neutral-300">{track.category ?? '—'}</td>
            <td className="p-3 text-neutral-400">{track.tags.join(', ') || '—'}</td>
            <td className="p-3 tabular-nums text-neutral-300">{formatDuration(track.duration)}</td>
            <td className="p-3">
                <div className="flex justify-end gap-2">
                    <Button
                        onClick={() => setIsEditing(true)}
                        variant="outline"
                        className="border-white/15 bg-transparent text-white hover:bg-white/10"
                    >
                        Edit
                    </Button>
                    <Button
                        onClick={handleDelete}
                        disabled={remove.isPending}
                        variant="outline"
                        className="border-rose-500/30 bg-transparent text-rose-300 hover:bg-rose-500/10"
                    >
                        Delete
                    </Button>
                </div>
            </td>
        </tr>
    );
}

export function AdminTracks() {
    const tracksQuery = useAdminTracksQuery();
    const tracks = tracksQuery.data ?? [];

    return (
        <div className="space-y-8">
            <ImportForm />

            <div className="rounded-lg border border-white/10 bg-white/[0.03]">
                <div className="flex items-center justify-between border-b border-white/10 p-4">
                    <h2 className="text-lg font-semibold">Catalog</h2>
                    <span className="text-sm text-neutral-400">{tracks.length} track(s)</span>
                </div>

                {tracksQuery.isLoading ? (
                    <p className="p-6 text-sm text-neutral-400">Loading tracks…</p>
                ) : tracksQuery.isError ? (
                    <p className="p-6 text-sm text-rose-300">{describeApiError(tracksQuery.error)}</p>
                ) : tracks.length === 0 ? (
                    <p className="p-6 text-sm text-neutral-400">No tracks yet. Import one above.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase tracking-wide text-neutral-500">
                                <tr>
                                    <th className="p-3 font-medium">Title</th>
                                    <th className="p-3 font-medium">Artist</th>
                                    <th className="p-3 font-medium">Category</th>
                                    <th className="p-3 font-medium">Tags</th>
                                    <th className="p-3 font-medium">Duration</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {tracks.map((track) => (
                                    <TrackRow key={track.id} track={track} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
