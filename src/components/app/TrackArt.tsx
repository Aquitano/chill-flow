'use client';

import { fallbackHue } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { Track } from '@/models/app';
import { Music } from 'lucide-react';

/** Track cover with a deterministic warm-toned fallback for coverless tracks. */
export function TrackArt({ track, className }: { track: Track; className?: string }) {
    if (track.thumbnailUrl) {
        return (
            <img
                src={track.thumbnailUrl}
                alt=""
                className={cn('shrink-0 rounded-lg object-cover', className)}
                loading="lazy"
            />
        );
    }
    const hue = fallbackHue(track.id);
    return (
        <span
            aria-hidden
            className={cn('flex shrink-0 items-center justify-center rounded-lg', className)}
            style={{
                background: `radial-gradient(circle at 50% 70%, oklch(0.5 0.1 ${hue}) 0%, oklch(0.22 0.02 ${hue}) 80%)`,
            }}
        >
            <Music className="size-[38%] text-ink/80" />
        </span>
    );
}
