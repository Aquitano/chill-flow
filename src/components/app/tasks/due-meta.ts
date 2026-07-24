import type { DueState } from '@/lib/task-dates';

export const DUE_CHIP: Record<DueState, string> = {
    overdue: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    today: 'border-ember/40 bg-ember/10 text-ember',
    upcoming: 'border-white/15 bg-white/5 text-ink-mid',
};

export const DUE_TEXT: Record<DueState, string> = {
    overdue: 'text-rose-300',
    today: 'text-ember',
    upcoming: 'text-ink-dim',
};

export const DUE_TOKEN_HIGHLIGHT = 'bg-ember/25 text-ember';
