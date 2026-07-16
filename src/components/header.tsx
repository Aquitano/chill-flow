'use client';

import { MobileNav } from '@/components/mobile-nav';
import { Button } from '@/components/ui/button';
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { motion, useMotionTemplate, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { Suspense } from 'react';

const NAV_LINKS = [
    { label: 'Inside', href: '/#inside' },
    { label: 'Listen', href: '/#listen' },
    { label: 'Modes', href: '/#modes' },
];

export function Header() {
    const { scrollY } = useScroll();

    // MotionValues must be composed with useMotionTemplate — calling .get() in style
    // would snapshot the initial value and never update on scroll.
    const bgOpacity = useTransform(scrollY, [0, 80], [0, 0.75]);
    const blur = useTransform(scrollY, [0, 80], [0, 14]);
    const borderOpacity = useTransform(scrollY, [0, 80], [0, 0.1]);
    const backgroundColor = useMotionTemplate`oklch(0.155 0.008 80 / ${bgOpacity})`;
    const backdropFilter = useMotionTemplate`blur(${blur}px)`;
    const borderBottomColor = useMotionTemplate`rgba(255,255,255,${borderOpacity})`;

    return (
        <motion.header
            className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between border-b border-transparent px-4 py-4 sm:px-8"
            style={{ backgroundColor, backdropFilter, borderBottomColor }}
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        >
            <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
                ChillFlow
            </Link>

            <nav className="hidden items-center gap-6 md:flex">
                <SignedOut>
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-sm text-ink-mid transition-colors hover:text-ink"
                        >
                            {link.label}
                        </Link>
                    ))}
                </SignedOut>
                <Suspense fallback={<AuthLoadingSkeleton />}>
                    <SignedOut>
                        <div className="flex items-center gap-2">
                            <SignInButton mode="modal">
                                <Button variant="ghost" size="sm" className="px-3 text-sm hover:bg-white/10">
                                    Sign in
                                </Button>
                            </SignInButton>
                            <SignUpButton mode="modal">
                                <Button
                                    size="sm"
                                    className="rounded-full bg-ember px-4 text-sm font-medium text-night hover:bg-ember/90"
                                >
                                    Get started
                                </Button>
                            </SignUpButton>
                        </div>
                    </SignedOut>
                    <SignedIn>
                        <div className="flex items-center gap-3">
                            <Link href="/app">
                                <Button
                                    size="sm"
                                    className="rounded-full bg-ember px-4 text-sm font-medium text-night hover:bg-ember/90"
                                >
                                    Open workspace
                                </Button>
                            </Link>
                            <UserButton
                                appearance={{
                                    elements: {
                                        avatarBox:
                                            'h-8 w-8 rounded-full ring-2 ring-white/20 hover:ring-white/40 transition-all',
                                    },
                                    variables: {
                                        fontFamily: 'var(--font-sans)',
                                    },
                                }}
                            />
                        </div>
                    </SignedIn>
                </Suspense>
            </nav>

            <div className="flex md:hidden">
                <MobileNav />
            </div>
        </motion.header>
    );
}

function AuthLoadingSkeleton() {
    return (
        <div className="flex items-center gap-2">
            <div className="h-8 w-16 animate-pulse rounded-md bg-white/10" />
            <div className="h-8 w-24 animate-pulse rounded-full bg-white/10" />
        </div>
    );
}
