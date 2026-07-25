'use client';

import { getAmbientMixer } from '@/lib/audio/ambient';
import { LIKE_LIMIT_TOAST } from '@/lib/likes';
import { useAppStore } from '@/store/app-store';
import { useEffect } from 'react';
import { toast } from 'sonner';

const VOLUME_STEP = 5;

/**
 * Controls that Space and Enter activate on their own. A workspace shortcut must never
 * race the control the user is actually pressing — tabbing to "Start timer" and hitting
 * Space has to start the timer, not toggle the music.
 */
const ACTIVATABLE_SELECTOR =
    'button, summary, a[href], [role="button"], [role="switch"], [role="tab"], [role="option"], [role="menuitem"], [role="checkbox"]';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

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
 * Skipped while typing (inputs, textareas, contenteditable), inside any
 * dialog/menu/workspace panel, when the focused control already owns the key
 * (Space on a button, arrows in a tablist), and when a modifier is held (except
 * Shift and the palette chord), so shortcuts never eat real input.
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

            // Keys the focused control owns: activation on a button, roving arrows in a
            // tablist. Claiming these would break keyboard operation of the workspace.
            if ((event.key === ' ' || event.key === 'Enter') && target?.closest(ACTIVATABLE_SELECTOR)) {
                return;
            }
            if (ARROW_KEYS.has(event.key) && target?.closest('[role="tablist"]')) {
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
                    if (store.currentTrack && store.toggleTrackLike(store.currentTrack.id) === 'limit-reached') {
                        toast.error(LIKE_LIMIT_TOAST.title, LIKE_LIMIT_TOAST.options);
                    }
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
                    // Every timer intent goes through the store, and the session lifecycle
                    // watches those transitions — so the shortcut records, pauses, and
                    // abandons blocks exactly as the dial's own buttons do.
                    if (event.shiftKey) {
                        store.resetTimer();
                        break;
                    }
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
