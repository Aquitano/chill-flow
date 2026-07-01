import { AdminTracks } from '@/components/admin/AdminTracks';
import { Button } from '@/components/ui/button';
import { getServerAuthState } from '@/lib/auth';
import { isAdminUser } from '@/server/security/admin';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    const authState = await getServerAuthState();

    if (!authState.isAuthenticated || !authState.userId) {
        redirect('/account');
    }
    if (!(await isAdminUser(authState.userId))) {
        redirect('/app');
    }

    return (
        <main className="min-h-screen bg-[#070807] px-6 py-10 text-white">
            <div className="mx-auto w-full max-w-5xl">
                <header className="mb-8 flex items-center justify-between gap-4">
                    <div>
                        <Link href="/" className="text-lg font-semibold tracking-wide">
                            ChillFlow
                        </Link>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Admin · Soundtracks</p>
                    </div>
                    <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                        <Link href="/app">Open workspace</Link>
                    </Button>
                </header>

                <h1 className="mb-8 text-4xl font-semibold leading-tight">Manage soundtracks</h1>
                <AdminTracks />
            </div>
        </main>
    );
}
