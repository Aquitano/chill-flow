'use client';

/**
 * Minimal browser-notification helper for timer events (focus completion and Pomodoro
 * phase changes). Everything degrades quietly: if the Notification API is unavailable
 * or permission isn't granted, calls become no-ops instead of throwing. Permission is
 * only ever requested from an explicit user gesture (settings toggle or starting a
 * timer), never automatically on load.
 */

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermissionState {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission !== 'default') {
        return Notification.permission;
    }
    try {
        return await Notification.requestPermission();
    } catch {
        return 'denied';
    }
}

/**
 * Returns whether a notification was actually shown. Permission alone is not consent to
 * interrupt, so callers are still responsible for honoring `showNotifications`.
 */
export function showTimerNotification(title: string, body: string): boolean {
    if (!isSupported() || Notification.permission !== 'granted') {
        return false;
    }
    try {
        // A shared tag means a newer timer event replaces the previous one rather than
        // stacking notifications.
        new Notification(title, { body, icon: '/favicon.ico', tag: 'chillflow-timer' });
        return true;
    } catch {
        return false;
    }
}
