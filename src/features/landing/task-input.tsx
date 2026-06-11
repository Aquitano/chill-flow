'use client';

import { Button } from '@/components/ui/button';
import { useCreateTaskMutation } from '@/hooks/use-app-data';
import { SignInButton, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function TaskInput() {
    const [task, setTask] = useState('');
    const { user } = useUser();
    const createTask = useCreateTaskMutation();
    const router = useRouter();

    const placeholder = user
        ? `What would you like to focus on, ${user.firstName ?? 'there'}?`
        : 'Add a focus task and jump into your workspace';

    const handleSubmit = async () => {
        if (!task.trim()) return;

        try {
            await createTask.mutateAsync({
                text: task.trim(),
                priority: 'medium',
            });
            router.push('/app');
        } catch {
            router.push('/app');
        }
    };

    return (
        <div className="group relative mx-auto w-full max-w-xl rounded-xl bg-linear-to-r from-black/20 via-black/10 to-black/20 transition-colors duration-300 hover:from-black/60 hover:via-black/40 hover:to-black/60">
            <div className="rounded-xl border-2 border-white/20 bg-black/50 p-4 shadow-lg transition-colors duration-300 hover:border-white/40">
                <input
                    type="text"
                    value={task}
                    onChange={(event) => setTask(event.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-transparent p-2 text-white placeholder-gray-400 focus:outline-none"
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            handleSubmit();
                        }
                    }}
                />
                <div className="mt-3 flex justify-end">
                    {user ? (
                        <Button
                            variant="outline"
                            disabled={!task.trim() || createTask.isPending}
                            onClick={handleSubmit}
                        >
                            Add to Flow
                        </Button>
                    ) : (
                        <SignInButton mode="modal">
                            <Button variant="outline">Sign In To Start</Button>
                        </SignInButton>
                    )}
                </div>
            </div>
        </div>
    );
}
