'use client';
import { motion } from 'framer-motion';
import { Suspense } from 'react';
import { TaskInput } from './task-input';

export function Hero() {
    return (
        <section className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden">
            <motion.div
                className="relative z-10 h-[800px] w-[800px] rounded-full border-2 border-white/20 bg-black/80 shadow-lg"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4 text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 0.8 }}
                    >
                        <h1 className="mb-2 text-4xl font-medium md:text-5xl">
                            Flow into{' '}
                            <span className="bg-linear-to-r from-stone-400 to-stone-500 bg-clip-text p-1 font-serif text-5xl text-transparent italic md:text-6xl">
                                productivity
                            </span>
                        </h1>
                        <p className="mb-10 text-lg text-neutral-400">Relaxing beats to keep you calm and focused.</p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.8 }}
                        className="w-full"
                    >
                        <Suspense fallback={<TaskInputSkeleton />}>
                            <TaskInput />
                        </Suspense>
                    </motion.div>
                </div>
            </motion.div>
            <motion.div
                className="horizontal-flare full-flare absolute"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    delay: 0.9,
                    duration: 1.2,
                    ease: 'easeOut',
                }}
            />
        </section>
    );
}

function TaskInputSkeleton() {
    return (
        <div className="mx-auto w-full max-w-xl rounded-xl border-2 border-white/20 bg-black/50 p-4 shadow-lg backdrop-blur-sm">
            <div className="h-10 w-full animate-pulse rounded bg-white/10" />
            <div className="mt-3 flex justify-end">
                <div className="h-9 w-24 animate-pulse rounded bg-white/10" />
            </div>
        </div>
    );
}
