'use client';

import { MotionValue, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

const WORDS = ['Work', 'wants', 'a', 'quieter', 'room.'];

/*
 * A single typographic beat between the product tour and the sound demo: one huge
 * serif line that resolves word by word as you scroll through it. Reduced motion
 * renders it fully visible, static.
 */
export function StatementSection() {
    const prefersReduced = useReducedMotion();
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ['start end', 'end start'],
    });

    if (prefersReduced) {
        return (
            <section className="relative z-10 mt-36 sm:mt-44">
                <p className="mx-auto max-w-5xl px-6 text-center font-serif text-4xl font-light text-ink italic sm:text-6xl">
                    {WORDS.join(' ')}
                </p>
            </section>
        );
    }

    return (
        <section ref={containerRef} className="relative z-10 mt-24 h-[160vh] sm:mt-32">
            <div className="sticky top-0 flex h-screen items-center justify-center px-6">
                <p className="max-w-5xl text-center font-serif text-[clamp(2.5rem,7vw,6rem)] leading-[1.15] font-light italic [text-wrap:balance]">
                    {WORDS.map((word, index) => (
                        <StatementWord
                            key={index}
                            word={word}
                            index={index}
                            total={WORDS.length}
                            progress={scrollYProgress}
                        />
                    ))}
                </p>
            </div>
        </section>
    );
}

function StatementWord({
    word,
    index,
    total,
    progress,
}: {
    word: string;
    index: number;
    total: number;
    progress: MotionValue<number>;
}) {
    // Each word resolves inside the middle band of the scroll range, staggered.
    const start = 0.25 + (index / total) * 0.3;
    const opacity = useTransform(progress, [start, start + 0.08], [0.14, 1]);
    const y = useTransform(progress, [start, start + 0.08], [12, 0]);
    const isAccent = word === 'quieter';

    return (
        <motion.span
            style={{ opacity, y }}
            className={`inline-block whitespace-pre ${isAccent ? 'text-ember' : 'text-ink'}`}
        >
            {word}
            {index < total - 1 ? ' ' : ''}
        </motion.span>
    );
}
