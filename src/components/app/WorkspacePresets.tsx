'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    useDeletePresetMutation,
    usePresetsQuery,
    useSavePresetMutation,
    useUpdatePresetMutation,
} from '@/hooks/use-app-data';
import { describeApiError } from '@/lib/api';
import { getAmbientMixer } from '@/lib/audio/ambient';
import { cn } from '@/lib/utils';
import type { SavedPreset } from '@/models/app';
import { OPEN_ENDED_PRESET, useAppStore } from '@/store/app-store';
import { Check, RefreshCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/** Matches the server's name limit, so a save can't fail validation on length. */
const MAX_PRESET_NAME_LENGTH = 40;

export function WorkspacePresets({ enabled }: { enabled: boolean }) {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const tracks = useAppStore((state) => state.tracks);
    const backgrounds = useAppStore((state) => state.backgrounds);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const selectedBackgroundId = useAppStore((state) => state.selectedBackgroundId);
    const timerMode = useAppStore((state) => state.timerMode);
    const selectedPreset = useAppStore((state) => state.selectedPreset);
    const customMinutes = useAppStore((state) => state.customMinutes);
    const pomodoroSettings = useAppStore((state) => state.pomodoroSettings);
    const setMode = useAppStore((state) => state.setMode);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setSelectedBackgroundId = useAppStore((state) => state.setSelectedBackgroundId);
    const applySceneTimer = useAppStore((state) => state.applySceneTimer);

    const presetsQuery = usePresetsQuery(enabled);
    const savePreset = useSavePresetMutation();
    const updatePreset = useUpdatePresetMutation();
    const deletePreset = useDeletePresetMutation();

    const [name, setName] = useState('');

    // The whole scene as it stands: what plays, what surrounds it, and how the timer is
    // set. Ambient levels are read from the mixer at save time — they live outside the
    // store — and an empty board saves as {} so the scene honestly has no ambience.
    const currentSetup = {
        trackId: currentTrack?.id ?? null,
        backgroundId: selectedBackgroundId,
        mode: currentMode,
        ambientLevels: getAmbientMixer().currentLevels(),
        timerMode,
        timerPreset: selectedPreset,
        customMinutes,
        pomodoroSettings: {
            focusMinutes: pomodoroSettings.focusMinutes,
            breakMinutes: pomodoroSettings.breakMinutes,
            longBreakMinutes: pomodoroSettings.longBreakMinutes,
            sessionsBeforeLongBreak: pomodoroSettings.sessionsBeforeLongBreak,
            autoStartBreaks: pomodoroSettings.autoStartBreaks,
            autoStartFocus: pomodoroSettings.autoStartFocus,
        },
    };

    const timerLabel = (preset: SavedPreset) => {
        if (preset.timerMode === 'pomodoro') {
            return `Pomodoro ${preset.pomodoroSettings?.focusMinutes ?? ''}m`.trim();
        }
        if (!preset.timerPreset) return undefined;
        return preset.timerPreset === OPEN_ENDED_PRESET ? 'Open-ended' : `${preset.timerPreset} focus`;
    };

    const describe = (preset: SavedPreset) => {
        const layerCount = preset.ambientLevels ? Object.keys(preset.ambientLevels).length : 0;
        return [
            modes[preset.mode]?.label ?? preset.mode,
            tracks.find((track) => track.id === preset.trackId)?.title,
            backgrounds.find((background) => background.id === preset.backgroundId)?.name,
            timerLabel(preset),
            layerCount > 0 ? `${layerCount} ambient ${layerCount === 1 ? 'layer' : 'layers'}` : undefined,
        ]
            .filter(Boolean)
            .join(' · ');
    };

    // Ambient levels are deliberately left out of the comparison: nudging one slider
    // shouldn't un-check the scene the workspace was built from.
    const isApplied = (preset: SavedPreset) =>
        preset.mode === currentSetup.mode &&
        preset.trackId === currentSetup.trackId &&
        preset.backgroundId === currentSetup.backgroundId &&
        (preset.timerMode === null ||
            (preset.timerMode === timerMode && preset.timerPreset === selectedPreset));

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed) return;

        savePreset.mutate(
            { name: trimmed, ...currentSetup },
            {
                onSuccess: () => setName(''),
                onError: (error) =>
                    toast.error("Couldn't save that preset", { description: describeApiError(error) }),
            },
        );
    };

    // A preset points at ids, so a track or scene deleted since it was saved simply doesn't
    // apply — better than refusing the whole preset over one missing piece. Null scene
    // fields (presets from before scenes) leave ambience and the timer untouched.
    const handleApply = (preset: SavedPreset) => {
        setMode(preset.mode);

        const track = tracks.find((entry) => entry.id === preset.trackId);
        if (track) setCurrentTrack(track);

        if (backgrounds.some((background) => background.id === preset.backgroundId)) {
            setSelectedBackgroundId(preset.backgroundId);
        }

        if (preset.ambientLevels) {
            const mixer = getAmbientMixer();
            if (Object.keys(preset.ambientLevels).length > 0) {
                mixer.applyMix(preset.ambientLevels);
            } else {
                mixer.setPowered(false);
            }
        }

        if (preset.timerMode && preset.timerPreset && preset.customMinutes && preset.pomodoroSettings) {
            const applied = applySceneTimer({
                timerMode: preset.timerMode,
                timerPreset: preset.timerPreset,
                customMinutes: preset.customMinutes,
                pomodoroSettings: preset.pomodoroSettings,
            });
            if (!applied) {
                toast('Kept your timer as it is', {
                    id: 'scene-timer-kept',
                    description: 'A block is in progress — the rest of the scene was applied.',
                });
            }
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-2">
                <label className="flex-1">
                    <span className="text-ink-dim mb-1 block text-xs">Name this setup</span>
                    <Input
                        value={name}
                        maxLength={MAX_PRESET_NAME_LENGTH}
                        placeholder="Rainy deep work"
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSave();
                            }
                        }}
                        className="h-8 bg-white/5"
                    />
                </label>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSave}
                    disabled={!name.trim() || savePreset.isPending}
                >
                    Save
                </Button>
            </div>

            {presetsQuery.isPending && <p className="text-ink-dim text-sm">Loading your presets…</p>}

            {presetsQuery.isError && (
                <p className="text-ink-dim text-sm">Your presets didn&apos;t load. Try reopening this panel.</p>
            )}

            {presetsQuery.data?.length === 0 && (
                <p className="text-ink-dim text-sm">
                    Nothing saved yet. Get the workspace how you like it, then name it above.
                </p>
            )}

            <div className="space-y-1">
                {presetsQuery.data?.map((preset) => {
                    const applied = isApplied(preset);

                    return (
                        <div key={preset.id} className="group flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => handleApply(preset)}
                                aria-pressed={applied}
                                className={cn(
                                    'focus-visible:outline-ember flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2',
                                    applied ? 'bg-white/8' : 'hover:bg-white/5',
                                )}
                            >
                                <Check
                                    size={14}
                                    className={cn('mt-1 shrink-0', applied ? 'text-ember' : 'text-transparent')}
                                    aria-hidden
                                />
                                <span className="min-w-0">
                                    <span className="text-ink block truncate text-sm font-medium">{preset.name}</span>
                                    <span className="text-ink-dim mt-0.5 block truncate text-xs">
                                        {describe(preset)}
                                    </span>
                                </span>
                            </button>

                            <div className="flex shrink-0 items-center gap-1 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                                <button
                                    type="button"
                                    onClick={() =>
                                        updatePreset.mutate(
                                            { id: preset.id, name: preset.name, ...currentSetup },
                                            {
                                                onSuccess: () => toast(`“${preset.name}” now matches this setup`),
                                                onError: (error) =>
                                                    toast.error("Couldn't update that preset", {
                                                        description: describeApiError(error),
                                                    }),
                                            },
                                        )
                                    }
                                    className="text-ink-dim hover:text-ink-mid rounded p-1 transition hover:bg-white/10"
                                    aria-label={`Overwrite ${preset.name} with the current setup`}
                                >
                                    <RefreshCcw className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        deletePreset.mutate(
                                            { id: preset.id },
                                            {
                                                onError: (error) =>
                                                    toast.error("Couldn't delete that preset", {
                                                        description: describeApiError(error),
                                                    }),
                                            },
                                        )
                                    }
                                    className="text-ink-dim rounded p-1 transition hover:bg-white/10 hover:text-rose-300"
                                    aria-label={`Delete ${preset.name}`}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
