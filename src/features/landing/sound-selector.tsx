import { Button } from '@/components/ui/button';
import { Pause, Play, Volume2 } from 'lucide-react';
import Link from 'next/link';

interface Track {
    title: string;
    description: string;
    isPlaying?: boolean;
}

const tracks: Track[] = [
    {
        title: 'Lofi Beats',
        description: 'Relaxed hip-hop inspired instrumentals',
        isPlaying: true,
    },
    {
        title: 'Ambient Nature',
        description: 'Calming sounds of a forest with gentle birdsong',
    },
    {
        title: 'Binaural Beats',
        description: 'Soothing frequencies for deep relaxation',
    },
    // ...other tracks
];

export const SoundSelector = () => (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-6 backdrop-blur-lg">
        <h3 className="mb-6 text-xl font-medium text-white/90">Choose Your Soundscape</h3>

        <div className="mb-6 space-y-4">
            {tracks.map((track) => (
                <TrackItem key={track.title} {...track} />
            ))}
        </div>

        <Link href="/soundscapes" className="block w-full">
            <Button className="w-full bg-linear-to-r from-indigo-600 to-violet-600 text-white">
                Browse All Soundscapes
            </Button>
        </Link>
    </div>
);

const TrackItem = ({ title, description, isPlaying = false }: Track) => (
    <div className="flex items-center justify-between rounded-lg bg-white/5 p-4 transition-colors hover:bg-white/10">
        <div className="flex items-center gap-4">
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
                {isPlaying ? (
                    <Pause size={16} className="text-amber-400" />
                ) : (
                    <Play size={16} className="text-amber-400" />
                )}
            </button>
            <div>
                <h4 className="text-white/90">{title}</h4>
                <p className="text-sm text-white/60">{description}</p>
            </div>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Volume2 size={14} />
            </Button>
        </div>
    </div>
);
