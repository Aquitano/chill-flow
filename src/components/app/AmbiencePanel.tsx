'use client';

import { Slider } from '@/components/ui/slider';
import { AMBIENT_LAYERS, AmbientLayerId } from '@/lib/audio/ambient';
import { useAmbient } from '@/lib/audio/useAmbient';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { CloudRain, Flame, Moon, Wind, type LucideIcon } from 'lucide-react';

const LAYER_ICONS: Record<AmbientLayerId, LucideIcon> = {
    rain: CloudRain,
    wind: Wind,
    embers: Flame,
    deep: Moon,
};

/**
 * myNoise-style layer mixer: each row is a procedurally synthesized ambient
 * sound with its own on/off switch and level, mixed under the music.
 */
export function AmbiencePanel() {
    const { mixer, state } = useAmbient();

    return (
        <motion.section
            id="dock-panel-ambience"
            data-workspace-panel
            aria-label="Ambience layers"
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mr-4 mb-3 ml-auto w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-black/75 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
            <header className="flex items-baseline justify-between px-4 pt-4">
                <h3 className="text-sm font-medium text-ink">Ambience</h3>
                <p className="text-xs text-ink-dim">Mixes under the music</p>
            </header>

            <ul className="p-2">
                {AMBIENT_LAYERS.map((layer) => {
                    const Icon = LAYER_ICONS[layer.id];
                    const { enabled, volume } = state[layer.id];
                    return (
                        <li key={layer.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                aria-label={`${layer.label} layer`}
                                onClick={() => mixer.toggleLayer(layer.id)}
                                className={cn(
                                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-ember',
                                    enabled
                                        ? 'border-ember/40 bg-ember/15 text-ember shadow-[0_0_18px_-6px_oklch(0.81_0.1_75/0.5)]'
                                        : 'border-white/10 bg-white/5 text-ink-dim hover:bg-white/10 hover:text-ink-mid',
                                )}
                            >
                                <Icon size={16} aria-hidden />
                            </button>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className={cn('text-sm', enabled ? 'text-ink' : 'text-ink-mid')}>
                                        {layer.label}
                                    </span>
                                    <span className="text-[11px] text-ink-dim">{layer.hint}</span>
                                </div>
                                <Slider
                                    value={[Math.round(volume * 100)]}
                                    max={100}
                                    step={1}
                                    disabled={!enabled}
                                    onValueChange={(next) =>
                                        mixer.setLayer(layer.id, { volume: (next[0] ?? 50) / 100 })
                                    }
                                    aria-label={`${layer.label} volume`}
                                    className="mt-2 cursor-pointer"
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>

            <p className="border-t border-white/5 px-4 py-2.5 text-[11px] text-ink-dim">
                Generated live in your browser — nothing to download.
            </p>
        </motion.section>
    );
}
