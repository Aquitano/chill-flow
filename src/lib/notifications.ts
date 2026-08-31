'use client';

/**
 * Minimal browser-notification helper for timer events (focus completion and Pomodoro
 * phase changes). Everything degrades quietly: if the Notification API is unavailable
 * or permission isn't granted, calls become no-ops instead of throwing. Permission is
 * only ever requested from an explicit user gesture (settings toggle or starting a
 * timer), never automatically on load.
 *
 * iOS Safari exposes the Notification API only inside a web app installed to the Home
 * Screen (which the manifest in app/manifest.ts enables); in a plain tab it reports
 * 'unsupported' here and the settings toggle explains that.
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

let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Chrome for Android forbids `new Notification()` (it throws "Illegal constructor");
 * notifications there must go through ServiceWorkerRegistration.showNotification. The
 * worker (public/sw.js) does nothing else — no caching, no fetch handling — and is
 * registered lazily the first time a notification is actually shown.
 */
function notificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return Promise.resolve(null);
    }
    serviceWorkerRegistration ??= navigator.serviceWorker.register('/sw.js').catch(() => null);
    return serviceWorkerRegistration;
}

function constructNotification(title: string, options: NotificationOptions): void {
    try {
        new Notification(title, options);
    } catch {
        // No construction path in this browser; there is nothing further to fall back to.
    }
}

/**
 * Fire-and-forget: the notification is shown through the service worker registration
 * where possible (required on Android, harmless elsewhere), falling back to the bare
 * constructor. Permission alone is not consent to interrupt, so callers are still
 * responsible for honoring `showNotifications`.
 */
export function showTimerNotification(title: string, body: string): void {
    if (!isSupported() || Notification.permission !== 'granted') {
        return;
    }

    // A shared tag means a newer timer event replaces the previous one rather than
    // stacking notifications.
    const options: NotificationOptions = { body, icon: '/favicon.ico', tag: 'chillflow-timer' };
    void notificationServiceWorker().then((registration) => {
        if (!registration) {
            constructNotification(title, options);
            return;
        }
        return registration.showNotification(title, options).catch(() => constructNotification(title, options));
    });
}
