'use client';

import type { PriorityToken } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import { useLayoutEffect, useRef, type KeyboardEventHandler, type RefObject } from 'react';

// The real input and the highlight mirror must share identical text metrics so the
// coloured token sits exactly under the typed characters. Any change here goes to both.
const TEXT_LAYOUT = 'px-0 py-1.5 text-base leading-6 font-medium tracking-normal md:text-sm';

interface PriorityHighlightInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Span to highlight, or null when no token is recognized. */
    token: PriorityToken | null;
    /** Highlight classes for the matched token (priority colour). */
    tokenClassName?: string;
    placeholder?: string;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    inputRef?: RefObject<HTMLInputElement | null>;
    ariaLabel?: string;
}

/**
 * A single-line text input that colours a recognized priority token inline. The visible
 * text is rendered by an aria-hidden mirror behind a transparent-text input, so the
 * token gets a coloured highlight while the input keeps native caret, selection, and IME
 * behaviour. The mirror's scroll is kept in sync so long values stay aligned.
 */
export function PriorityHighlightInput({
    value,
    onChange,
    token,
    tokenClassName,
    placeholder,
    onKeyDown,
    inputRef,
    ariaLabel,
}: PriorityHighlightInputProps) {
    const internalRef = useRef<HTMLInputElement>(null);
    const resolvedRef = inputRef ?? internalRef;
    const mirrorRef = useRef<HTMLDivElement>(null);

    const syncScroll = () => {
        if (mirrorRef.current && resolvedRef.current) {
            mirrorRef.current.scrollLeft = resolvedRef.current.scrollLeft;
        }
    };

    // Programmatic value changes (token stripped on submit/select) can move the scroll
    // offset without firing onScroll, so re-sync after every value/token change too.
    useLayoutEffect(syncScroll, [value, token, resolvedRef]);

    const before = token ? value.slice(0, token.start) : value;
    const matched = token ? value.slice(token.start, token.end) : '';
    const after = token ? value.slice(token.end) : '';

    return (
        <div className="relative w-full">
            <div
                ref={mirrorRef}
                aria-hidden
                className={cn(
                    'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-white',
                    TEXT_LAYOUT,
                )}
            >
                {value.length === 0 ? (
                    <span className="text-neutral-500">{placeholder}</span>
                ) : (
                    <>
                        <span>{before}</span>
                        {token && <span className={cn('rounded-[3px]', tokenClassName)}>{matched}</span>}
                        <span>{after}</span>
                    </>
                )}
            </div>
            <input
                ref={resolvedRef}
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onScroll={syncScroll}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                aria-label={ariaLabel}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                    // Text is transparent (the mirror paints the visible glyphs), so give
                    // the selection an explicit colour or selected text would be invisible.
                    'relative w-full bg-transparent whitespace-pre text-transparent caret-white outline-none placeholder:text-transparent selection:bg-white/30 selection:text-white',
                    TEXT_LAYOUT,
                )}
            />
        </div>
    );
}
