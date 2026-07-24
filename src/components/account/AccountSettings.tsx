'use client';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { usePreferencesQuery, useUpdatePreferencesMutation } from '@/hooks/use-app-data';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useNotificationPermission } from '@/hooks/use-notification-permission';
import { playTimerChime } from '@/lib/audio/chime';
import { getNotificationPermission } from '@/lib/notifications';
import { UserPreferences } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { UserButton, useUser } from '@clerk/nextjs';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function SettingRow({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-3 border-t border-white/10 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-md">
                <h3 className="font-medium text-white">{title}</h3>
                <p className="mt-1 text-sm leading-5 text-neutral-400">{description}</p>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

export function AccountSettings() {
    const { user } = useUser();
    const preferencesQuery = usePreferencesQuery();
    const updatePreferences = useUpdatePreferencesMutation();
    const modes = useAppStore((state) => state.modes);
    const { permission, request: requestPermission } = useNotificationPermission();

    const preferences = preferencesQuery.data?.preferences;

    const [volume, setVolume] = useState<number[]>([50]);

    useEffect(() => {
        if (preferences) {
            setVolume([preferences.volume]);
        }
    }, [preferences?.volume]);

    const save = (patch: Partial<UserPreferences>, successMessage: string) => {
        updatePreferences.mutate(patch, {
            onSuccess: () => toast.success(successMessage),
        });
    };

    if (preferencesQuery.isLoading) {
        return (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
                <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
                <div className="mt-6 space-y-4">
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="h-12 w-full animate-pulse rounded bg-white/5" />
                    ))}
                </div>
            </div>
        );
    }

    if (preferencesQuery.isError || !preferences) {
        return (
            <div className="rounded-lg border border-rose-400/20 bg-rose-500/5 p-6 text-sm text-rose-200">
                Couldn’t load your settings. Refresh the page to try again.
            </div>
        );
    }

    const notificationsOn = preferences.showNotifications;

    const handleNotificationsToggle = async (next: boolean) => {
        // Enabling the preference also prompts for browser permission (a user gesture).
        if (next && getNotificationPermission() === 'default') {
            await requestPermission();
        }
        save({ showNotifications: next }, next ? 'Notifications enabled.' : 'Notifications disabled.');
    };

    return (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-4 pb-2">
                <div className="flex items-center gap-3">
                    <UserButton afterSignOutUrl="/" />
                    <div>
                        <h2 className="text-lg font-semibold">{user?.fullName ?? 'Your account'}</h2>
                        <p className="text-sm text-neutral-400">
                            {user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}
                        </p>
                    </div>
                </div>
            </div>

            <SettingRow
                title="Default focus mode"
                description="The mode your workspace opens in. Changing it in the workspace updates this too."
            >
                <div className="flex flex-wrap gap-2">
                    {Object.keys(modes).map((modeKey) => {
                        const active = preferences.defaultMode === modeKey;
                        return (
                            <Button
                                key={modeKey}
                                variant={active ? 'secondary' : 'outline'}
                                size="sm"
                                aria-pressed={active}
                                className={active ? '' : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'}
                                onClick={() => save({ defaultMode: modeKey }, `Default mode set to ${modes[modeKey]?.label ?? modeKey}.`)}
                            >
                                {modes[modeKey]?.label ?? modeKey}
                            </Button>
                        );
                    })}
                </div>
            </SettingRow>

            <SettingRow
                title="Master volume"
                description="The playback volume your workspace restores on every device."
            >
                <div className="flex w-48 items-center gap-3">
                    <Volume2 size={16} className="shrink-0 text-neutral-400" />
                    <Slider
                        value={volume}
                        onValueChange={setVolume}
                        onValueCommit={(next) => save({ volume: next[0] ?? 50 }, 'Volume saved.')}
                        max={100}
                        step={1}
                        aria-label="Master volume"
                        className="cursor-pointer"
                    />
                    <span className="w-9 text-right text-sm tabular-nums text-neutral-300">{volume[0] ?? 50}%</span>
                </div>
            </SettingRow>

            <SettingRow
                title="Timer chime"
                description="Play a soft tone when a focus session finishes or a Pomodoro phase changes — audible even when the tab is in the background."
            >
                <div className="flex items-center gap-2">
                    {preferences.timerSound ? (
                        <Volume2 size={16} className="text-emerald-300" />
                    ) : (
                        <VolumeX size={16} className="text-neutral-400" />
                    )}
                    <ToggleSwitch
                        checked={preferences.timerSound}
                        onChange={(next) => {
                            if (next) playTimerChime('complete');
                            save({ timerSound: next }, next ? 'Timer chime on.' : 'Timer chime off.');
                        }}
                        label="Timer chime"
                    />
                </div>
            </SettingRow>

            <SettingRow
                title="Timer notifications"
                description="Get a browser notification when a focus session finishes or a Pomodoro phase changes."
            >
                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                        {notificationsOn ? (
                            <Bell size={16} className="text-emerald-300" />
                        ) : (
                            <BellOff size={16} className="text-neutral-400" />
                        )}
                        <ToggleSwitch
                            checked={notificationsOn}
                            onChange={handleNotificationsToggle}
                            label="Timer notifications"
                        />
                    </div>
                    {notificationsOn && permission === 'denied' && (
                        <p className="text-xs text-amber-300">Blocked in your browser settings.</p>
                    )}
                    {notificationsOn && permission === 'default' && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                            onClick={async () => requestPermission()}
                        >
                            Enable browser notifications
                        </Button>
                    )}
                    {notificationsOn && permission === 'unsupported' && (
                        <p className="text-xs text-neutral-400">Not supported in this browser.</p>
                    )}
                </div>
            </SettingRow>
        </div>
    );
}
