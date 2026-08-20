'use client';

import { describeApiError } from '@/lib/api';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { HTTPException } from 'hono/http-exception';
import dynamic from 'next/dynamic';
import { PropsWithChildren, useState } from 'react';
import { Toaster, toast } from 'sonner';
const AudioDebugTrigger =
    process.env.NODE_ENV === 'development'
        ? dynamic(() => import('./dev/AudioDebugPanel').then((m) => m.AudioDebugTrigger), { ssr: false })
        : ((() => null) as unknown as React.FC);

export const Providers = ({ children }: PropsWithChildren) => {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                queryCache: new QueryCache({
                    onError: (err) => {
                        if (err instanceof HTTPException) {
                            // Initial workspace queries surface their own full-screen error
                            // state in AppShell, so query errors are intentionally not toasted.
                        }
                    },
                }),
                mutationCache: new MutationCache({
                    // Every failed mutation (task/preference/session) surfaces a toast so
                    // failures are never silent. The message id dedupes identical errors
                    // (e.g. a flapping background preference save). Mutations that name the
                    // failed action themselves opt out via `meta.toasted`.
                    onError: (error, _variables, _context, mutation) => {
                        if (mutation.meta?.toasted) return;
                        const message = describeApiError(error);
                        toast.error(message, { id: message });
                    },
                }),
            }),
    );

    return (
        <QueryClientProvider client={queryClient}>
            {/* reducedMotion="user" turns every Framer transform animation into an
                instant/opacity-only change when the OS asks for reduced motion. */}
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
            <Toaster theme="dark" position="bottom-center" richColors closeButton />
            {process.env.NODE_ENV === 'development' ? <AudioDebugTrigger /> : null}
        </QueryClientProvider>
    );
};
