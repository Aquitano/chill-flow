import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

it('waits for an active worker before showing the first notification', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const activation = Promise.withResolvers<{ showNotification: typeof showNotification }>();
    const register = vi.fn().mockResolvedValue({ active: null, showNotification });

    vi.stubGlobal('navigator', { serviceWorker: { register, ready: activation.promise } });
    vi.stubGlobal('Notification', { permission: 'granted' });

    const { showTimerNotification } = await import('@/lib/notifications');
    showTimerNotification('Focus complete', 'Take a break.');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(showNotification).not.toHaveBeenCalled();

    activation.resolve({ showNotification });

    await vi.waitFor(() =>
        expect(showNotification).toHaveBeenCalledExactlyOnceWith('Focus complete', {
            body: 'Take a break.',
            icon: '/favicon.ico',
            tag: 'chillflow-timer',
        }),
    );
});
