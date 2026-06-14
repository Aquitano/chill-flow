'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCreateTaskMutation } from '@/hooks/use-app-data';
import { parseTaskInput, resolvePriority, stripPriorityTokens, type TaskPriority } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import { Check, CornerDownLeft, Flag, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { PriorityHighlightInput } from './PriorityHighlightInput';

export function TaskComposer() {
    const createTask = useCreateTaskMutation();

    const [value, setValue] = useState('');
    const [manualPriority, setManualPriority] = useState<TaskPriority>('medium');
    const [expanded, setExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const hintId = useId();

    // Focus the field whenever the card opens (trigger click or first focus).
    useEffect(() => {
        if (expanded) {
            inputRef.current?.focus();
        }
    }, [expanded]);

    const parsed = parseTaskInput(value);
    const tokenActive = parsed.token !== null;
    const effectivePriority = resolvePriority(parsed, manualPriority);
    const effectiveMeta = PRIORITY_META[effectivePriority];
    // p4 has no level of its own: it resolves to the default (medium) and reads as a
    // reset. Style everything off the *resolved* priority so the chip, the inline
    // highlight, and the created row all agree on the colour.
    const isReset = tokenActive && parsed.priority === null;

    const canSubmit = parsed.text.length > 0 && !createTask.isPending;

    const reset = () => {
        setValue('');
        setManualPriority('medium');
    };

    const handleAdd = () => {
        if (!canSubmit) {
            return;
        }
        createTask.mutate(
            { text: parsed.text, priority: resolvePriority(parsed, manualPriority) },
            {
                // Keep the card open and focused after a successful add so the next task
                // can be typed immediately; only clear the draft once it resolves so a
                // failed create keeps the text for an easy retry.
                onSuccess: () => {
                    reset();
                    inputRef.current?.focus();
                },
            },
        );
    };

    const handleCancel = () => {
        reset();
        setExpanded(false);
    };

    // Picking a priority manually wins over a typed token: strip every token so the field
    // and the chip can't disagree (stripping only the last would leave an earlier token to
    // re-take control on the next render).
    const selectPriority = (priority: TaskPriority) => {
        setManualPriority(priority);
        if (tokenActive) {
            setValue(stripPriorityTokens(value));
        }
        inputRef.current?.focus();
    };

    if (!expanded) {
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="group mb-4 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-neutral-400 transition hover:border-white/20 hover:text-white"
            >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/80 text-white transition group-hover:bg-rose-500">
                    <Plus className="h-3.5 w-3.5" />
                </span>
                Add task
            </button>
        );
    }

    const chipLabel = tokenActive
        ? `P${parsed.token?.level} · ${isReset ? 'Default' : effectiveMeta.label}`
        : effectiveMeta.label;
    const hintText = tokenActive
        ? isReset
            ? `${parsed.token?.raw} sets default priority`
            : `${parsed.token?.raw} → ${effectiveMeta.label} priority`
        : 'Type p1–p4 to set priority';

    return (
        <div
            className="mb-4 rounded-xl border border-white/15 bg-neutral-900/80 p-3 shadow-lg"
            // Escape closes the card from anywhere inside it (input, chip, footer). The
            // priority menu lives in a portal, so its own Escape-to-close doesn't reach here.
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    handleCancel();
                }
            }}
        >
            <PriorityHighlightInput
                value={value}
                onChange={setValue}
                token={parsed.token}
                tokenClassName={parsed.token ? effectiveMeta.token : undefined}
                placeholder="Task name"
                inputRef={inputRef}
                ariaLabel="Task name"
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        handleAdd();
                    }
                }}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* group/hint drives the hover+focus tooltip on the priority button. */}
                <div className="group/hint relative">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition',
                                    effectiveMeta.chip,
                                )}
                                aria-label={`Priority: ${chipLabel}`}
                                aria-describedby={hintId}
                            >
                                <Flag className="h-3.5 w-3.5" />
                                {chipLabel}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="bg-black/90 backdrop-blur-md"
                            // Radix restores focus to the trigger (the chip) on close; send it
                            // back to the task field so the user can keep typing.
                            onCloseAutoFocus={(event) => {
                                event.preventDefault();
                                inputRef.current?.focus();
                            }}
                        >
                            {PRIORITY_OPTIONS.map((option) => (
                                <DropdownMenuItem
                                    key={option.value}
                                    onClick={() => selectPriority(option.value)}
                                    className={!tokenActive && manualPriority === option.value ? 'bg-white/10' : ''}
                                >
                                    <Flag className={cn('h-3.5 w-3.5', PRIORITY_META[option.value].accent)} />
                                    {option.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <span
                        id={hintId}
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 whitespace-nowrap rounded-md border border-white/10 bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 opacity-0 shadow-md transition-opacity duration-150 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100"
                    >
                        Type <span className="font-mono">p1</span>–<span className="font-mono">p4</span> to set priority
                    </span>
                </div>

                {/* Always-mounted live region: text only appears once a token is recognized,
                    so screen readers announce the confirmation as a mutation in a stable node. */}
                <span role="status" aria-live="polite" className="inline-flex items-center gap-1 text-xs text-neutral-200">
                    {tokenActive && (
                        <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            {hintText}
                        </>
                    )}
                </span>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="hidden items-center gap-1 text-[11px] text-neutral-500 sm:flex">
                    <CornerDownLeft className="h-3 w-3" /> to add
                </span>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                        <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={handleAdd} disabled={!canSubmit}>
                        Add task
                    </Button>
                </div>
            </div>
        </div>
    );
}
