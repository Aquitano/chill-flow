'use client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BackgroundSelector } from './background-selector';
import { CustomizerView } from './customize-selector';
import { PresetsView } from './preset-selector';
import { SoundSelector } from './sound-selector';

interface Step {
    id: string;
    subtitle: string;
    title: string;
    description: string;
    color: string;
    component: React.ReactNode;
    timelineColor: TimelineIndicatorProps;
}

interface TimelineIndicatorProps {
    color: string;
    glowColor: string;
    position?: 'default' | 'left-aligned';
}

const steps: Step[] = [
    {
        id: 'sound',
        subtitle: 'Get Started',
        title: 'Choose Your Sound Experience',
        description:
            'Select from premium lofi beats, ambient soundscapes, or nature sounds to create your perfect audio environment.',
        color: 'from-[#FFD700] to-[#FFC000]',
        component: <SoundSelector />,
        timelineColor: {
            color: '#FFD700',
            glowColor: '#FFD700',
        },
    },
    {
        id: 'visual',
        subtitle: 'Set the Scene',
        title: 'Set Your Visual Atmosphere',
        description: 'Select from beautiful backgrounds or ambient videos that complement your chosen soundscape.',
        color: 'from-[#4F46E5] to-[#7C3AED]',
        component: <BackgroundSelector />,
        timelineColor: {
            color: '#4F46E5',
            glowColor: '#4F46E5',
        },
    },
    {
        id: 'presets',
        subtitle: 'Quick Setup',
        title: 'Use Ready-Made Presets',
        description:
            'Jump right in with curated combinations for focus, relaxation, meditation, or creative flow states.',
        color: 'from-[#10B981] to-[#059669]',
        component: <PresetsView />,
        timelineColor: {
            color: '#10B981',
            glowColor: '#10B981',
        },
    },
    {
        id: 'customize',
        subtitle: 'Make It Yours',
        title: 'Create Custom Flow States',
        description:
            'Save your favorite combinations and fine-tune every aspect of your environment for the perfect experience.',
        color: 'from-[#8B5CF6] to-[#6D28D9]',
        component: <CustomizerView />,
        timelineColor: {
            color: '#8B5CF6',
            glowColor: '#8B5CF6',
        },
    },
];

const TimelineIndicator = ({ color, glowColor, position = 'default' }: TimelineIndicatorProps) => (
    <div
        className={`absolute -top-20 bottom-0 ${position === 'left-aligned' ? 'right-[54%]' : '-left-[10%]'} pointer-events-none`}
    >
        <motion.div
            initial={{ height: '0%' }}
            whileInView={{ height: '100%' }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
                background: `linear-gradient(to bottom, transparent, ${color} 40%, transparent)`,
            }}
            className="absolute w-[2px]"
        />
        <div
            className="absolute h-full w-[2px] blur-[4px]"
            style={{
                backgroundColor: color,
                opacity: 0.2,
            }}
        />
        <motion.div
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="absolute top-[45%] -left-[6px]"
        >
            <div className="relative">
                <div className={`absolute -top-[1px] -left-[1px] h-4 w-4 rounded-full bg-${color}/30 blur-[10px]`} />
                <div
                    className="relative h-3 w-3 rounded-full"
                    style={{
                        backgroundColor: color,
                        boxShadow: `0 0 10px ${glowColor}, 0 0 20px ${glowColor}80`,
                    }}
                />
            </div>
        </motion.div>
    </div>
);

export const StepsSection = () => {
    const [pathCoords, setPathCoords] = useState({ x1: 90, x2: 95 });

    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            setPathCoords({
                x1: width < 1200 ? 70 : 90,
                x2: width < 1200 ? 75 : 95,
            });
        };

        handleResize(); // Initial call
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <>
            <div className="relative py-15">
                <div className="container mx-auto px-4">
                    <div className="mb-16 text-center">
                        <h2 className="mb-4 bg-linear-to-r from-white via-white/90 to-white/70 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
                            <span className="font-inter">Create Your Perfect Flow State</span>
                        </h2>
                        <p className="mx-auto max-w-2xl text-neutral-400">
                            Customize your sound, visuals, and environment to maximize focus and creativity
                        </p>
                    </div>
                </div>
            </div>

            <section id="how-it-works" className="relative pl-6 lg:pl-0">
                {steps.map((step, index) => (
                    <div key={step.id} className={cn('py-6', index === 2 || index === 3 ? 'lg:py-16' : 'lg:py-32')}>
                        <div className="mx-auto max-w-none px-6">
                            <div
                                className={cn(
                                    'relative h-fit lg:ml-[10%]',
                                    index === 3 &&
                                        'lg:rounded-xl lg:border lg:border-white/8 lg:bg-linear-to-br lg:from-gray-900/50 lg:via-gray-900/30 lg:to-black/50 lg:p-12 lg:pt-16 lg:pb-16 lg:shadow-[0_0_1px_1px_rgba(0,0,0,0.3)] lg:backdrop-blur-xl lg:backdrop-saturate-150',
                                )}
                            >
                                {/* Timeline indicators */}
                                {index === 0 ? (
                                    <>
                                        {/* SVG timeline for first step (desktop) - Added pointer-events-none */}
                                        <div className="pointer-events-none absolute top-24 -bottom-28 -left-[9%] hidden w-[60%] lg:block">
                                            <motion.svg
                                                className="h-[150%] w-[95%]"
                                                viewBox="0 0 100 80"
                                                preserveAspectRatio="none"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <defs>
                                                    <linearGradient id="verticalGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="transparent" />
                                                        <stop
                                                            offset="50%"
                                                            stopColor={step.timelineColor.glowColor}
                                                            stopOpacity="0.8"
                                                        />
                                                        <stop offset="100%" stopColor="transparent" />
                                                    </linearGradient>
                                                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                                                        <feGaussianBlur
                                                            in="SourceGraphic"
                                                            stdDeviation="2"
                                                            result="blur"
                                                        />
                                                        <feMerge>
                                                            <feMergeNode in="blur" />
                                                            <feMergeNode in="SourceGraphic" />
                                                        </feMerge>
                                                    </filter>
                                                </defs>
                                                <motion.path
                                                    d={`M 0 0 V 40 L 10 50 L ${pathCoords.x1} 50 L ${pathCoords.x2} 60 L ${pathCoords.x2} 80`}
                                                    stroke="url(#verticalGradient)"
                                                    strokeWidth="0.15"
                                                    filter="url(#glow)"
                                                    initial={{ pathLength: 0 }}
                                                    whileInView={{ pathLength: 1 }}
                                                    viewport={{ once: true }}
                                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                                />
                                                <motion.path
                                                    d={`M 0 0 V 40 L 10 50 L ${pathCoords.x1} 50 L ${pathCoords.x2} 60 L ${pathCoords.x2} 80`}
                                                    stroke={step.timelineColor.glowColor}
                                                    strokeWidth="1"
                                                    strokeOpacity="0.01"
                                                    filter="url(#glow)"
                                                    initial={{ pathLength: 0 }}
                                                    whileInView={{ pathLength: 1 }}
                                                    viewport={{ once: true }}
                                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                                />
                                            </motion.svg>
                                        </div>
                                    </>
                                ) : null}

                                {/* Timeline indicators for all steps (mobile and step 2-4 on desktop) */}
                                <TimelineIndicator
                                    color={step.timelineColor.color}
                                    glowColor={step.timelineColor.glowColor}
                                    position={index === 1 ? 'left-aligned' : 'default'}
                                />

                                <div
                                    className={cn(
                                        'grid grid-cols-1 gap-12',
                                        index !== 2 && index !== 3 && 'lg:grid-cols-2 lg:items-center',
                                        'justify-left',
                                    )}
                                >
                                    {/* Content */}
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: 0.2 }}
                                        className={cn(
                                            index === 1 ? 'lg:order-2 lg:pl-12' : '',
                                            'relative z-10', // Added z-index to ensure content is above timeline
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                index === 3 ? 'lg:ml-6' : '',
                                                index === 2 || index === 3 ? 'max-w-[100%]' : '',
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    'mb-4 text-xl font-medium',
                                                    `bg-linear-to-r ${step.color} bg-clip-text text-transparent`,
                                                )}
                                            >
                                                {step.subtitle}
                                            </div>
                                            <h2
                                                className={cn(
                                                    index === 2 || index === 3 ? 'max-w-full' : 'max-w-200',
                                                    'mb-8 bg-linear-to-b from-white to-white/50 bg-clip-text py-2 text-4xl font-bold tracking-tight text-transparent md:text-5xl lg:text-6xl',
                                                    index === 1 ? 'lg:pr-12' : '',
                                                    index === 3 ? 'leading-[1.6]' : 'leading-[1.1]',
                                                )}
                                            >
                                                {step.title}
                                            </h2>
                                            <p
                                                className={cn(
                                                    'mb-8 text-xl text-gray-400',
                                                    index === 2 ? 'w-full' : 'max-w-2xl',
                                                )}
                                            >
                                                {step.description}
                                            </p>

                                            {index === 0 && (
                                                <Link href="/app" className="relative z-20 inline-block">
                                                    <Button
                                                        variant="default"
                                                        className="w-full bg-linear-to-r from-indigo-600 to-violet-600 px-6 py-2 text-white sm:w-auto"
                                                    >
                                                        <span className="flex items-center">
                                                            Start Your Flow Journey
                                                            <svg
                                                                className="ml-2 h-5 w-5 transform transition-transform group-hover:translate-x-1"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                viewBox="0 0 24 24"
                                                                aria-hidden="true"
                                                            >
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M9 5l7 7-7 7"
                                                                />
                                                            </svg>
                                                        </span>
                                                    </Button>
                                                </Link>
                                            )}
                                        </div>
                                    </motion.div>

                                    {/* Visual Component */}
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        whileInView={{ opacity: 1, scale: 1 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: 0.4 }}
                                        className={cn(
                                            'relative w-full',
                                            index === 1 && 'max-w-[100vw] overflow-hidden lg:order-1 lg:-ml-[10%]',
                                            index === 2 && 'col-span-1',
                                            index === 3 && 'overflow-hidden rounded-lg backdrop-blur-sm',
                                        )}
                                    >
                                        {step.component}
                                    </motion.div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </section>
        </>
    );
};
