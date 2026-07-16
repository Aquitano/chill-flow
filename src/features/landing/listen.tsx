'use client';

import { useTracksQuery } from '@/hooks/use-app-data';
import { backgroundCatalog } from '@/lib/backgrounds';
import { motion } from 'framer-motion';
import { Music, Pause, Play } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

function formatClock(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const EQ_BARS = [0, 0.18, 0.36, 0.1, 0.28];

/*
 * "Hear the room" — an honest demo. The preview streams the first track of the real
 * catalog (the same R2-hosted file the workspace plays), and the scenes are the actual
 * workspace backgrounds. Local /public audio is gitignored, so nothing here may
 * reference it.
 */
export function ListenSection() {
    const tracksQuery = useTracksQuery();
    const track = tracksQuery.data?.[0];

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTime = () => setCurrentTime(audio.currentTime);
        const onMeta = () => setDuration(audio.duration);
        // The element is the source of truth for play state, so OS media keys and
        // programmatic pauses keep the button and equalizer in sync.
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('loadedmetadata', onMeta);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onPause);
        return () => {
            audio.removeEventListener('timeupdate', onTime);
            audio.removeEventListener('loadedmetadata', onMeta);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onPause);
        };
    }, [track?.audioUrl]);

    // Pause (rather than leak) playback when the section unmounts.
    useEffect(() => {
        return () => audioRef.current?.pause();
    }, []);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
            void audio.play().catch(() => setPlaying(false));
        } else {
            audio.pause();
        }
    };

    const totalSeconds = duration > 0 ? duration : (track?.duration ?? 0);
    const progress = totalSeconds > 0 ? Math.min(currentTime / totalSeconds, 1) : 0;

    return (
        <section id="listen" className="relative z-10 mt-36 scroll-mt-24 sm:mt-44">
            <div className="mx-auto max-w-6xl px-6">
                <div className="grid items-center gap-12 lg:grid-cols-2">
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <h2 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                            Hear the <em className="font-serif font-light text-ember">room.</em>
                        </h2>
                        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-mid">
                            This is a track from the catalog — recorded, normalized for long sessions, and streamed by
                            the same player you&apos;ll use inside. Press play; no account needed.
                        </p>
                        <p className="mt-3 max-w-md text-sm text-ink-dim">
                            The catalog is small and honest today, and it grows track by track — never a wall of
                            filler.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {track ? (
                            <div
                                className={`rounded-2xl border border-white/10 bg-night-2 p-5 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] ${playing ? 'eq-playing' : ''}`}
                            >
                                <audio ref={audioRef} src={track.audioUrl} preload="metadata" />
                                <div className="flex items-center gap-4">
                                    {track.thumbnailUrl ? (
                                        <Image
                                            src={track.thumbnailUrl}
                                            alt={`Cover art for ${track.title}`}
                                            width={64}
                                            height={64}
                                            className="h-16 w-16 rounded-lg object-cover"
                                        />
                                    ) : (
                                        <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-ember/40 to-night">
                                            <Music className="h-6 w-6 text-ember" />
                                        </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium text-ink">{track.title}</p>
                                        <p className="truncate text-sm text-ink-dim">
                                            {track.artist}
                                            {track.category ? ` · ${track.category}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
                                        {EQ_BARS.map((delay, index) => (
                                            <span
                                                key={index}
                                                className="eq-bar w-[3px] rounded-full bg-ember"
                                                style={{ height: '100%', animationDelay: `${delay}s` }}
                                            />
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={togglePlay}
                                        aria-label={playing ? 'Pause preview' : 'Play preview'}
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ember text-night transition hover:bg-ember/90"
                                    >
                                        {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                                    </button>
                                </div>
                                <div className="mt-4 flex items-center gap-3 text-[11px] tabular-nums text-ink-dim">
                                    <span>{formatClock(currentTime)}</span>
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                                        <div
                                            className="h-full rounded-full bg-ember/80 transition-[width] duration-300"
                                            style={{ width: `${progress * 100}%` }}
                                        />
                                    </div>
                                    <span>{totalSeconds > 0 ? formatClock(totalSeconds) : '--:--'}</span>
                                </div>
                            </div>
                        ) : tracksQuery.isLoading ? (
                            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-night-2 p-5">
                                <div className="h-16 w-16 animate-pulse rounded-lg bg-white/10" aria-hidden />
                                <div className="flex-1 space-y-2" aria-hidden>
                                    <div className="h-3.5 w-40 animate-pulse rounded bg-white/10" />
                                    <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                                </div>
                                <p className="sr-only">Loading the track preview</p>
                            </div>
                        ) : (
                            <p className="rounded-2xl border border-white/10 bg-night-2 p-5 text-sm text-ink-mid">
                                The catalog lives inside the workspace — sign in and press play there.
                            </p>
                        )}
                    </motion.div>
                </div>

                <div className="mt-20">
                    <p className="text-sm text-ink-dim">
                        Set the scene — the three backgrounds the workspace ships with today.
                    </p>
                    <div className="mt-5 grid gap-4 sm:grid-cols-3">
                        {backgroundCatalog.map((background, index) => (
                            <motion.figure
                                key={background.id}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: '-60px' }}
                                transition={{ duration: 0.6, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
                                className="group relative overflow-hidden rounded-2xl border border-white/10"
                            >
                                {background.url && (
                                    <Image
                                        src={background.url}
                                        alt={`${background.name} workspace background`}
                                        width={640}
                                        height={400}
                                        className="aspect-[8/5] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                                    />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                                <figcaption className="absolute bottom-3 left-4 text-sm font-medium text-ink">
                                    {background.name}
                                </figcaption>
                            </motion.figure>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
