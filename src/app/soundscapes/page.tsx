import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import Link from 'next/link';

// Catalog lives in the DB now, so this page reads at request time rather than being baked
// into the static build (which would run a DB query against tracks during `next build`).
export const dynamic = 'force-dynamic';

export default async function SoundscapesPage() {
    const database = getDatabase();
    const tracks = database ? await appRepository.listTracks(database) : [];

    return (
        <main className="min-h-screen bg-black px-6 py-16 text-white">
            <div className="mx-auto max-w-5xl">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Catalog</p>
                <h1 className="mt-3 text-4xl font-semibold">Soundscapes</h1>
                <p className="mt-3 max-w-2xl text-neutral-400">
                    The focus app now uses a real track catalog instead of placeholder player metadata. Pick a track and
                    jump into the workspace.
                </p>

                <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {tracks.map((track) => (
                        <div key={track.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                            <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">{track.category}</p>
                            <h2 className="mt-3 text-xl font-medium">{track.title}</h2>
                            <p className="mt-2 text-sm text-neutral-400">{track.artist}</p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {track.tags.map((tag) => (
                                    <span key={tag} className="rounded-full bg-white/10 px-2 py-1 text-xs text-neutral-300">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <Link
                    href="/app"
                    className="mt-10 inline-flex rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm transition hover:bg-white/20"
                >
                    Open workspace
                </Link>
            </div>
        </main>
    );
}
