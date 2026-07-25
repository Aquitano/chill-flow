'use client';

import { cn } from '@/lib/utils';

export function ToggleSwitch({
    checked,
    onChange,
    label,
    disabled,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'focus-visible:outline-ember relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
                checked ? 'bg-ember' : 'bg-white/15 hover:bg-white/25',
            )}
        >
            <span
                className={cn(
                    'inline-block h-5 w-5 rounded-full transition-transform',
                    checked ? 'bg-night translate-x-5' : 'translate-x-0.5 bg-white',
                )}
            />
        </button>
    );
}
