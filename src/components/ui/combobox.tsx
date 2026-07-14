'use client';

import { cn } from '@/lib/utils';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

export type ComboboxItem = {
    id: string;
    label: string;
    /** Extra text folded into the search haystack (category, tags, artist…). */
    keywords?: string;
    /** Optional heading rendered above the item when it differs from the previous
     *  item's group — pass items already clustered by group. */
    group?: string;
    icon?: ReactNode;
};

function matches(item: ComboboxItem, tokens: string[]): boolean {
    if (tokens.length === 0) return true;
    const haystack = `${item.label} ${item.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
}

/**
 * Searchable dropdown built on Popover, not DropdownMenu: a menu's typeahead
 * and roving focus fight an embedded text input, a popover leaves both alone.
 * Keyboard model mirrors the command palette (↑↓ to move, ↵ to pick).
 */
export function Combobox({
    items,
    onSelect,
    trigger,
    placeholder = 'Search…',
    emptyText = 'No matches',
    ariaLabel = 'Search',
    align = 'center',
    side = 'bottom',
    avoidCollisions = true,
    contentClassName,
}: {
    items: ComboboxItem[];
    onSelect: (id: string) => void;
    trigger: ReactNode;
    placeholder?: string;
    emptyText?: string;
    ariaLabel?: string;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'right' | 'bottom' | 'left';
    avoidCollisions?: boolean;
    contentClassName?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const filtered = useMemo(() => {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        return items.filter((item) => matches(item, tokens));
    }, [items, query]);

    const clampedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    const activeItem = filtered[clampedIndex];
    const itemGroups = useMemo(() => {
        const groups: { label?: string; items: { item: ComboboxItem; index: number }[] }[] = [];
        filtered.forEach((item, index) => {
            const previous = groups.at(-1);
            if (!previous || previous.label !== item.group) {
                groups.push({ label: item.group, items: [{ item, index }] });
            } else {
                previous.items.push({ item, index });
            }
        });
        return groups;
    }, [filtered]);

    useEffect(() => {
        if (!open || !activeItem) return;
        listRef.current?.querySelector(`[data-item-id="${CSS.escape(activeItem.id)}"]`)?.scrollIntoView({
            block: 'nearest',
        });
    }, [open, activeItem]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setQuery('');
            setActiveIndex(0);
        }
    };

    const choose = (id: string) => {
        onSelect(id);
        handleOpenChange(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(filtered.length ? (clampedIndex + 1) % filtered.length : 0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(filtered.length ? (clampedIndex - 1 + filtered.length) % filtered.length : 0);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeItem) choose(activeItem.id);
        }
    };

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
            <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    align={align}
                    side={side}
                    sideOffset={6}
                    avoidCollisions={avoidCollisions}
                    collisionPadding={8}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        inputRef.current?.focus();
                    }}
                    className={cn(
                        // flex-col-reverse when opening upward keeps the search field pinned
                        // against the trigger, so filtering grows/shrinks the list, not its position.
                        'group data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 flex w-52 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/90 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-md duration-150 data-[side=top]:flex-col-reverse motion-reduce:animate-none',
                        contentClassName,
                    )}
                >
                    <div className="flex items-center gap-2 border-b border-white/8 px-2.5 py-2 group-data-[side=top]:border-t group-data-[side=top]:border-b-0">
                        <Search size={13} className="text-ink-dim shrink-0" aria-hidden />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setActiveIndex(0);
                            }}
                            onKeyDown={handleKeyDown}
                            role="combobox"
                            aria-expanded="true"
                            aria-controls={listId}
                            aria-activedescendant={activeItem ? `${listId}-item-${activeItem.id}` : undefined}
                            aria-label={ariaLabel}
                            placeholder={placeholder}
                            autoComplete="off"
                            spellCheck={false}
                            className="text-ink placeholder:text-ink-dim min-w-0 flex-1 bg-transparent text-xs outline-none"
                        />
                    </div>
                    <div
                        ref={listRef}
                        id={listId}
                        role="listbox"
                        aria-label={ariaLabel}
                        className="scrollbar-custom max-h-56 overflow-y-auto p-1"
                    >
                        {filtered.length === 0 ? (
                            <p className="text-ink-dim px-2.5 py-4 text-center text-xs">{emptyText}</p>
                        ) : (
                            itemGroups.map((group, groupIndex) => {
                                const headingId = `${listId}-group-${groupIndex}`;
                                return (
                                    <div
                                        key={`${group.label ?? 'ungrouped'}:${group.items[0]?.item.id}`}
                                        role={group.label ? 'group' : undefined}
                                        aria-labelledby={group.label ? headingId : undefined}
                                    >
                                        {group.label && (
                                            <p
                                                id={headingId}
                                                className="text-ink-dim px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase"
                                            >
                                                {group.label}
                                            </p>
                                        )}
                                        {group.items.map(({ item, index }) => {
                                            const active = index === clampedIndex;
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    id={`${listId}-item-${item.id}`}
                                                    data-item-id={item.id}
                                                    role="option"
                                                    aria-selected={active}
                                                    onClick={() => choose(item.id)}
                                                    onPointerMove={() => setActiveIndex(index)}
                                                    className={cn(
                                                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                                                        active ? 'text-ink bg-white/8' : 'text-ink-mid',
                                                    )}
                                                >
                                                    {item.icon && (
                                                        <span
                                                            className={cn(
                                                                'shrink-0',
                                                                active ? 'text-ember' : 'text-ink-dim',
                                                            )}
                                                            aria-hidden
                                                        >
                                                            {item.icon}
                                                        </span>
                                                    )}
                                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
