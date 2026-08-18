'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface PanelSize {
    width: number;
    height: number;
}

export interface ResizablePanel {
    enabled: boolean;
    size: PanelSize;
    resizing: boolean;
    onResizeStart: (event: ReactPointerEvent) => void;
}

const STORAGE_KEY = 'chillflow:tasks-panel-size';
const DEFAULT_SIZE: PanelSize = { width: 320, height: 440 };
// Narrower than the default and the composer footer breaks apart; resizing is for
// growing the panel, so the floor sits at the width the layout is designed for.
const MIN_SIZE: PanelSize = { width: 320, height: 220 };
// Below this the panel is a full sheet instead: a 320px pane floating beside a dial on a
// 700px-wide screen leaves neither enough room to be usable.
const DESKTOP_QUERY = '(min-width: 768px)';
const PANEL_TOP = 96; // matches the panel's `top-24` offset (6rem)
const GUTTER = 16; // breathing space against the viewport edge / player bar

/** The panel's left offset (`left-6`) plus a gap, i.e. what the dial must clear. */
export const PANEL_LEFT_RESERVE = 24 + GUTTER;

/**
 * Upper bounds derived from the live layout so the panel can never grow off-screen or
 * slide under the bottom player bar. The bar's height varies (wrapping, streak pill), so
 * we read its actual top rather than hard-coding a reserve.
 */
function maxSize(): PanelSize {
    const playerBar = document.querySelector<HTMLElement>('[data-player-bar]');
    const bottomBoundary = playerBar ? playerBar.getBoundingClientRect().top : window.innerHeight - GUTTER;
    return {
        width: Math.max(MIN_SIZE.width, Math.min(640, window.innerWidth - 48)),
        height: Math.max(MIN_SIZE.height, bottomBoundary - PANEL_TOP - GUTTER),
    };
}

function clampSize(size: PanelSize): PanelSize {
    const max = maxSize();
    return {
        width: Math.min(Math.max(size.width, MIN_SIZE.width), max.width),
        height: Math.min(Math.max(size.height, MIN_SIZE.height), max.height),
    };
}

function readStored(): PanelSize | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PanelSize>;
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
            return { width: parsed.width, height: parsed.height };
        }
    } catch {
        // Ignore malformed/unavailable storage.
    }
    return null;
}

/**
 * Drag-to-resize for the floating tasks panel. Only enabled at the desktop breakpoint
 * (the panel is full-width on mobile); the chosen size is clamped to the viewport and
 * persisted to localStorage so it survives panel toggles and reloads.
 */
export function useResizablePanel(): ResizablePanel {
    const isClient = typeof window !== 'undefined';
    const [enabled, setEnabled] = useState(() => isClient && window.matchMedia(DESKTOP_QUERY).matches);
    const [size, setSize] = useState<PanelSize>(() =>
        isClient ? clampSize(readStored() ?? DEFAULT_SIZE) : DEFAULT_SIZE,
    );
    const [resizing, setResizing] = useState(false);
    const latestRef = useRef(size);

    const applySize = useCallback((next: PanelSize) => {
        latestRef.current = next;
        setSize(next);
    }, []);

    useEffect(() => {
        // Re-clamp once mounted: the lazy initializer runs during render, before the
        // player bar is in the DOM, so a stored size may need correcting against it now.
        applySize(clampSize(latestRef.current));

        const mq = window.matchMedia(DESKTOP_QUERY);
        const onChange = () => setEnabled(mq.matches);
        const onResize = () => applySize(clampSize(latestRef.current));
        mq.addEventListener('change', onChange);
        window.addEventListener('resize', onResize);
        return () => {
            mq.removeEventListener('change', onChange);
            window.removeEventListener('resize', onResize);
        };
    }, [applySize]);

    const onResizeStart = useCallback(
        (event: ReactPointerEvent) => {
            event.preventDefault();
            const origin = { x: event.clientX, y: event.clientY, ...latestRef.current };
            setResizing(true);

            const onMove = (move: globalThis.PointerEvent) => {
                applySize(
                    clampSize({
                        width: origin.width + (move.clientX - origin.x),
                        height: origin.height + (move.clientY - origin.y),
                    }),
                );
            };
            const onEnd = () => {
                setResizing(false);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
                try {
                    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(latestRef.current));
                } catch {
                    // Ignore storage write failures (private mode, quota, etc.).
                }
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
        },
        [applySize],
    );

    return { enabled, size, resizing, onResizeStart };
}
