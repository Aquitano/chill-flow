import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getAmbientMixer } from '@/lib/audio/ambient';
import type { SavedPreset } from '@/models/app';
import { useAppStore } from '@/store/app-store';

const { savePreset, updatePreset } = vi.hoisted(() => ({
    savePreset: vi.fn(),
    updatePreset: vi.fn(),
}));

const quietScene: SavedPreset = {
    id: 'quiet',
    name: 'Quiet',
    trackId: null,
    backgroundId: null,
    mode: 'DeepWork',
    ambientLevels: {},
    timerMode: null,
    timerPreset: null,
    customMinutes: null,
    pomodoroSettings: null,
};

vi.mock('@/hooks/use-app-data', () => ({
    usePresetsQuery: () => ({ data: [quietScene] }),
    useSavePresetMutation: () => ({ mutate: savePreset, isPending: false }),
    useUpdatePresetMutation: () => ({ mutate: updatePreset }),
    useDeletePresetMutation: () => ({ mutate: vi.fn() }),
}));

import { WorkspacePresets } from '@/components/app/WorkspacePresets';

const initialStoreState = useAppStore.getState();

afterEach(() => {
    cleanup();
    getAmbientMixer().setPowered(false);
    getAmbientMixer().setSounds([]);
    useAppStore.setState(initialStoreState, true);
    vi.clearAllMocks();
});

it('clears an empty scene before saving or overwriting its ambient levels', () => {
    const mixer = getAmbientMixer();
    mixer.setSounds([{ id: 'rain', label: 'Rain', category: 'nature', audioUrl: '/rain.mp3', gainPercent: 100 }]);
    mixer.addSound('rain');

    render(<WorkspacePresets enabled />);
    fireEvent.click(screen.getByRole('button', { name: /^Quiet/ }));

    expect(mixer.currentLevels()).toEqual({});
    expect(mixer.isPowered()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite Quiet with the current setup' }));
    expect(updatePreset).toHaveBeenCalledWith(expect.objectContaining({ ambientLevels: {} }), expect.any(Object));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Quiet copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(savePreset).toHaveBeenCalledWith(expect.objectContaining({ ambientLevels: {} }), expect.any(Object));
});
