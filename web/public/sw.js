// Service worker for Web Push (track H). It only shows notifications and opens the app on click:
// there is no fetch handler, so nothing (pages, API responses) is ever cached or intercepted.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Theo dõi dự án';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      // A newer message with the same tag (same project) replaces the old one and alerts again.
      renotify: !!data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      lang: 'vi',
      data: { url: data.url },
    }),
  );
});

/** Links are opened in this app only: another origin's URL keeps just its path. */
function appUrl(raw) {
  try {
    const u = new URL(raw || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : new URL(u.pathname + u.search + u.hash, self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // Focus the open tab and send it to the link (navigate() needs a controlled client).
        await open.focus();
        if (open.url !== url) await open.navigate(url).catch(() => self.clients.openWindow(url));
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
