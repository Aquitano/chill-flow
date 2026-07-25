'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/store/app-store';
import { UserButton } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { Check, ChevronDown, ListTodo, SlidersHorizontal } from 'lucide-react';

export const AppHeader: React.FC = () => {
    const modes = useAppStore((state) => state.modes);
    const currentMode = useAppStore((state) => state.currentMode);
    const tasks = useAppStore((state) => state.tasks);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const toggleMenu = useAppStore((state) => state.toggleMenu);
    const isMenuOpen = useAppStore((state) => state.isMenuOpen);
    const setMode = useAppStore((state) => state.setMode);
    const isTasksOpen = useAppStore((state) => state.isTasksOpen);
    const toggleTasks = useAppStore((state) => state.toggleTasks);

    const currentModeSettings = modes[currentMode];
    const openTaskCount = tasks.filter((task) => !task.isCompleted).length;

    return (
        <motion.header
            className="absolute top-0 right-0 left-0 z-20 flex items-center justify-between p-4 sm:p-6"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <div className="flex min-w-0 items-center gap-3">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-normal hover:bg-white/10"
                        >
                            <span className="bg-ember h-1.5 w-1.5 rounded-full" aria-hidden />
                            <span>{currentModeSettings?.label ?? 'Select mode'}</span>
                            <ChevronDown size={14} className="text-ink-dim" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72 border-white/10 bg-black/90 backdrop-blur-md">
                        <DropdownMenuLabel className="text-ink-dim">Mode</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        {Object.keys(modes).map((modeKey) => (
                            <DropdownMenuItem
                                key={modeKey}
                                className={`flex items-start gap-3 py-2.5 ${currentMode === modeKey ? 'bg-white/8' : ''}`}
                                onClick={() => setMode(modeKey)}
                            >
                                <Check
                                    size={14}
                                    className={`mt-0.5 shrink-0 ${currentMode === modeKey ? 'text-ember' : 'text-transparent'}`}
                                />
                                <span className="flex flex-col">
                                    <span className="font-medium">{modes[modeKey]?.label ?? modeKey}</span>
                                    <span className="text-ink-dim mt-0.5 text-xs">
                                        {modes[modeKey]?.description ?? ''}
                                    </span>
                                </span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
                <span className="text-ink-dim hidden text-xs md:block">
                    {sessionSummary.totalSessions} sessions
                    {sessionSummary.currentStreak > 0 ? ` · ${sessionSummary.currentStreak}-day streak` : ''}
                </span>
                <Button
                    variant="ghost"
                    className={`gap-2 rounded-full border px-3 text-sm ${
                        isTasksOpen
                            ? 'border-ember/40 bg-ember/10 text-ember hover:bg-ember/15'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                    onClick={toggleTasks}
                    aria-pressed={isTasksOpen}
                    aria-label={isTasksOpen ? 'Hide tasks' : 'Show tasks'}
                >
                    <ListTodo size={16} />
                    <span className="hidden sm:inline">Tasks</span>
                    <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-xs tabular-nums">{openTaskCount}</span>
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full border border-white/10 bg-white/5 hover:bg-white/10"
                    onClick={toggleMenu}
                    aria-expanded={isMenuOpen}
                    aria-label={isMenuOpen ? 'Close workspace settings' : 'Open workspace settings'}
                >
                    <SlidersHorizontal size={16} />
                </Button>
                {/* The workspace is otherwise a dead end: no way to reach the account or
                    sign out without editing the URL. */}
                <UserButton
                    appearance={{
                        elements: {
                            avatarBox: 'h-8 w-8 rounded-full ring-2 ring-white/20 hover:ring-white/40 transition-all',
                        },
                        variables: { fontFamily: 'var(--font-sans)' },
                    }}
                >
                    <UserButton.MenuItems>
                        <UserButton.Link
                            label="Workspace settings"
                            labelIcon={<SlidersHorizontal size={14} />}
                            href="/account"
                        />
                    </UserButton.MenuItems>
                </UserButton>
            </div>
        </motion.header>
    );
};
