'use client';

import { useCreateTaskMutation } from '@/hooks/use-app-data';
import { SignInButton, useClerk, useUser } from '@clerk/nextjs';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function TaskInput() {
    const [task, setTask] = useState('');
    const { user } = useUser();
    const { openSignIn } = useClerk();
    const createTask = useCreateTaskMutation();
    const router = useRouter();

    const placeholder = user?.firstName
        ? `What would you like to focus on, ${user.firstName}?`
        : 'What do you want to focus on?';

    const handleSubmit = async () => {
        if (!task.trim()) return;

        // Signed out, Enter should open auth — creating the task would just 401.
        if (!user) {
            openSignIn();
            return;
        }

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

    const submitButton = user ? (
        <button
            type="button"
            disabled={!task.trim() || createTask.isPending}
            onClick={handleSubmit}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ember px-4 py-2.5 text-sm font-medium text-night transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
            Start
            <ArrowRight className="h-4 w-4" />
        </button>
    ) : (
        <SignInButton mode="modal">
            <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ember px-4 py-2.5 text-sm font-medium text-night transition hover:bg-ember/90"
            >
                Start
                <ArrowRight className="h-4 w-4" />
            </button>
        </SignInButton>
    );

    return (
        <div className="group flex w-full items-center gap-2 rounded-2xl border border-white/12 bg-black/40 p-2 pl-4 shadow-lg transition-colors focus-within:border-ember/50 hover:border-white/25">
            <input
                type="text"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder={placeholder}
                aria-label="Focus task"
                className="min-w-0 flex-1 bg-transparent py-2 text-ink placeholder:text-ink-dim focus:outline-none"
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        handleSubmit();
                    }
                }}
            />
            {submitButton}
        </div>
    );
}
