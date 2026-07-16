'use client';

import { getAmbientMixer } from '@/lib/audio/ambient';
import { useAppStore } from '@/store/app-store';
import { useEffect } from 'react';

const VOLUME_STEP = 5;

/**
 * Workspace keyboard shortcuts:
 *   Ctrl/Cmd+K — command palette
 *   Space — play/pause music
 *   N / P — next / previous track
 *   H     — like/unlike the current track
 *   R     — toggle repeat
 *   ↑ / ↓ — volume up/down
 *   S     — start/pause the timer
 *   ⇧S    — reset the timer
 *   T     — toggle the tasks panel
 *   L     — toggle the library panel
 *   A     — toggle the ambience mixer
 *   ⇧A    — ambience power on/off
 *   M     — toggle the settings dialog
 *   1–4   — switch workspace mode
 *   ?     — open the shortcuts reference
 *   Esc   — close open panels
 *
 * Skipped while typing (inputs, textareas, contenteditable) or inside any
 * dialog/menu/dock panel, and when a modifier is held (except Shift and the
 * palette chord), so shortcuts never eat real input.
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
                target?.closest('[role="dialog"], [role="listbox"], [role="slider"], [data-workspace-panel]')
            ) {
                return;
            }

            const setVolume = (delta: number) => {
                const current = store.volume[0] ?? 50;
                store.setVolume([Math.min(100, Math.max(0, current + delta))]);
            };

            switch (event.key) {
                case ' ':
                    event.preventDefault();
                    store.togglePlay();
                    break;
                case 'n':
                case 'N':
                    store.nextTrack();
                    break;
                case 'p':
                case 'P':
                    store.previousTrack();
                    break;
                case 'h':
                case 'H':
                    if (store.currentTrack) store.toggleTrackLike(store.currentTrack.id);
                    break;
                case 'r':
                case 'R':
                    store.toggleRepeat();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    setVolume(VOLUME_STEP);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    setVolume(-VOLUME_STEP);
                    break;
                case 's':
                case 'S':
                    // No hidden countdowns: only in modes where the dial is on screen.
                    if (!store.modes[store.currentMode]?.showTimer) break;
                    if (event.shiftKey) {
                        store.resetTimer();
                        break;
                    }
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
                case 'A': {
                    if (event.shiftKey) {
                        const mixer = getAmbientMixer();
                        mixer.setPowered(!mixer.isPowered());
                        break;
                    }
                    store.toggleOverlay('ambience');
                    break;
                }
                case 'm':
                case 'M':
                    store.toggleMenu();
                    break;
                case '?':
                    store.openMenuSection('shortcuts');
                    break;
                case '1':
                case '2':
                case '3':
                case '4': {
                    const mode = Object.keys(store.modes)[Number(event.key) - 1];
                    if (mode) store.setMode(mode);
                    break;
                }
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}
