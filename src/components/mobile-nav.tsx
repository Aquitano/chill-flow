'use client';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export function MobileNav() {
    const [open, setOpen] = useState(false);

    const handleLinkClick = (href: string) => {
        setOpen(false);
        setTimeout(() => {
            document.querySelector(href)?.scrollIntoView({
                behavior: 'smooth',
            });
        }, 100);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] border-white/20 bg-black/95 p-0 sm:w-[400px]">
                <div className="flex h-full flex-col justify-between">
                    <div>
                        <div className="border-b border-white/10 p-6">
                            <Link href="/" className="text-xl font-bold" onClick={() => setOpen(false)}>
                                ChillFlow
                            </Link>
                        </div>

                        <SignedIn>
                            <div className="mt-6 flex items-center justify-between border-b border-white/10 px-6 pb-6">
                                <div className="flex items-center gap-4">
                                    <UserButton
                                        appearance={{
                                            elements: {
                                                avatarBox:
                                                    'h-10 w-10 rounded-full ring-2 ring-white/20 hover:ring-white/40 transition-all',
                                            },
                                            variables: {
                                                fontFamily: 'var(--font-sans)',
                                            },
                                        }}
                                    />
                                    <div>
                                        <p className="text-sm font-medium text-white">Your Account</p>
                                        <p className="text-xs text-neutral-400">Manage your settings</p>
                                    </div>
                                </div>
                            </div>
                        </SignedIn>

                        <nav className="space-y-1 px-3 py-6">
                            <Link
                                href="#inside"
                                className="flex w-full rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-white/5"
                                onClick={() => handleLinkClick('#inside')}
                            >
                                Inside the room
                            </Link>
                            <Link
                                href="#listen"
                                className="flex w-full rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-white/5"
                                onClick={() => handleLinkClick('#listen')}
                            >
                                Hear the room
                            </Link>
                            <Link
                                href="#modes"
                                className="flex w-full rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-white/5"
                                onClick={() => handleLinkClick('#modes')}
                            >
                                Modes
                            </Link>
                            <SignedIn>
                                <Link
                                    href="/app"
                                    className="flex w-full rounded-md px-3 py-3 text-base font-medium text-ember transition-colors hover:bg-white/5"
                                    onClick={() => setOpen(false)}
                                >
                                    Open workspace
                                </Link>
                            </SignedIn>
                        </nav>
                    </div>

                    <SignedOut>
                        <div className="border-t border-white/10 p-6">
                            <div className="flex flex-col gap-3">
                                <SignInButton mode="modal">
                                    <Button
                                        variant="ghost"
                                        className="w-full justify-center border border-white/20 py-6 text-base"
                                        onClick={() => setOpen(false)}
                                    >
                                        Login
                                    </Button>
                                </SignInButton>
                                <SignUpButton mode="modal">
                                    <Button
                                        variant="default"
                                        className="w-full justify-center bg-ember py-6 text-base font-medium text-night hover:bg-ember/90"
                                        onClick={() => setOpen(false)}
                                    >
                                        Get started
                                    </Button>
                                </SignUpButton>
                            </div>
                        </div>
                    </SignedOut>

                    <SignedIn>
                        <div className="border-t border-white/10 p-6">
                            <Link
                                href="/account"
                                className="flex w-full items-center justify-center rounded-md border border-white/20 px-4 py-3 text-base font-medium transition-colors hover:bg-white/5"
                                onClick={() => setOpen(false)}
                            >
                                Account Settings
                            </Link>
                        </div>
                    </SignedIn>
                </div>
            </SheetContent>
        </Sheet>
    );
}
