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
import { motion } from 'framer-motion';
import { Activity, BarChart3, ChevronDown, Menu } from 'lucide-react';

export const AppHeader: React.FC = () => {
    const modes = useAppStore((state) => state.modes);
    const currentMode = useAppStore((state) => state.currentMode);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const toggleMenu = useAppStore((state) => state.toggleMenu);
    const setMode = useAppStore((state) => state.setMode);

    const currentModeSettings = modes[currentMode];

    return (
        <motion.header
            className="absolute top-0 right-0 left-0 z-20 flex items-center justify-between p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <div className="flex items-center gap-3">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="flex items-center gap-2 pl-1 text-sm font-normal">
                            <Activity size={18} />
                            <span>{currentModeSettings?.label ?? 'Select Mode'}</span>
                            <ChevronDown size={16} className="ml-1 text-neutral-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64 border-neutral-800 bg-black/90 backdrop-blur-md">
                        <DropdownMenuLabel>Flow Modes</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-neutral-800" />
                        {Object.keys(modes).map((modeKey) => (
                            <DropdownMenuItem
                                key={modeKey}
                                className={`flex flex-col items-start py-3 ${
                                    currentMode === modeKey ? 'bg-neutral-800/50' : ''
                                }`}
                                onClick={() => setMode(modeKey)}
                            >
                                <span className="font-medium">{modes[modeKey]?.label ?? modeKey}</span>
                                <span className="mt-1 text-xs text-neutral-400">{modes[modeKey]?.description ?? ''}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 md:block">
                    {currentModeSettings?.description}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="hidden items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-200 md:flex">
                    <BarChart3 size={16} />
                    <span>{sessionSummary.totalSessions} sessions</span>
                    <span className="text-emerald-400">·</span>
                    <span>{sessionSummary.currentStreak} day streak</span>
                </div>
                <Button variant="ghost" size="icon" onClick={toggleMenu}>
                    <Menu size={18} />
                </Button>
            </div>
        </motion.header>
    );
};
