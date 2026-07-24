import { formatDuration } from '@/lib/tracks';
import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

// Catalog lives in the DB now, so this page reads at request time rather than being baked
// into the static build (which would run a DB query against tracks during `next build`).
export const dynamic = 'force-dynamic';

export default async function SoundscapesPage() {
    const database = getDatabase();
    const tracks = database ? await appRepository.listTracks(database) : [];

    return (
        <main className="bg-night text-ink min-h-screen px-6 py-16">
            <div className="mx-auto max-w-5xl">
                <h1 className="text-4xl font-semibold">Soundscapes</h1>
                <p className="text-ink-mid mt-3 max-w-2xl">
                    Everything in the catalog right now. Pick one to open your workspace with it selected.
                </p>

                {tracks.length === 0 ? (
                    <p className="text-ink-dim mt-10 rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
                        No soundscapes have been published yet.
                    </p>
                ) : (
                    <ul className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {tracks.map((track) => (
                            <li key={track.id}>
                                <Link
                                    href={`/app?track=${encodeURIComponent(track.id)}`}
                                    className="focus-visible:outline-ember group block h-full rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-2"
                                >
                                    <p className="text-ink-dim text-xs tracking-[0.2em] uppercase">{track.category}</p>
                                    <h2 className="mt-3 flex items-start justify-between gap-2 text-xl font-medium">
                                        {track.title}
                                        <ArrowUpRight
                                            className="text-ink-dim group-hover:text-ember mt-1 size-4 shrink-0 transition-colors"
                                            aria-hidden
                                        />
                                    </h2>
                                    <p className="text-ink-mid mt-2 text-sm">
                                        {track.artist} · {formatDuration(track.duration)}
                                    </p>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {track.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="text-ink-mid rounded-full bg-white/10 px-2 py-1 text-xs"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}

                <Link
                    href="/app"
                    className="focus-visible:outline-ember mt-10 inline-flex rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm transition hover:bg-white/20 focus-visible:outline-2"
                >
                    Open workspace
                </Link>
            </div>
        </main>
    );
}
