import { AccountSettings } from '@/components/account/AccountSettings';
import { Button } from '@/components/ui/button';
import { getServerAuthState } from '@/lib/auth';
import { appEnv } from '@/lib/env';
import { isAdminUser } from '@/server/security/admin';
import { SignInButton } from '@clerk/nextjs';
import { CheckCircle2, Database, ExternalLink, KeyRound, ShieldAlert, Sparkles, UserRound } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const setupItems = [
    {
        label: 'Clerk authentication',
        description: 'Required for sign-in, protected routes, and per-user workspace data.',
        configured: appEnv.isClerkConfigured,
        icon: KeyRound,
        envVars: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY',
    },
    {
        label: 'Postgres database',
        description: 'Required for tasks, preferences, sessions, and progress summaries.',
        configured: appEnv.isDatabaseConfigured,
        icon: Database,
        envVars: 'DATABASE_URL',
    },
];

function PageHeader({ isWorkspaceReady }: { isWorkspaceReady: boolean }) {
    return (
        <div className="mb-10 flex items-center justify-between gap-4">
            <Link href="/" className="text-lg font-semibold tracking-wide">
                ChillFlow
            </Link>
            <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Link href={isWorkspaceReady ? '/app' : '/'}>Open workspace</Link>
            </Button>
        </div>
    );
}

export default async function AccountPage() {
    const isWorkspaceReady = appEnv.isClerkConfigured && appEnv.isDatabaseConfigured;
    const authState = await getServerAuthState();

    // Configured + signed in → the real settings page.
    if (isWorkspaceReady && authState.isAuthenticated) {
        const isAdmin = authState.userId ? await isAdminUser(authState.userId) : false;

        return (
            <main className="min-h-screen bg-[#070807] px-6 py-10 text-white">
                <div className="mx-auto w-full max-w-3xl">
                    <PageHeader isWorkspaceReady />
                    <div className="mb-6 flex flex-wrap items-center gap-3">
                        <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-neutral-300">
                            <UserRound className="h-3.5 w-3.5" />
                            Account & settings
                        </div>
                        {isAdmin && (
                            <Link
                                href="/admin"
                                className="inline-flex items-center gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-400/20"
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                Admin · soundtracks
                            </Link>
                        )}
                    </div>
                    <h1 className="mb-8 text-4xl font-semibold leading-tight md:text-5xl">Settings</h1>
                    <AccountSettings />
                </div>
            </main>
        );
    }

    // Configured but signed out → prompt sign-in.
    if (isWorkspaceReady && !authState.isAuthenticated) {
        return (
            <main className="min-h-screen bg-[#070807] px-6 py-10 text-white">
                <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col">
                    <PageHeader isWorkspaceReady />
                    <div className="flex flex-1 items-center justify-center">
                        <div className="max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40">
                            <UserRound className="mx-auto h-8 w-8 text-neutral-300" />
                            <h1 className="mt-4 text-2xl font-semibold">Sign in to manage your account</h1>
                            <p className="mt-3 text-sm leading-6 text-neutral-400">
                                Your focus preferences, tasks, and progress are saved to your account.
                            </p>
                            <div className="mt-6 flex justify-center gap-3">
                                <SignInButton mode="modal">
                                    <Button className="bg-white text-black hover:bg-neutral-200">Sign in</Button>
                                </SignInButton>
                                <Button
                                    asChild
                                    variant="outline"
                                    className="border-white/15 bg-transparent text-white hover:bg-white/10"
                                >
                                    <Link href="/">Back to home</Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // Not configured → setup status (deployable-MVP requirement).
    return (
        <main className="min-h-screen bg-[#070807] px-6 py-10 text-white">
            <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center">
                <PageHeader isWorkspaceReady={isWorkspaceReady} />

                <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
                    <div>
                        <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-neutral-300">
                            <UserRound className="h-3.5 w-3.5" />
                            Account setup
                        </div>
                        <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white md:text-6xl">
                            Finish setup to use ChillFlow.
                        </h1>
                        <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-300 md:text-lg">
                            ChillFlow MVP requires Clerk and Postgres. Demo mode is not supported for the deployable
                            workspace because focus sessions, tasks, preferences, and progress must persist per user.
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3">
                            <Button asChild className="bg-white text-black hover:bg-neutral-200">
                                <Link href="/">Continue</Link>
                            </Button>
                            <Button
                                asChild
                                variant="outline"
                                className="border-white/15 bg-transparent text-white hover:bg-white/10"
                            >
                                <Link href="/#features">Review MVP features</Link>
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40">
                        <div className="flex items-start gap-3 border-b border-white/10 pb-5">
                            {isWorkspaceReady ? (
                                <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-300" />
                            ) : (
                                <ShieldAlert className="mt-1 h-5 w-5 text-amber-300" />
                            )}
                            <div>
                                <h2 className="text-lg font-semibold">MVP configuration</h2>
                                <p className="mt-1 text-sm leading-6 text-neutral-400">
                                    Set these environment variables locally and in Vercel before opening `/app`.
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {setupItems.map((item) => {
                                const Icon = item.icon;

                                return (
                                    <div key={item.label} className="rounded-md border border-white/10 bg-black/25 p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex gap-3">
                                                <Icon className="mt-1 h-4 w-4 text-neutral-300" />
                                                <div>
                                                    <h3 className="font-medium">{item.label}</h3>
                                                    <p className="mt-1 text-sm leading-5 text-neutral-400">
                                                        {item.description}
                                                    </p>
                                                </div>
                                            </div>
                                            <span
                                                className={`rounded px-2 py-1 text-xs font-medium ${
                                                    item.configured
                                                        ? 'bg-emerald-400/10 text-emerald-200'
                                                        : 'bg-amber-400/10 text-amber-200'
                                                }`}
                                            >
                                                {item.configured ? 'Configured' : 'Required'}
                                            </span>
                                        </div>
                                        <code className="mt-3 block rounded bg-black/40 px-3 py-2 text-xs text-neutral-300">
                                            {item.envVars}
                                        </code>
                                    </div>
                                );
                            })}
                        </div>

                        <Button
                            asChild
                            variant="outline"
                            className="mt-5 w-full border-white/15 bg-white/5 text-white hover:bg-white/10"
                        >
                            <Link href="https://github.com/aquitano/chill-flow" target="_blank" rel="noreferrer">
                                Read setup docs
                                <ExternalLink className="h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </section>
            </div>
        </main>
    );
}
