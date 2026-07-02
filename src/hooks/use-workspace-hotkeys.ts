'use client';

import { useAppStore } from '@/store/app-store';
import { useEffect } from 'react';

/**
 * Workspace keyboard shortcuts:
 *   Ctrl/Cmd+K — command palette
 *   Space — play/pause music
 *   S     — start/pause the timer
 *   T     — toggle the tasks panel
 *   L     — toggle the library panel
 *   A     — toggle the ambience mixer
 *   M     — toggle the workspace menu
 *   Esc   — close open panels
 *
 * Skipped while typing (inputs, textareas, contenteditable) or inside any
 * dialog/menu/dock panel, and when a modifier is held (except the palette
 * chord), so shortcuts never eat real input.
 */
export function useWorkspaceHotkeys() {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const store = useAppStore.getState();

            // The palette chord works everywhere, including while typing — that's
            // the whole point of a command palette.
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                store.toggleOverlay('palette');
                return;
            }

            if (event.metaKey || event.ctrlKey || event.altKey) return;

            // event.target can be window/document (not an Element) for synthetic events.
            const target = event.target instanceof Element ? event.target : null;
            const inTypingContext = target?.closest('input, textarea, select, [contenteditable="true"]');
            // Radix menus/popovers own their Escape; the workspace drawer (role=dialog)
            // and the dock panels do not — Escape must close them even while focus sits
            // inside.
            const inOwnOverlay = target?.closest('[role="menu"]');

            if (event.key === 'Escape') {
                if (inTypingContext || inOwnOverlay) return;
                if (store.activeOverlay) store.setOverlay(null);
                else if (store.isMenuOpen) store.setMenuOpen(false);
                else if (store.isTasksOpen) store.setTasksOpen(false);
                return;
            }

            if (
                inTypingContext ||
                inOwnOverlay ||
                target?.closest('[role="dialog"], [role="listbox"], [data-workspace-panel]')
            ) {
                return;
            }

            switch (event.key) {
                case ' ':
                    event.preventDefault();
                    store.togglePlay();
                    break;
                case 's':
                case 'S':
                    // No hidden countdowns: only in modes where the dial is on screen.
                    if (!store.modes[store.currentMode]?.showTimer) break;
                    // The session lifecycle reacts to the timerActive transition, so
                    // toggling through the store records/pauses sessions correctly.
                    if (store.timerActive) {
                        store.pauseTimer();
                    } else {
                        store.startTimer();
                    }
                    break;
                case 't':
                case 'T':
                    store.toggleTasks();
                    break;
                case 'l':
                case 'L':
                    store.toggleOverlay('library');
                    break;
                case 'a':
                case 'A':
                    store.toggleOverlay('ambience');
                    break;
                case 'm':
                case 'M':
                    store.toggleMenu();
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}
