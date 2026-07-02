'use client';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { TaskInput } from './task-input';

const rise = {
    hidden: { opacity: 0, y: 20 },
    visible: (delay: number) => ({
        opacity: 1,
        y: 0,
        transition: { delay, duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
    }),
};

export function Hero() {
    return (
        <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4">
            {/* The lamp behind the room */}
            <div
                aria-hidden
                className="ember-halo pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[min(52rem,110vw)] -translate-x-1/2 -translate-y-1/2 rounded-full"
            />

            <motion.div
                className="relative z-10 flex aspect-square w-[min(44rem,94vw,80svh)] flex-col items-center justify-center rounded-full border border-white/12 bg-night/80 shadow-[0_0_120px_-40px_oklch(0.65_0.12_60/0.5)]"
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="flex w-full flex-col items-center px-[8%] text-center">
                    <motion.h1
                        variants={rise}
                        initial="hidden"
                        animate="visible"
                        custom={0.25}
                        className="text-4xl font-medium tracking-tight text-ink sm:text-5xl md:text-6xl"
                    >
                        Flow into{' '}
                        <em className="font-serif font-light text-ember">
                            productivity
                        </em>
                    </motion.h1>

                    <motion.p
                        variants={rise}
                        initial="hidden"
                        animate="visible"
                        custom={0.45}
                        className="mt-5 max-w-md text-base text-ink-mid sm:text-lg"
                    >
                        Lo-fi sound, a focus timer, and your tasks — one calm room for deep work.
                    </motion.p>

                    <motion.div
                        variants={rise}
                        initial="hidden"
                        animate="visible"
                        custom={0.65}
                        className="mt-9 w-full max-w-lg"
                    >
                        <Suspense fallback={<TaskInputSkeleton />}>
                            <TaskInput />
                        </Suspense>
                    </motion.div>
                </div>
            </motion.div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.4, duration: 1 }}
                className="absolute bottom-8 z-10"
            >
                <Link
                    href="#inside"
                    className="group flex flex-col items-center gap-1.5 text-xs tracking-wide text-ink-dim transition-colors hover:text-ink"
                >
                    What&apos;s inside
                    <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5 motion-safe:animate-bounce" />
                </Link>
            </motion.div>
        </section>
    );
}

function TaskInputSkeleton() {
    return (
        <div className="mx-auto flex w-full items-center gap-2 rounded-2xl border border-white/12 bg-black/40 p-2 pl-4">
            <div className="h-6 flex-1 animate-pulse rounded bg-white/10" />
            <div className="h-10 w-28 animate-pulse rounded-xl bg-white/10" />
        </div>
    );
}
