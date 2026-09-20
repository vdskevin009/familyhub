// Transitional service worker for users upgrading from the original Blazor PWA.
// The old app explicitly checks this exact URL on every startup.
// Installing this worker releases the old offline cache so the next reload
// reaches the React/Vite app. The React app then registers /familyhub/sw.js.

const OLD_CACHE_PREFIX = "familyhub-offline-";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(OLD_CACHE_PREFIX))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// Intentionally no fetch handler.
// While this transition worker controls the scope, requests go to the network
// instead of the obsolete Blazor offline cache.
