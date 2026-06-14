import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';

interface BackgroundOption {
    id: string;
    name: string;
    image: string;
    isSelected?: boolean;
    objectPosition?: string;
}

interface BackgroundTileProps {
    option: BackgroundOption;
    onClick?: () => void;
}

const backgroundOptions: BackgroundOption[] = [
    {
        id: 'rainy-window',
        name: 'Rainy Window',
        image: 'https://images.unsplash.com/photo-1631816591249-ba33dde81a23?q=80&w=1946&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
        objectPosition: 'center bottom',
    },
    {
        id: 'night-forest',
        name: 'Night Forest',
        image: 'https://images.unsplash.com/photo-1639162147585-60019ada4361?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    },
    {
        id: 'ocean-waves',
        name: 'Ocean Waves',
        image: 'https://images.unsplash.com/photo-1499346030926-9a72daac6c63?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=2940&q=80',
    },
    {
        id: 'more',
        name: 'More in workspace',
        image: '',
    },
];

const BackgroundTile = ({ option, onClick }: BackgroundTileProps) => {
    const { name, image } = option;

    return (
        <button
            type="button"
            className={cn('group relative w-full overflow-hidden rounded-lg border-2')}
            onClick={onClick}
        >
            <div
                className={cn(
                    'absolute inset-0 bg-gradient-to-t from-black/80 to-transparent transition-opacity',
                    image ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
            />

            {image ? (
                <Image
                    src={image}
                    width={640}
                    height={144}
                    className={cn('h-36 w-full object-cover transition-transform', 'group-hover:scale-105')}
                    style={option.objectPosition ? { objectPosition: option.objectPosition } : undefined}
                    alt={name}
                />
            ) : (
                <div className="flex h-36 items-center justify-center bg-linear-to-br from-slate-900 to-slate-800">
                    <span className="text-sm text-white/70">{name}</span>
                </div>
            )}

            {image && (
                <div
                    className={'absolute bottom-2 left-2 text-sm font-medium text-white opacity-100 transition-opacity'}
                >
                    {name}
                </div>
            )}
        </button>
    );
};

export const BackgroundSelector = () => {
    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-6 backdrop-blur-lg">
            <h3 className="mb-6 text-xl font-medium text-white/90">Choose Your Visual</h3>

            <div className="mb-6 grid grid-cols-2 gap-3">
                {backgroundOptions.map((option) => (
                    <BackgroundTile key={option.id} option={option} />
                ))}
            </div>

            <Button
                asChild
                variant="outline"
                className="w-full bg-linear-to-r from-indigo-600 to-violet-600 text-white"
            >
                <Link href="/app">Open Visual Workspace</Link>
            </Button>
        </div>
    );
};
