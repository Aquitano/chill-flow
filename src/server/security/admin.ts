import { clerkClient } from '@clerk/nextjs/server';

/**
 * Admin is determined by Clerk `publicMetadata.role === 'admin'`. Read from the canonical
 * user record (not session claims) so it works without customizing the session token.
 */
export async function isAdminUser(userId: string): Promise<boolean> {
    try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        return (user.publicMetadata as { role?: unknown } | null)?.role === 'admin';
    } catch {
        return false;
    }
}
