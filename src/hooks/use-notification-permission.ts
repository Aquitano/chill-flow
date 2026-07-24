'use client';

import {
    NotificationPermissionState,
    getNotificationPermission,
    requestNotificationPermission,
} from '@/lib/notifications';
import { useCallback, useEffect, useState } from 'react';

/**
 * Browser notification permission, tracked wherever the preference is offered. Reading it
 * has to wait for mount (there is no Notification API on the server), and requesting it
 * has to happen inside a user gesture, so both surfaces that expose the toggle share this.
 */
export function useNotificationPermission() {
    const [permission, setPermission] = useState<NotificationPermissionState>('default');

    useEffect(() => {
        setPermission(getNotificationPermission());
    }, []);

    const request = useCallback(async () => {
        const result = await requestNotificationPermission();
        setPermission(result);
        return result;
    }, []);

    return { permission, request };
}
