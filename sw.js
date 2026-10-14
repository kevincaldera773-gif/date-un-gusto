/* Date un Gusto: Service Worker básico para push.
   IMPORTANTE: NO sustituir un sw.js anterior sin integrarlo: podría
   contener lógica de caché/offline que este archivo no incluye. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'DUG_PUSH_PING') {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({type:'DUG_PUSH_READY'});
  }
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = {body: event.data ? event.data.text() : ''}; }
  const payload = data.notification || data;
  const title = String(payload.title || data.title || 'Date un Gusto');
  const body = String(payload.body || data.body || 'Tienes una notificación nueva');
  const url = String(payload.url || data.url || './');
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: './dug-icon-192.png',
      badge: './dug-icon-192.png',
      tag: payload.tag || data.tag || undefined,
      data: {url, screen: payload.screen || data.screen || 'orders'}
    });
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of clients) client.postMessage({type:'DUG_PUSH_RECEIVED',payload:data});
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || './', self.registration.scope);
    if (url.origin !== self.location.origin) url.href = self.registration.scope;
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of clients) {
      if (new URL(client.url).origin === url.origin) {
        await client.focus();
        client.postMessage({type:'DUG_PUSH_OPEN',screen:event.notification.data?.screen || 'orders'});
        return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
