import type { TaskPriority } from '@/lib/task-parser';

export interface PriorityMeta {
    value: TaskPriority;
    label: string;
    chip: string;
    accent: string;
    ring: string;
    token: string;
}

/** Ordered high -> low so menus and the priority cycle read top-down. */
export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
    high: {
        value: 'high',
        label: 'High',
        chip: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
        accent: 'text-rose-300',
        ring: 'border-rose-400/70',
        token: 'bg-rose-500/30 text-rose-50',
    },
    medium: {
        value: 'medium',
        label: 'Medium',
        chip: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
        accent: 'text-amber-200',
        ring: 'border-amber-300/70',
        token: 'bg-amber-400/30 text-amber-50',
    },
    low: {
        value: 'low',
        label: 'Low',
        chip: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
        accent: 'text-sky-300',
        ring: 'border-sky-400/70',
        token: 'bg-sky-500/30 text-sky-50',
    },
};

export const PRIORITY_OPTIONS: PriorityMeta[] = [PRIORITY_META.high, PRIORITY_META.medium, PRIORITY_META.low];
