'use client';

import { SignUpButton, SignedIn, SignedOut } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function ClosingSection() {
    return (
        <section className="relative z-10 mt-40 overflow-hidden sm:mt-52">
            <div
                aria-hidden
                className="ember-halo pointer-events-none absolute top-1/2 left-1/2 aspect-[2/1] w-[min(64rem,120vw)] -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="relative mx-auto max-w-3xl px-6 py-16 text-center"
            >
                <h2 className="font-serif text-4xl font-light text-ink italic sm:text-5xl">The room is ready.</h2>
                <p className="mx-auto mt-5 max-w-md text-base text-ink-mid">
                    Your sound, timer, and tasks are saved to your account — everything is exactly where you left it
                    when you come back.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <SignedOut>
                        <SignUpButton mode="modal">
                            <button
                                type="button"
                                className="flex items-center gap-2 rounded-full bg-ember px-7 py-3 text-sm font-medium text-night transition hover:bg-ember/90"
                            >
                                Create your room
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </SignUpButton>
                        <span className="text-sm text-ink-dim">Free account — start a session in under a minute.</span>
                    </SignedOut>
                    <SignedIn>
                        <Link
                            href="/app"
                            className="flex items-center gap-2 rounded-full bg-ember px-7 py-3 text-sm font-medium text-night transition hover:bg-ember/90"
                        >
                            Open the workspace
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </SignedIn>
                </div>
            </motion.div>
        </section>
    );
}
