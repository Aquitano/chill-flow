import { clerkClient } from '@clerk/nextjs/server';
import { cache } from 'react';

/**
 * Admin is determined by Clerk `publicMetadata.role === 'admin'`. Read from the canonical
 * user record (not session claims) so it works without customizing the session token.
 *
 * Wrapped in React `cache` so repeated checks within a single server request (e.g. a page
 * guard plus the tRPC admin procedures it renders) reuse one Clerk lookup instead of
 * re-fetching the user each time.
 */
export const isAdminUser = cache(async (userId: string): Promise<boolean> => {
    try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        return (user.publicMetadata as { role?: unknown } | null)?.role === 'admin';
    } catch {
        return false;
    }
});
