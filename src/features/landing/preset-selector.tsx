import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

type PresetId = 'focus' | 'relax' | 'sleep' | 'create' | 'meditate';

interface Preset {
    id: PresetId;
    name: string;
    buttonColor: string;
    details: {
        title: string;
        sound: string;
        visual: string;
        duration: string;
    };
}

interface PresetButtonProps {
    preset: Preset;
    isActive: boolean;
    onClick: () => void;
}

const PresetButton = ({ preset, isActive, onClick }: PresetButtonProps) => (
    <Button
        variant={isActive ? 'default' : 'outline'}
        className={cn(
            isActive ? `${preset.buttonColor} ` : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
            'transition-colors duration-200',
        )}
        onClick={onClick}
        aria-pressed={isActive}
    >
        {preset.name}
    </Button>
);

interface DetailRowProps {
    label: string;
    value: string;
}

const DetailRow = ({ label, value }: DetailRowProps) => (
    <div className="flex justify-between">
        <span className="text-white/60">{label}</span>
        <span className="font-medium text-white/90">{value}</span>
    </div>
);

export const PresetsView = () => {
    const presets: Record<PresetId, Preset> = {
        focus: {
            id: 'focus',
            name: 'Focus',
            buttonColor: 'bg-indigo-600',
            details: {
                title: 'Deep Focus',
                sound: 'Ambient Electronic',
                visual: 'Minimal Workspace',
                duration: '50 min',
            },
        },
        relax: {
            id: 'relax',
            name: 'Relaxation',
            buttonColor: 'bg-blue-600',
            details: {
                title: 'Evening Relaxation',
                sound: 'Ocean Waves',
                visual: 'Beach Sunset',
                duration: '30 min',
            },
        },
        sleep: {
            id: 'sleep',
            name: 'Sleep',
            buttonColor: 'bg-violet-600',
            details: {
                title: 'Peaceful Sleep',
                sound: 'White Noise',
                visual: 'Night Sky',
                duration: '8 hours',
            },
        },
        create: {
            id: 'create',
            name: 'Creative',
            buttonColor: 'bg-amber-600',
            details: {
                title: 'Creative Flow',
                sound: 'Lo-fi Jazz',
                visual: 'Abstract Colors',
                duration: 'Continuous',
            },
        },
        meditate: {
            id: 'meditate',
            name: 'Meditation',
            buttonColor: 'bg-emerald-600',
            details: {
                title: 'Mindful Meditation',
                sound: 'Singing Bowls',
                visual: 'Forest Stream',
                duration: '20 min',
            },
        },
    };

    const [activePreset, setActivePreset] = useState<PresetId>('focus');
    const currentPreset = presets[activePreset];

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-6 backdrop-blur-lg">
            <h3 className="mb-6 text-xl font-medium text-white/90">Flow Presets</h3>

            <div className="mb-6 flex flex-wrap gap-2">
                {Object.values(presets).map((preset) => (
                    <PresetButton
                        key={preset.id}
                        preset={preset}
                        isActive={activePreset === preset.id}
                        onClick={() => setActivePreset(preset.id)}
                    />
                ))}
            </div>

            <div className="mb-6 rounded-lg border border-white/10 bg-linear-to-b from-black/40 to-black/20 p-5 backdrop-blur-md transition-all duration-300">
                <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-lg font-medium text-white/90">{currentPreset.details.title}</h4>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-white/90 transition-colors hover:bg-white/10"
                        aria-label="Preview preset"
                    >
                        <Play size={14} className="ml-0.5" />
                    </Button>
                </div>

                <div className="mb-4 space-y-2 text-sm">
                    <DetailRow label="Sound" value={currentPreset.details.sound} />
                    <DetailRow label="Visual" value={currentPreset.details.visual} />
                    <DetailRow label="Duration" value={currentPreset.details.duration} />
                </div>

                <div className="mt-5 flex justify-between">
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
                    >
                        Customize
                    </Button>
                    <Button
                        asChild
                        size="sm"
                        className={cn(
                            'bg-linear-to-r text-white transition-transform duration-200 hover:scale-105',
                            activePreset === 'focus'
                                ? 'from-indigo-600 to-indigo-500'
                                : activePreset === 'relax'
                                  ? 'from-blue-600 to-blue-500'
                                  : activePreset === 'sleep'
                                    ? 'from-violet-600 to-violet-500'
                                    : activePreset === 'create'
                                      ? 'from-amber-600 to-amber-500'
                                      : 'from-emerald-600 to-emerald-500',
                        )}
                    >
                        <Link href="/app">Open Workspace</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
};
