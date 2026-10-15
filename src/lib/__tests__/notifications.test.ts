import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
});

it('falls back when activation stalls and retries on the next notification', async () => {
    vi.useFakeTimers();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const activation = Promise.withResolvers<{ showNotification: typeof showNotification }>();
    const register = vi.fn().mockResolvedValue({ active: null, showNotification });
    const constructNotification = vi.fn(class {});

    vi.stubGlobal('navigator', { serviceWorker: { register, ready: activation.promise } });
    vi.stubGlobal('Notification', Object.assign(constructNotification, { permission: 'granted' }));

    const { showTimerNotification } = await import('@/lib/notifications');
    showTimerNotification('Focus complete', 'Take a break.');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(constructNotification).toHaveBeenCalledOnce();
    expect(showNotification).not.toHaveBeenCalled();

    showTimerNotification('Break complete', 'Back to focus.');
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledTimes(2);

    activation.resolve({ showNotification });
    await vi.advanceTimersByTimeAsync(0);

    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Break complete', {
        body: 'Back to focus.',
        icon: '/favicon.ico',
        tag: 'chillflow-timer',
    });
    expect(constructNotification).toHaveBeenCalledOnce();
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
