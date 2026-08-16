'use client';

import { cn } from '@/lib/utils';
import { useLayoutEffect, useRef, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';

// The real input and the highlight mirror must share identical text metrics so the
// coloured tokens sit exactly under the typed characters. Any change here goes to both.
const TEXT_LAYOUT = 'px-0 py-1.5 text-base leading-6 font-medium tracking-normal md:text-sm';

export interface HighlightSpan {
    /** Index of the span's first character in `value`. */
    start: number;
    /** Index one past the span's last character. */
    end: number;
    className: string;
}

interface TokenHighlightInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Non-overlapping spans sorted by start, e.g. from `parseTaskInput().tokens`. */
    highlights: HighlightSpan[];
    placeholder?: string;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    inputRef?: RefObject<HTMLInputElement | null>;
    ariaLabel?: string;
}

/**
 * A single-line text input that colours recognized tokens (priority, due date) inline.
 * The visible text is rendered by an aria-hidden mirror behind a transparent-text input,
 * so tokens get a coloured highlight while the input keeps native caret, selection, and
 * IME behaviour. The mirror's scroll is kept in sync so long values stay aligned.
 */
export function TokenHighlightInput({
    value,
    onChange,
    highlights,
    placeholder,
    onKeyDown,
    inputRef,
    ariaLabel,
}: TokenHighlightInputProps) {
    const internalRef = useRef<HTMLInputElement>(null);
    const resolvedRef = inputRef ?? internalRef;
    const mirrorRef = useRef<HTMLDivElement>(null);

    const syncScroll = () => {
        if (mirrorRef.current && resolvedRef.current) {
            mirrorRef.current.scrollLeft = resolvedRef.current.scrollLeft;
        }
    };

    // Programmatic value changes (tokens stripped on submit/select) can move the scroll
    // offset without firing onScroll, so re-sync after every value/highlight change too.
    useLayoutEffect(syncScroll, [value, highlights, resolvedRef]);

    const segments: ReactNode[] = [];
    let cursor = 0;
    highlights.forEach((span, index) => {
        if (span.start > cursor) {
            segments.push(<span key={`plain-${index}`}>{value.slice(cursor, span.start)}</span>);
        }
        segments.push(
            <span key={`token-${index}`} className={cn('rounded-[3px]', span.className)}>
                {value.slice(span.start, span.end)}
            </span>,
        );
        cursor = span.end;
    });
    if (cursor < value.length) {
        segments.push(<span key="tail">{value.slice(cursor)}</span>);
    }

    return (
        <div className="relative w-full">
            <div
                ref={mirrorRef}
                aria-hidden
                className={cn(
                    'text-ink pointer-events-none absolute inset-0 overflow-hidden whitespace-pre',
                    TEXT_LAYOUT,
                )}
            >
                {value.length === 0 ? <span className="text-ink-dim">{placeholder}</span> : segments}
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
                    'caret-ember selection:text-ink relative w-full bg-transparent whitespace-pre text-transparent outline-none selection:bg-white/30 placeholder:text-transparent',
                    TEXT_LAYOUT,
                )}
            />
        </div>
    );
}
