'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Music } from 'lucide-react';
import Image from 'next/image';

/*
 * One-click soundtrack switching: a row of circular track buttons floating above the
 * player bar, so changing the sound never requires opening a panel. The active circle
 * carries a sliding ember ring; the equalizer dot marks live playback.
 */

/** Deterministic fallback art for tracks without a cover — varies by track id. */
function fallbackHue(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
        hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    // Stay in the warm band (30–90°) so fallbacks never clash with the palette.
    return 30 + (hash % 60);
}

export const TrackDock: React.FC = () => {
    const tracks = useAppStore((state) => state.tracks);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const isPlaying = useAppStore((state) => state.isPlaying);

    if (tracks.length === 0) return null;

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-[8.75rem] z-20 flex justify-center px-4 sm:bottom-[7.25rem]">
            <div
                className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-white/8 bg-black/55 px-3 py-2 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="listbox"
                aria-label="Soundtracks"
                aria-orientation="horizontal"
            >
                {tracks.map((track) => {
                    const active = currentTrack?.id === track.id;
                    return (
                        <motion.button
                            key={track.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            aria-label={`Play ${track.title}`}
                            onClick={() => setCurrentTrack(track)}
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.94 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            className="group relative shrink-0 rounded-full p-1 focus-visible:outline-2 focus-visible:outline-ember"
                        >
                            {active && (
                                <motion.span
                                    layoutId="track-dock-ring"
                                    className="absolute inset-0 rounded-full border-2 border-ember"
                                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                />
                            )}
                            <span
                                className={cn(
                                    'relative block h-11 w-11 overflow-hidden rounded-full border transition-opacity',
                                    active ? 'border-transparent' : 'border-white/15 opacity-70 group-hover:opacity-100',
                                )}
                            >
                                {track.thumbnailUrl ? (
                                    <Image
                                        src={track.thumbnailUrl}
                                        alt=""
                                        width={44}
                                        height={44}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <span
                                        className="flex h-full w-full items-center justify-center"
                                        style={{
                                            background: `radial-gradient(circle at 50% 70%, oklch(0.55 0.11 ${fallbackHue(track.id)}) 0%, oklch(0.2 0.02 ${fallbackHue(track.id)}) 75%)`,
                                        }}
                                    >
                                        <Music className="h-4 w-4 text-ink" />
                                    </span>
                                )}
                                {active && isPlaying && (
                                    <span className="eq-playing absolute inset-0 flex items-end justify-center gap-[2px] bg-black/45 pb-2.5">
                                        {[0, 0.2, 0.1].map((delay, index) => (
                                            <span
                                                key={index}
                                                className="eq-bar h-3 w-[2px] rounded-full bg-ember"
                                                style={{ animationDelay: `${delay}s` }}
                                            />
                                        ))}
                                    </span>
                                )}
                            </span>
                            {/* Title tooltip */}
                            <span
                                role="presentation"
                                className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-black/85 px-2 py-1 text-[11px] whitespace-nowrap text-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                                {track.title}
                            </span>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};
