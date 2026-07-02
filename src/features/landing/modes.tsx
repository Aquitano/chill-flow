'use client';

import { defaultModes } from '@/store/app-store';
import { motion } from 'framer-motion';

/*
 * The four real workspace modes, straight from the store definition — each row's
 * indicators mirror the actual ModeSettings booleans, so this section can't drift
 * into advertising behavior the app doesn't have.
 */

const MODE_FACETS = [
    { key: 'showTimer', label: 'Timer' },
    { key: 'showTasks', label: 'Tasks' },
    { key: 'showBackground', label: 'Scene' },
    { key: 'showQuote', label: 'Quote' },
] as const;

export function ModesSection() {
    return (
        <section id="modes" className="relative z-10 mt-36 scroll-mt-24 sm:mt-44">
            <div className="mx-auto max-w-4xl px-6">
                <h2 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                    Four ways to <em className="font-serif font-light text-ember">sit down.</em>
                </h2>
                <p className="mt-4 max-w-xl text-base text-ink-mid">
                    A mode is just a different arrangement of the same room — what stays on screen, what gets out of
                    the way.
                </p>

                <div className="mt-10 divide-y divide-white/8 border-y border-white/8">
                    {Object.entries(defaultModes).map(([modeKey, mode], index) => (
                        <motion.div
                            key={modeKey}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                            className="flex flex-col gap-3 py-6 transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:gap-8 sm:px-4"
                        >
                            <div className="min-w-0 flex-1">
                                <h3 className="font-medium text-ink">{mode.label}</h3>
                                <p className="mt-1 text-sm text-ink-mid">{mode.description}</p>
                            </div>
                            <ul className="flex shrink-0 items-center gap-4">
                                {MODE_FACETS.map((facet) => {
                                    const on = mode[facet.key];
                                    return (
                                        <li
                                            key={facet.label}
                                            className={`flex items-center gap-1.5 text-xs ${on ? 'text-ink-mid' : 'text-ink-dim/60'}`}
                                        >
                                            <span
                                                aria-hidden
                                                className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-ember' : 'border border-white/25'}`}
                                            />
                                            {facet.label}
                                            <span className="sr-only">{on ? 'shown' : 'hidden'}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
