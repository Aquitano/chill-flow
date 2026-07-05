'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCreateTaskMutation } from '@/hooks/use-app-data';
import { dueState, formatDue, quickDueOptions } from '@/lib/task-dates';
import {
    parseTaskInput,
    resolvePriority,
    stripPriorityTokens,
    type ParsedToken,
    type TaskPriority,
} from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import { CalendarDays, Check, CornerDownLeft, Flag, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DUE_CHIP, DUE_TOKEN_HIGHLIGHT } from './due-meta';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TokenHighlightInput } from './TokenHighlightInput';

/** Remove the given parser spans from the input, collapsing the whitespace they leave. */
function stripSpans(raw: string, spans: ParsedToken[]): string {
    let result = '';
    let cursor = 0;
    for (const span of spans) {
        result += raw.slice(cursor, span.start);
        cursor = span.end;
    }
    return (result + raw.slice(cursor)).replace(/\s{2,}/g, ' ').trim();
}

export function TaskComposer() {
    const createTask = useCreateTaskMutation();

    const [value, setValue] = useState('');
    const [manualPriority, setManualPriority] = useState<TaskPriority>('medium');
    const [manualDue, setManualDue] = useState<{ dueAt: Date; hasTime: boolean } | null>(null);
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

    // A typed date wins over a manual pick, mirroring how priority tokens behave.
    const dateToken = parsed.tokens.filter((token) => token.type === 'date').at(-1) ?? null;
    const effectiveDue = parsed.dueAt ? { dueAt: parsed.dueAt, hasTime: parsed.dueHasTime } : manualDue;

    const highlights = parsed.tokens.map((token) => ({
        start: token.start,
        end: token.end,
        className: token.type === 'priority' ? effectiveMeta.token : DUE_TOKEN_HIGHLIGHT,
    }));

    const canSubmit = parsed.text.length > 0 && !createTask.isPending;

    const reset = () => {
        setValue('');
        setManualPriority('medium');
        setManualDue(null);
    };

    const handleAdd = () => {
        if (!canSubmit) {
            return;
        }
        createTask.mutate(
            {
                text: parsed.text,
                priority: effectivePriority,
                dueAt: effectiveDue?.dueAt ?? null,
                dueHasTime: effectiveDue?.hasTime ?? false,
            },
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

    // Same rule for dates: a manual pick strips typed date tokens so they can't re-take
    // control, and "No date" clears both sources.
    const selectDue = (dueAt: Date | null) => {
        setManualDue(dueAt ? { dueAt, hasTime: false } : null);
        if (parsed.dueAt) {
            setValue(
                stripSpans(
                    value,
                    parsed.tokens.filter((token) => token.type === 'date'),
                ),
            );
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

    const priorityChipLabel = tokenActive
        ? `P${parsed.token?.level} · ${isReset ? 'Default' : effectiveMeta.label}`
        : effectiveMeta.label;

    const confirmations: string[] = [];
    if (tokenActive) {
        confirmations.push(
            isReset
                ? `${parsed.token?.raw} sets default priority`
                : `${parsed.token?.raw} → ${effectiveMeta.label} priority`,
        );
    }
    if (dateToken && parsed.dueAt) {
        confirmations.push(`${dateToken.raw} → ${formatDue(parsed.dueAt, parsed.dueHasTime)}`);
    }

    return (
        <div
            className="mb-4 rounded-xl border border-white/15 bg-neutral-900/80 p-3 shadow-lg"
            // Escape closes the card from anywhere inside it (input, chip, footer). The
            // chip menus live in portals, so their own Escape-to-close doesn't reach here.
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    handleCancel();
                }
            }}
        >
            <TokenHighlightInput
                value={value}
                onChange={setValue}
                highlights={highlights}
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
                                aria-label={`Priority: ${priorityChipLabel}`}
                                aria-describedby={hintId}
                            >
                                <Flag className="h-3.5 w-3.5" />
                                {priorityChipLabel}
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
                                    onSelect={() => selectPriority(option.value)}
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
                        className="pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 rounded-md border border-white/10 bg-neutral-800 px-2 py-1 text-[11px] whitespace-nowrap text-neutral-200 opacity-0 shadow-md transition-opacity duration-150 group-focus-within/hint:opacity-100 group-hover/hint:opacity-100"
                    >
                        Type <span className="font-mono">p1</span>–<span className="font-mono">p4</span> or a date like{' '}
                        <span className="font-mono">tomorrow 5pm</span>
                    </span>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition',
                                effectiveDue
                                    ? DUE_CHIP[dueState(effectiveDue.dueAt, effectiveDue.hasTime)]
                                    : 'border-white/15 bg-white/5 text-neutral-400 hover:text-neutral-200',
                            )}
                            aria-label={
                                effectiveDue
                                    ? `Due date: ${formatDue(effectiveDue.dueAt, effectiveDue.hasTime)}`
                                    : 'Set due date'
                            }
                        >
                            <CalendarDays className="h-3.5 w-3.5" />
                            {effectiveDue ? formatDue(effectiveDue.dueAt, effectiveDue.hasTime) : 'Date'}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="bg-black/90 backdrop-blur-md"
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            inputRef.current?.focus();
                        }}
                    >
                        {quickDueOptions().map((option) => (
                            <DropdownMenuItem key={option.id} onSelect={() => selectDue(option.dueAt)}>
                                <CalendarDays className="h-3.5 w-3.5 text-neutral-400" />
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                        {effectiveDue && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => selectDue(null)}>
                                    <X className="h-3.5 w-3.5 text-neutral-400" />
                                    No date
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Always-mounted live region: text only appears once a token is recognized,
                    so screen readers announce the confirmation as a mutation in a stable node. */}
                <span
                    role="status"
                    aria-live="polite"
                    className="inline-flex items-center gap-1 text-xs text-neutral-200"
                >
                    {confirmations.length > 0 && (
                        <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            {confirmations.join(' · ')}
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
