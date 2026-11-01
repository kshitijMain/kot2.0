/*
 * The phone web app's service worker (P9-28): it shows the alerts' notifications the page asks
 * for, and a tapped one opens its table in the running page, or opens the page on it. Nothing is
 * cached: the app talks to the restaurant PC, and an old copy of it must never answer instead.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const table = typeof data.tableSessionId === 'string' ? data.tableSessionId : null;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pages) => {
      const page = pages[0];
      if (page) {
        if (table) page.postMessage({ type: 'rp-open-table', tableSessionId: table });
        return page.focus();
      }
      const start = new URL('./', self.registration.scope);
      if (table) start.searchParams.set('table', table);
      return self.clients.openWindow(start.href);
    }),
  );
});
