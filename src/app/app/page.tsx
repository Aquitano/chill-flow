import { AppShell } from '@/components/app/AppShell';
import { getServerAuthState } from '@/lib/auth';
import { appEnv } from '@/lib/env';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AppPage() {
    const authState = await getServerAuthState();

    if (!appEnv.isClerkConfigured || !appEnv.isDatabaseConfigured) {
        redirect('/account');
    }

    if (!authState.isAuthenticated) {
        redirect('/');
    }

    return <AppShell />;
}
