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
    MAX_TASK_LENGTH,
    parseTaskInput,
    resolvePriority,
    stripSpans,
    stripPriorityTokens,
    type TaskPriority,
} from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import { CalendarDays, Check, CornerDownLeft, Flag, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DUE_CHIP, DUE_TOKEN_HIGHLIGHT } from './due-meta';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TokenHighlightInput } from './TokenHighlightInput';

/** How close to the ceiling the length notice appears; a permanent counter would be noise. */
const LENGTH_NOTICE_AT = 20;

export function TaskComposer() {
    const createTask = useCreateTaskMutation();

    const [value, setValue] = useState('');
    const [manualPriority, setManualPriority] = useState<TaskPriority>('medium');
    const [manualDue, setManualDue] = useState<{ dueAt: Date; hasTime: boolean } | null>(null);
    const [expanded, setExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const hintId = useId();

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

    // The limit applies to the text the server stores — tokens are stripped before it is
    // measured, so a `maxLength` on the field would cut the wrong string.
    const remaining = MAX_TASK_LENGTH - parsed.text.length;
    const canSubmit = parsed.text.length > 0 && remaining >= 0 && !createTask.isPending;

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
                className="group focus-visible:outline-ember mb-4 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-ink-dim transition hover:border-white/20 hover:text-ink focus-visible:outline-2"
            >
                <span className="bg-ember/80 text-night group-hover:bg-ember flex h-5 w-5 items-center justify-center rounded-full transition">
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

    // Short strings on purpose: the footer has ~260px at the panel's minimum width.
    const lengthNotice =
        remaining > LENGTH_NOTICE_AT
            ? ''
            : remaining < 0
              ? `${-remaining} over the limit`
              : `${remaining} ${remaining === 1 ? 'character' : 'characters'} left`;

    return (
        <div
            className="mb-4 rounded-xl border border-white/15 bg-night-2/90 p-3 shadow-lg"
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
                                <Flag className="h-3.5 w-3.5" fill={effectiveMeta.flagFill} />
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
                                    <Flag className={cn('h-3.5 w-3.5', option.accent)} fill={option.flagFill} />
                                    {option.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <span
                        id={hintId}
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 rounded-md border border-white/10 bg-night-2 px-2 py-1 text-[11px] whitespace-nowrap text-ink-mid opacity-0 shadow-md transition-opacity duration-150 group-focus-within/hint:opacity-100 group-hover/hint:opacity-100"
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
                                    : 'border-white/15 bg-white/5 text-ink-dim hover:text-ink-mid',
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
                                <CalendarDays className="h-3.5 w-3.5 text-ink-dim" />
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                        {effectiveDue && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => selectDue(null)}>
                                    <X className="h-3.5 w-3.5 text-ink-dim" />
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
                    className="inline-flex items-center gap-1 text-xs text-ink-mid"
                >
                    {confirmations.length > 0 && (
                        <>
                            <Check className="h-3 w-3 text-ember" />
                            {confirmations.join(' · ')}
                        </>
                    )}
                </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
                <span className="flex min-w-0 items-center gap-2 text-[11px]">
                    {/* The length notice takes over the hint's slot: at the panel's minimum
                        width there is only room for one of them beside the buttons. */}
                    <span
                        className={cn(
                            'items-center gap-1 whitespace-nowrap text-ink-dim',
                            lengthNotice ? 'hidden' : 'hidden sm:flex',
                        )}
                    >
                        <CornerDownLeft className="h-3 w-3" /> to add
                    </span>
                    {/* Always-mounted live region, like the token confirmations above: the
                        notice only has text near the limit, so it announces as a mutation. */}
                    <span
                        role="status"
                        aria-live="polite"
                        className={cn('truncate', remaining < 0 ? 'text-rose-300' : 'text-ink-dim')}
                    >
                        {lengthNotice}
                    </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
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
