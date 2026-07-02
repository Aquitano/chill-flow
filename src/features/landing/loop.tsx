'use client';

import {
    MotionValue,
    motion,
    useMotionValue,
    useReducedMotion,
    useScroll,
    useSpring,
    useTransform,
} from 'framer-motion';
import { Check, Flag, Heart, Pause, Play, Repeat, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/*
 * "The loop" — the product tour. Every vignette depicts a real, shipping surface of
 * the workspace (player, timer, tasks, session summary); nothing here is aspirational.
 * On desktop the tour is one pinned composite that shifts emphasis as you scroll;
 * on narrow viewports or reduced motion it degrades to plainly stacked rows.
 */

type StageId = 'sound' | 'timer' | 'tasks' | 'progress';

const STAGES: { id: StageId; title: string; body: string; range: [number, number] }[] = [
    {
        id: 'sound',
        title: 'Press play',
        body: 'A curated catalog of lo-fi and ambient tracks, streamed from the real player you see here. Pick the sound and the room settles.',
        range: [0, 0.25],
    },
    {
        id: 'timer',
        title: 'Set the timer',
        body: 'Focus blocks from 15 minutes to open-ended, or a full Pomodoro cadence. Starting the timer starts the music with it.',
        range: [0.25, 0.5],
    },
    {
        id: 'tasks',
        title: 'Keep tasks in view',
        body: 'A short list beside the dial. Type p1 while adding a task to set its priority, check things off without leaving flow.',
        range: [0.5, 0.75],
    },
    {
        id: 'progress',
        title: 'Progress, honestly',
        body: 'Only real focus time is recorded — sessions you complete, minutes you actually sat. No confetti, no vanity charts.',
        range: [0.75, 1],
    },
];

export function LoopSection() {
    const prefersReduced = useReducedMotion();
    const [isDesktop, setIsDesktop] = useState(false);

    useEffect(() => {
        const query = window.matchMedia('(min-width: 1024px)');
        const update = () => setIsDesktop(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    return (
        <section id="inside" className="relative z-10 scroll-mt-24">
            <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-24 text-center sm:pt-32">
                <h2 className="text-ink text-3xl font-medium tracking-tight text-balance sm:text-4xl md:text-5xl">
                    Sound, timer, tasks, progress — <em className="text-ember font-serif font-light">one loop.</em>
                </h2>
                <p className="text-ink-mid mt-5 max-w-xl text-base sm:text-lg">
                    The workspace below is the actual product, not a mockup of things to come.
                </p>
            </div>

            {isDesktop && !prefersReduced ? <LoopPinned /> : <LoopStacked />}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* Pinned desktop tour                                                 */
/* ------------------------------------------------------------------ */

function LoopPinned() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ['start start', 'end end'],
    });
    // Mouse wheels deliver scroll in discrete steps, which lands as visible jumps in the
    // scroll-linked transforms. The spring glides between steps; native scroll is untouched.
    const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

    return (
        <div ref={containerRef} className="relative mt-6 h-[340vh]">
            <div className="sticky top-0 flex h-screen items-center">
                <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,22rem)_1fr] items-center gap-16 px-6">
                    <div className="flex flex-col gap-10">
                        {STAGES.map((stage) => (
                            <PinnedCaption key={stage.id} stage={stage} progress={progress} />
                        ))}
                    </div>
                    <WorkspaceMock progress={progress} />
                </div>
            </div>
        </div>
    );
}

function PinnedCaption({ stage, progress }: { stage: (typeof STAGES)[number]; progress: MotionValue<number> }) {
    const [start, end] = stage.range;
    const opacity = useTransform(
        progress,
        [Math.max(0, start - 0.03), start + 0.03, end - 0.03, Math.min(1, end + 0.03)],
        [start === 0 ? 1 : 0.3, 1, 1, end === 1 ? 1 : 0.3],
    );
    const x = useTransform(progress, [Math.max(0, start - 0.03), start + 0.03], [start === 0 ? 0 : -8, 0]);

    return (
        <motion.div style={{ opacity, x }}>
            <h3 className="text-ink text-xl font-medium">{stage.title}</h3>
            <p className="text-ink-mid mt-2 text-sm leading-relaxed">{stage.body}</p>
        </motion.div>
    );
}

/** Emphasis curve for one part of the mock: full inside its stage, dimmed outside. */
function useStageEmphasis(progress: MotionValue<number>, [start, end]: [number, number]) {
    return useTransform(
        progress,
        [Math.max(0, start - 0.04), start + 0.02, end - 0.02, Math.min(1, end + 0.04)],
        [start === 0 ? 1 : 0.4, 1, 1, end === 1 ? 1 : 0.4],
    );
}

function WorkspaceMock({ progress }: { progress: MotionValue<number> }) {
    const soundEmphasis = useStageEmphasis(progress, STAGES[0]!.range);
    const timerEmphasis = useStageEmphasis(progress, STAGES[1]!.range);
    const tasksEmphasis = useStageEmphasis(progress, STAGES[2]!.range);
    const progressEmphasis = useTransform(progress, [0.75, 0.82], [0, 1]);

    // The dial's ring fills while the "timer" stage is in view, then holds.
    const ringProgress = useTransform(progress, [0.28, 0.5], [0.02, 0.42]);
    // One task checks off during the "tasks" stage.
    const checkProgress = useTransform(progress, [0.56, 0.62], [0, 1]);

    return (
        <div className="bg-night-2 relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
            {/* Mode bar */}
            <div className="text-ink-dim flex items-center justify-between px-5 py-3 text-xs">
                <span className="rounded-full border border-white/10 px-2.5 py-1">LearnFlow</span>
                <motion.span
                    style={{ opacity: progressEmphasis }}
                    className="text-ink-mid rounded-full border border-white/10 bg-black/30 px-2.5 py-1"
                >
                    41 min focused · 3 sessions
                </motion.span>
            </div>

            {/* Tasks panel */}
            <motion.div style={{ opacity: tasksEmphasis }} className="absolute top-14 left-5 w-56">
                <MiniTasks checkProgress={checkProgress} />
            </motion.div>

            {/* Timer dial */}
            <motion.div
                style={{ opacity: timerEmphasis }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[58%]"
            >
                <MiniDial ringProgress={ringProgress} />
            </motion.div>

            {/* Player bar */}
            <motion.div style={{ opacity: soundEmphasis }} className="absolute inset-x-0 bottom-0">
                <MiniPlayer playing />
            </motion.div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Stacked fallback (mobile / reduced motion)                          */
/* ------------------------------------------------------------------ */

function LoopStacked() {
    return (
        <div className="mx-auto mt-14 flex max-w-2xl flex-col gap-16 px-6">
            {STAGES.map((stage) => (
                <div key={stage.id}>
                    <h3 className="text-ink text-xl font-medium">{stage.title}</h3>
                    <p className="text-ink-mid mt-2 max-w-lg text-sm leading-relaxed">{stage.body}</p>
                    <div className="bg-night-2 mt-6 overflow-hidden rounded-2xl border border-white/10 p-5">
                        {stage.id === 'sound' && <MiniPlayer playing={false} />}
                        {stage.id === 'timer' && (
                            <div className="flex justify-center py-2">
                                <MiniDial />
                            </div>
                        )}
                        {stage.id === 'tasks' && <MiniTasks />}
                        {stage.id === 'progress' && <MiniSummary />}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Vignettes — small, truthful recreations of real product surfaces    */
/* ------------------------------------------------------------------ */

function MiniDial({ ringProgress }: { ringProgress?: MotionValue<number> }) {
    const circumference = 2 * Math.PI * 56;
    const staticProgress = useMotionValue(0.25);
    const dashOffset = useTransform(ringProgress ?? staticProgress, (value) => circumference * (1 - value));

    return (
        <div className="relative flex h-40 w-40 items-center justify-center">
            <svg viewBox="0 0 128 128" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="64" cy="64" r="56" fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="3" />
                <motion.circle
                    cx="64"
                    cy="64"
                    r="56"
                    fill="none"
                    stroke="oklch(0.81 0.1 75)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    style={{ strokeDashoffset: dashOffset }}
                />
            </svg>
            <div className="flex flex-col items-center">
                <span className="text-ink text-3xl font-medium tabular-nums">25:00</span>
                <span className="text-ink-dim mt-1 text-[10px] tracking-widest uppercase">Focus</span>
            </div>
        </div>
    );
}

function MiniTasks({ checkProgress }: { checkProgress?: MotionValue<number> }) {
    return (
        <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-left backdrop-blur-sm">
            <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-ink text-sm font-medium">Tasks</span>
                <span className="text-ink-dim text-[11px]">2 open</span>
            </div>
            <ul className="space-y-1 text-sm">
                <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-rose-400/70">
                        {checkProgress && (
                            <motion.span
                                style={{ opacity: checkProgress }}
                                className="absolute inset-[-2px] flex items-center justify-center rounded-full bg-emerald-500 text-black"
                            >
                                <Check className="h-2.5 w-2.5" />
                            </motion.span>
                        )}
                    </span>
                    <span className="text-ink relative">
                        Review chapter notes
                        {checkProgress && (
                            <motion.span
                                style={{ scaleX: checkProgress }}
                                className="bg-ink-dim absolute top-1/2 left-0 h-px w-full origin-left"
                            />
                        )}
                    </span>
                    <Flag className="ml-auto h-3 w-3 shrink-0 text-rose-400/80" />
                </li>
                <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                    <span className="h-4 w-4 shrink-0 rounded-full border-2 border-white/25" />
                    <span className="text-ink">Draft the outline</span>
                </li>
                <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black">
                        <Check className="h-2.5 w-2.5" />
                    </span>
                    <span className="text-ink-dim line-through">Clear inbox</span>
                </li>
            </ul>
        </div>
    );
}

function MiniPlayer({ playing }: { playing: boolean }) {
    return (
        <div className="flex items-center gap-4 border-t border-white/10 bg-black/50 px-5 py-3.5 backdrop-blur-sm">
            {/* Stylized stand-in for the track's cover (real art streams from the catalog). */}
            <span
                aria-hidden
                className="from-night-2 relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gradient-to-b to-black"
            >
                <span className="from-ember to-ember/40 absolute bottom-0 left-1/2 h-5 w-10 -translate-x-1/2 rounded-t-full bg-gradient-to-t" />
            </span>
            <div className="min-w-0">
                <p className="text-ink truncate text-sm font-medium">Relax &amp; Recharge</p>
                <p className="text-ink-dim truncate text-xs">UnioMystica</p>
            </div>
            <div className="text-ink-mid ml-auto flex items-center gap-2">
                <Heart className="h-3.5 w-3.5" />
                <SkipBack className="h-3.5 w-3.5" />
                <span className="text-ink flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                    {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
                </span>
                <SkipForward className="h-3.5 w-3.5" />
                <Repeat className="h-3.5 w-3.5" />
            </div>
            <div className="hidden items-center gap-2 xl:flex">
                <Volume2 className="text-ink-dim h-3.5 w-3.5" />
                <span className="h-1 w-16 rounded-full bg-white/15">
                    <span className="bg-ink-mid block h-1 w-10 rounded-full" />
                </span>
            </div>
        </div>
    );
}

function MiniSummary() {
    return (
        <div className="py-4 text-center">
            <p className="text-ink-dim text-xs tracking-[0.25em] uppercase">This week</p>
            <p className="text-ink mt-3 text-3xl font-medium">184 minutes focused</p>
            <p className="text-ink-mid mt-2 text-sm">
                7 sessions completed. Counted only while the timer ran — nothing padded.
            </p>
        </div>
    );
}
