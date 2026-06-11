'use client';

import {
    IconAdjustmentsBolt,
    IconCloud,
    IconCurrencyDollar,
    IconEaseInOut,
    IconHeart,
    IconHelp,
    IconRouteAltLeft,
    IconTerminal2,
} from '@tabler/icons-react';
import { cubicBezier, motion, useInView, type Variants } from 'framer-motion';
import { useRef } from 'react';
import { Feature } from './feature';

const features = [
    {
        title: 'Curated Lo-fi',
        description: 'Hand-picked beats and ambient sounds to match your workflow and mood.',
        icon: <IconCloud stroke={1.5} />,
        color: 'blue',
    },
    {
        title: 'Focus Timer',
        description: 'Built-in pomodoro timer with smooth music transitions for natural breaks.',
        icon: <IconEaseInOut stroke={1.5} />,
        color: 'indigo',
    },
    {
        title: 'Sound Mixing',
        description: 'Create your perfect ambiance by mixing lo-fi beats with nature sounds.',
        icon: <IconAdjustmentsBolt />,
        color: 'amber',
    },
    {
        title: 'Task Tracking',
        description: 'Keep track of your accomplishments while staying in the flow.',
        icon: <IconTerminal2 />,
        color: 'violet',
    },
    {
        title: 'Offline Mode',
        description: 'Download your favorite mixes for distraction-free focus sessions.',
        icon: <IconRouteAltLeft />,
        color: 'emerald',
    },
    {
        title: 'Smart Recommendations',
        description: 'AI-powered playlists that adapt to your productivity patterns.',
        icon: <IconHelp />,
        color: 'sky',
    },
    {
        title: 'Mood Journaling',
        description: 'Track how different sounds affect your focus and productivity.',
        icon: <IconHeart />,
        color: 'rose',
    },
    {
        title: 'Community Mixes',
        description: 'Discover and share productivity-boosting sound combinations.',
        icon: <IconCurrencyDollar />,
        color: 'teal',
    },
];

export function FeaturesSection() {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-100px' });

    const sectionVariants: Variants = {
        hidden: { opacity: 0, y: 30 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.8,
                ease: cubicBezier(0.22, 1, 0.36, 1),
                staggerChildren: 0.2,
            },
        },
    };

    const titleVariants: Variants = {
        hidden: { opacity: 0, y: 20 },
        visible: (delay: number) => ({
            opacity: 1,
            y: 0,
            transition: {
                delay,
                duration: 0.7,
                ease: cubicBezier(0.22, 1, 0.36, 1),
            },
        }),
    };

    const containerVariants: Variants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
                delayChildren: 0.3,
                duration: 0.6,
            },
        },
    };

    return (
        <>
            <motion.section
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-50px' }}
                variants={sectionVariants}
                className="relative z-10 flex flex-col items-center py-10 pb-20 text-center"
            >
                <motion.p
                    custom={0.1}
                    variants={titleVariants}
                    className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase"
                >
                    IMMERSIVE FOCUS ENVIRONMENT
                </motion.p>
                <motion.h2
                    custom={0.3}
                    variants={titleVariants}
                    className="mb-2 bg-linear-to-r from-white to-white/70 bg-clip-text text-3xl font-bold text-transparent md:text-4xl"
                >
                    Let the beats guide your flow.
                </motion.h2>
                <motion.p
                    custom={0.5}
                    variants={titleVariants}
                    className="bg-linear-to-r from-stone-400 to-stone-300 bg-clip-text font-serif text-4xl text-transparent md:text-5xl"
                >
                    Curated sounds for every mood.
                </motion.p>
            </motion.section>

            <section id="features" className="py-24 sm:py-32">
                <div ref={ref} className="mx-auto max-w-7xl px-6 lg:px-8">
                    <motion.div
                        initial="hidden"
                        animate={isInView ? 'visible' : 'hidden'}
                        variants={containerVariants}
                        className="relative z-10 mx-auto grid grid-cols-1 gap-y-8 md:grid-cols-2 lg:grid-cols-4"
                    >
                        {features.map((feature, index) => (
                            <Feature key={feature.title} {...feature} index={index} isInView={isInView} />
                        ))}
                    </motion.div>
                </div>
            </section>
        </>
    );
}
