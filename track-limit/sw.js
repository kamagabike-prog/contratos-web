// Service worker retirado: la app está ahora en /contratos-web/track-instructor/.
// Se desinstala, borra su caché y recarga las pestañas abiertas en la ruta antigua.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('racing-line') || k.startsWith('track-limit') || k.startsWith('track-coach')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate('../track-instructor/'));
  })());
});
