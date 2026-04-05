import { auth } from '@clerk/nextjs/server';
import { appEnv } from './env';

export async function getServerAuthState() {
    if (!appEnv.isClerkConfigured) {
        return {
            clerkEnabled: false,
            isAuthenticated: false,
            userId: null,
        };
    }

    const authState = await auth();

    return {
        clerkEnabled: true,
        isAuthenticated: Boolean(authState.userId),
        userId: authState.userId,
    };
}
