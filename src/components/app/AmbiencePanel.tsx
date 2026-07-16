'use client';

import { ambientCategoryIcon } from '@/components/app/ambient-icons';
import { Combobox } from '@/components/ui/combobox';
import { Slider } from '@/components/ui/slider';
import {
    useAmbientMixesQuery,
    useAmbientSoundsQuery,
    useDeleteAmbientMixMutation,
    useSaveAmbientMixMutation,
    useUpdateAmbientMixMutation,
} from '@/hooks/use-app-data';
import { describeApiError } from '@/lib/api';
import {
    BUILTIN_MIXES,
    deleteLocalMix,
    dismissMixImport,
    playableMixes,
    readImportDismissedIds,
    readLocalMixes,
    saveLocalMix,
    updateLocalMix,
} from '@/lib/audio/ambient-presets';
import { AmbientSlot } from '@/lib/audio/ambient';
import { useAmbient } from '@/lib/audio/useAmbient';
import { cn } from '@/lib/utils';
import { AmbientMix, AmbientSound } from '@/models/app';
import { useUser } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { Check, ChevronsUpDown, Plus, Power, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * myNoise-style board: eight slots filled from the sound library, one vertical
 * fader per slot. Presets (curated + the user's own) load a whole board at
 * once; the power switch silences everything without losing the layout.
 */
export function AmbiencePanel() {
    const { mixer, board, sounds, powered } = useAmbient();
    const soundsQuery = useAmbientSoundsQuery();
    const { isSignedIn } = useUser();
    const mixesQuery = useAmbientMixesQuery(Boolean(isSignedIn));
    const saveMix = useSaveAmbientMixMutation();
    const updateMix = useUpdateAmbientMixMutation();
    const deleteMix = useDeleteAmbientMixMutation();

    const [localMixes, setLocalMixes] = useState<AmbientMix[]>(() => readLocalMixes());
    const [activeMixId, setActiveMixId] = useState<string | null>(null);
    // The applied mix stays highlighted after board tweaks; this flags it as edited so
    // the user can tell an unsaved variation from the mix as saved.
    const [mixEdited, setMixEdited] = useState(false);
    const [mixName, setMixName] = useState('');

    // The mixer singleton owns board state; the query only feeds it the library.
    useEffect(() => {
        if (soundsQuery.data) mixer.setSounds(soundsQuery.data);
    }, [mixer, soundsQuery.data]);

    // Signed in with mixes from a signed-out session on this device: offer (once per
    // panel open, and never again for ids the user declined) to move them to the account.
    const importOfferedRef = useRef(false);
    const importLocalMixes = async () => {
        const accountMixes = mixesQuery.data ?? [];
        const takenNames = new Set(accountMixes.map((mix) => mix.name.toLowerCase()));
        const imported: string[] = [];
        let failureMessage: string | null = null;

        for (const mix of readLocalMixes()) {
            if (takenNames.has(mix.name.toLowerCase())) continue;
            try {
                await saveMix.mutateAsync({ name: mix.name, levels: mix.levels });
                takenNames.add(mix.name.toLowerCase());
                imported.push(mix.id);
            } catch (error) {
                // Typically the account mix cap; either way the rest would fail too.
                failureMessage = describeApiError(error);
                break;
            }
        }

        imported.forEach((id) => deleteLocalMix(id));
        const remaining = readLocalMixes();
        setLocalMixes(remaining);
        // Whatever stayed local (name duplicates, cap overflow) shouldn't prompt again.
        dismissMixImport(remaining.map((mix) => mix.id));

        if (failureMessage) {
            toast.error(
                imported.length > 0
                    ? `Imported ${imported.length} of your mixes, then hit a snag`
                    : "Couldn't import your mixes",
                { description: failureMessage },
            );
            return;
        }
        toast.success(
            imported.length === 1 ? 'Imported 1 mix to your account' : `Imported ${imported.length} mixes to your account`,
            remaining.length > 0
                ? { description: `${remaining.length} stayed on this device (a mix with the same name already exists).` }
                : undefined,
        );
    };

    useEffect(() => {
        if (importOfferedRef.current || !isSignedIn || !mixesQuery.data) return;
        const localOnly = readLocalMixes();
        if (localOnly.length === 0) return;
        const dismissed = new Set(readImportDismissedIds());
        if (localOnly.every((mix) => dismissed.has(mix.id))) return;

        importOfferedRef.current = true;
        const count = localOnly.length;
        toast(count === 1 ? 'You have 1 mix saved on this device' : `You have ${count} mixes saved on this device`, {
            id: 'ambient-import',
            description: 'Add them to your account so they follow you everywhere?',
            duration: 10_000,
            action: { label: 'Import', onClick: () => void importLocalMixes() },
            cancel: { label: 'Not now', onClick: () => dismissMixImport(localOnly.map((mix) => mix.id)) },
        });
        // importLocalMixes is deliberately not a dep: it changes identity each render and
        // the offer must fire once per panel open, which importOfferedRef already guards.
    }, [isSignedIn, mixesQuery.data]);

    // Buffer fetch/decode failures surface as engine events, not query errors.
    useEffect(() => {
        const handleError = (event: Event) => {
            const detail = (event as CustomEvent<{ message: string }>).detail;
            toast.error("Couldn't start ambience", { id: 'ambient-error', description: detail.message });
        };
        mixer.addEventListener('error', handleError);
        return () => mixer.removeEventListener('error', handleError);
    }, [mixer]);

    const savedMixes = isSignedIn ? (mixesQuery.data ?? []) : localMixes;
    const presets = [...playableMixes(BUILTIN_MIXES, sounds), ...savedMixes];
    const soundById = new Map(sounds.map((sound) => [sound.id, sound]));
    const onBoard = new Set(board.flatMap((slot) => (slot ? [slot.soundId] : [])));
    const available = sounds.filter((sound) => !onBoard.has(sound.id));

    const applyMix = (mix: AmbientMix) => {
        mixer.applyMix(mix.levels);
        setActiveMixId(mix.id);
        setMixEdited(false);
    };

    // Board edits no longer deselect the applied mix — they mark it edited instead,
    // which unlocks the "Update" path in the footer for the user's own mixes.
    const markBoardEdited = () => {
        if (activeMixId) setMixEdited(true);
    };

    const handleDeleteMix = (mix: AmbientMix) => {
        if (activeMixId === mix.id) {
            setActiveMixId(null);
            setMixEdited(false);
        }

        // Deletion is one mis-click away from "apply", so it always offers an undo
        // (which re-saves the mix under a fresh id) instead of a blocking confirm.
        const undoDelete = () => {
            if (mix.id.startsWith('local-')) {
                saveLocalMix(mix.name, mix.levels);
                setLocalMixes(readLocalMixes());
                return;
            }
            saveMix.mutate(
                { name: mix.name, levels: mix.levels },
                {
                    onError: (error) =>
                        toast.error("Couldn't restore the mix", { description: describeApiError(error) }),
                },
            );
        };
        const offerUndo = () =>
            toast(`Deleted “${mix.name}”`, { action: { label: 'Undo', onClick: undoDelete } });

        if (mix.id.startsWith('local-')) {
            setLocalMixes(deleteLocalMix(mix.id));
            offerUndo();
            return;
        }
        deleteMix.mutate(
            { id: mix.id },
            {
                onSuccess: offerUndo,
                onError: (error) => toast.error("Couldn't delete the mix", { description: describeApiError(error) }),
            },
        );
    };

    const handleSaveMix = () => {
        const name = mixName.trim();
        const levels = mixer.currentLevels();
        if (!name || Object.keys(levels).length === 0) return;

        if (isSignedIn) {
            saveMix.mutate(
                { name, levels },
                {
                    onSuccess: (mix) => {
                        setActiveMixId(mix.id);
                        setMixEdited(false);
                        setMixName('');
                    },
                    onError: (error) => toast.error("Couldn't save the mix", { description: describeApiError(error) }),
                },
            );
            return;
        }

        const mix = saveLocalMix(name, levels);
        if (!mix) {
            toast.error("Couldn't save the mix", { description: 'Local mix storage is full or unavailable.' });
            return;
        }
        setLocalMixes(readLocalMixes());
        setActiveMixId(mix.id);
        setMixEdited(false);
        setMixName('');
    };

    const handleUpdateMix = (mix: AmbientMix) => {
        const levels = mixer.currentLevels();
        if (Object.keys(levels).length === 0) return;

        if (mix.id.startsWith('local-')) {
            const updated = updateLocalMix(mix.id, mix.name, levels);
            if (!updated) {
                toast.error("Couldn't update the mix", { description: 'Local mix storage is unavailable.' });
                return;
            }
            setLocalMixes(readLocalMixes());
            setMixEdited(false);
            return;
        }

        updateMix.mutate(
            { id: mix.id, name: mix.name, levels },
            {
                onSuccess: (updated) => {
                    if (!updated) {
                        toast.error("Couldn't update the mix", {
                            description: 'It may have been deleted on another device.',
                        });
                        return;
                    }
                    setMixEdited(false);
                },
                onError: (error) => toast.error("Couldn't update the mix", { description: describeApiError(error) }),
            },
        );
    };

    const boardHasSound = board.some((slot) => slot && !slot.muted);
    const boardHasLayer = board.some(Boolean);
    const activeMix = presets.find((mix) => mix.id === activeMixId) ?? null;
    // Typing a name always saves a new mix; an empty input on an edited own mix updates it.
    const updateTarget = mixEdited && activeMix && !activeMix.id.startsWith('builtin-') ? activeMix : undefined;
    const updateMode = Boolean(updateTarget) && !mixName.trim();
    const savePending = saveMix.isPending || updateMix.isPending;

    // Up to four category icons so a mix is recognizable without loading it.
    const mixCategoryIcons = (mix: AmbientMix) =>
        [
            ...new Set(
                Object.keys(mix.levels).flatMap((id) => {
                    const sound = soundById.get(id);
                    return sound ? [sound.category] : [];
                }),
            ),
        ]
            .slice(0, 4)
            .map((category) => <AmbientOptionIcon key={category} category={category} size={12} />);

    const presetItems = presets.map((mix) => ({
        id: mix.id,
        label: mix.name,
        group: mix.id.startsWith('builtin-') ? 'Built-in' : 'Your mixes',
        deletable: !mix.id.startsWith('builtin-'),
        hint: mixCategoryIcons(mix),
    }));

    return (
        <motion.section
            id="dock-panel-ambience"
            data-workspace-panel
            aria-label="Ambience mixer"
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mr-4 mb-3 ml-auto w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-black/75 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
            <header className="flex items-center justify-between px-4 pt-3.5">
                <h3 className="text-ink text-sm font-medium">Ambience</h3>
                <button
                    type="button"
                    role="switch"
                    aria-checked={powered}
                    aria-label={powered ? 'Turn ambience off' : 'Turn ambience on'}
                    onClick={() => mixer.setPowered(!powered)}
                    className={cn(
                        'focus-visible:outline-ember flex h-7 w-7 items-center justify-center rounded-full border transition-colors focus-visible:outline-2',
                        powered
                            ? 'border-ember/40 bg-ember/15 text-ember shadow-[0_0_18px_-6px_oklch(0.81_0.1_75/0.5)]'
                            : 'text-ink-dim hover:text-ink-mid border-white/10 bg-white/5 hover:bg-white/10',
                    )}
                >
                    <Power size={13} aria-hidden />
                </button>
            </header>

            {presets.length > 0 && (
                <div className="px-4 pt-3">
                    <Combobox
                        ariaLabel="Preset mixes"
                        placeholder="Search mixes…"
                        emptyText="No mixes match"
                        align="start"
                        selectedId={activeMixId}
                        items={presetItems}
                        onSelect={(id) => {
                            const mix = presets.find((entry) => entry.id === id);
                            if (mix) applyMix(mix);
                        }}
                        onItemDelete={(id) => {
                            const mix = presets.find((entry) => entry.id === id);
                            if (mix) handleDeleteMix(mix);
                        }}
                        contentClassName="w-[var(--radix-popover-trigger-width)]"
                        trigger={
                            <button
                                type="button"
                                aria-label="Choose a preset mix"
                                className="text-ink focus-visible:outline-ember flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs transition-colors hover:bg-white/10 focus-visible:outline-2"
                            >
                                <span className={cn('min-w-0 flex-1 truncate text-left', !activeMix && 'text-ink-mid')}>
                                    {activeMix
                                        ? mixEdited
                                            ? `${activeMix.name} (edited)`
                                            : activeMix.name
                                        : boardHasLayer
                                          ? 'Custom mix'
                                          : 'Choose a mix'}
                                </span>
                                {activeMix && (
                                    <span className="text-ink-dim flex shrink-0 items-center gap-1" aria-hidden>
                                        {mixCategoryIcons(activeMix)}
                                    </span>
                                )}
                                <ChevronsUpDown size={13} className="text-ink-dim shrink-0" aria-hidden />
                            </button>
                        }
                    />
                </div>
            )}

            {soundsQuery.isLoading ? (
                <div className="flex justify-between gap-1 px-4 py-4" aria-hidden>
                    {Array.from({ length: 8 }, (_, index) => (
                        <div key={index} className="flex w-12 flex-col items-center gap-2">
                            <div className="h-8 w-8 animate-pulse rounded-lg bg-white/5" />
                            <div className="h-28 w-1.5 animate-pulse rounded-full bg-white/5" />
                        </div>
                    ))}
                </div>
            ) : sounds.length === 0 ? (
                <p className="text-ink-mid px-4 py-6 text-sm">
                    {soundsQuery.isError
                        ? "The sound library couldn't be loaded. Check your connection and reopen this panel."
                        : 'No ambient sounds are available yet.'}
                </p>
            ) : (
                <ul className="scrollbar-custom flex justify-between gap-1 overflow-x-auto px-4 py-4">
                    {board.map((slot, index) => (
                        <BoardSlot
                            key={slot ? slot.soundId : `empty-${index}`}
                            slot={slot}
                            sound={slot ? (soundById.get(slot.soundId) ?? null) : null}
                            powered={powered}
                            available={available}
                            onAdd={(soundId) => {
                                markBoardEdited();
                                mixer.addSound(soundId);
                            }}
                            onRemove={() => {
                                markBoardEdited();
                                mixer.removeSlot(index);
                            }}
                            onToggleMute={() => {
                                markBoardEdited();
                                // Waking a single layer while the bus is off should make sound.
                                if (!powered && slot?.muted) mixer.setPowered(true);
                                mixer.toggleSlotMute(index);
                            }}
                            onVolume={(volume) => {
                                markBoardEdited();
                                // A fader move expresses "I want to hear this" — wake the
                                // bus and the layer instead of adjusting silence. Read the
                                // mixer directly: drag events can outpace the render cycle,
                                // and a stale closure would double-toggle the mute.
                                if (!mixer.isPowered()) mixer.setPowered(true);
                                if (mixer.getBoard()[index]?.muted) mixer.toggleSlotMute(index);
                                mixer.setSlotVolume(index, volume);
                            }}
                        />
                    ))}
                </ul>
            )}

            {sounds.length > 0 && (
                <form
                    className="flex items-center gap-2 border-t border-white/5 px-4 py-2.5"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (updateMode && updateTarget) {
                            handleUpdateMix(updateTarget);
                        } else {
                            handleSaveMix();
                        }
                    }}
                >
                    <input
                        type="text"
                        name="mix-name"
                        autoComplete="off"
                        value={mixName}
                        onChange={(event) => setMixName(event.target.value)}
                        placeholder={updateMode ? 'Or save as a new mix…' : 'Name this mix'}
                        maxLength={40}
                        disabled={!boardHasSound}
                        aria-label="Mix name"
                        className="text-ink placeholder:text-ink-dim focus-visible:outline-ember min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs focus-visible:outline-2 disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={!boardHasSound || savePending || (!updateMode && !mixName.trim())}
                        className="border-ember/40 bg-ember/15 text-ember hover:bg-ember/25 focus-visible:outline-ember flex max-w-[55%] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40"
                    >
                        <Check size={12} className="shrink-0" aria-hidden />
                        <span className="truncate">
                            {savePending
                                ? updateMode
                                    ? 'Updating…'
                                    : 'Saving…'
                                : updateMode && updateTarget
                                  ? `Update “${updateTarget.name}”`
                                  : 'Save mix'}
                        </span>
                    </button>
                </form>
            )}
        </motion.section>
    );
}

function AmbientOptionIcon({ category, size = 14 }: { category: string; size?: number }) {
    const Icon = ambientCategoryIcon(category);
    return <Icon size={size} aria-hidden />;
}

function categoryLabel(category: string): string {
    return category.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function BoardSlot({
    slot,
    sound,
    powered,
    available,
    onAdd,
    onRemove,
    onToggleMute,
    onVolume,
}: {
    slot: AmbientSlot | null;
    sound: AmbientSound | null;
    powered: boolean;
    available: AmbientSound[];
    onAdd: (soundId: string) => void;
    onRemove: () => void;
    onToggleMute: () => void;
    onVolume: (volume: number) => void;
}) {
    if (!slot || !sound) {
        return (
            <li className="flex w-12 shrink-0 flex-col items-center">
                <Combobox
                    ariaLabel="Add a sound"
                    placeholder="Search sounds…"
                    emptyText="No sounds left"
                    side="top"
                    avoidCollisions={false}
                    items={[...available]
                        .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
                        .map((option) => ({
                            id: option.id,
                            label: option.label,
                            keywords: option.category,
                            group: categoryLabel(option.category),
                            icon: <AmbientOptionIcon category={option.category} />,
                        }))}
                    onSelect={onAdd}
                    trigger={
                        <button
                            type="button"
                            aria-label="Add a sound"
                            disabled={available.length === 0}
                            className="text-ink-dim hover:text-ink-mid focus-visible:outline-ember flex h-[10.5rem] w-9 items-center justify-center rounded-lg border border-dashed border-white/10 transition-colors hover:border-white/25 focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40"
                        >
                            <Plus size={14} aria-hidden />
                        </button>
                    }
                />
            </li>
        );
    }

    const audible = powered && !slot.muted;
    const Icon = ambientCategoryIcon(sound.category);

    return (
        <li className="group relative flex w-12 shrink-0 flex-col items-center gap-2">
            <button
                type="button"
                aria-label={`Remove ${sound.label}`}
                onClick={onRemove}
                className="bg-night-2 text-ink-dim hover:text-ink focus-visible:outline-ember pointer-coarse:opacity-100 absolute -top-1.5 -right-0.5 z-10 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2"
            >
                <X size={11} aria-hidden />
            </button>
            <button
                type="button"
                role="switch"
                aria-checked={!slot.muted}
                aria-label={`${sound.label} layer`}
                onClick={onToggleMute}
                className={cn(
                    'focus-visible:outline-ember flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2',
                    audible
                        ? 'border-ember/40 bg-ember/15 text-ember shadow-[0_0_18px_-6px_oklch(0.81_0.1_75/0.5)]'
                        : 'text-ink-dim hover:text-ink-mid border-white/10 bg-white/5 hover:bg-white/10',
                    slot.loading && 'animate-pulse',
                )}
            >
                <Icon size={14} aria-hidden />
            </button>
            <Slider
                orientation="vertical"
                value={[Math.round(slot.volume * 100)]}
                max={100}
                step={1}
                onValueChange={(next) => onVolume((next[0] ?? 50) / 100)}
                aria-label={`${sound.label} volume`}
                className={cn(
                    'h-28 cursor-pointer data-[orientation=vertical]:min-h-28',
                    audible
                        ? '[&_[data-slot=slider-range]]:bg-ember [&_[data-slot=slider-thumb]]:border-ember'
                        : '[&_[data-slot=slider-range]]:bg-white/20 [&_[data-slot=slider-thumb]]:border-white/25',
                )}
            />
            <span className={cn('max-w-full truncate text-[10px]', audible ? 'text-ink' : 'text-ink-dim')}>
                {sound.label}
            </span>
        </li>
    );
}
