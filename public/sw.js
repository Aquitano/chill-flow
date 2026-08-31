// Minimal service worker. It exists so timer notifications can be shown through
// ServiceWorkerRegistration.showNotification — the only path Chrome for Android allows
// (new Notification() throws "Illegal constructor" there). No caching, no fetch
// interception; pages load exactly as without it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Tapping the notification returns to the workspace instead of doing nothing.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            const workspace = clientList.find((client) => new URL(client.url).pathname.startsWith('/app'));
            return workspace ? workspace.focus() : self.clients.openWindow('/app');
        }),
    );
});
