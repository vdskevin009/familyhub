const CACHE = "familyhub-v2-shell-10";
const SHELL = ["./", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

// Push payloads contain an opaque ID only. Never display remotely supplied title/body/URLs.
self.addEventListener("push", event => {
  let eventId = "";
  try { const value = event.data?.json(); if (/^[a-f0-9]{64}$/.test(value?.eventId)) eventId = value.eventId; } catch { /* Generic center link remains available. */ }
  event.waitUntil(self.registration.showNotification("FamilyHub", {
    body: "Une mise à jour est disponible", icon: "./icon-192.png", badge: "./icon-192.png",
    tag: eventId || "familyhub-update", data: { eventId },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const value = event.notification.data?.eventId;
  const url = new URL("./?view=notifications", self.registration.scope);
  if (/^[a-f0-9]{64}$/.test(value)) url.searchParams.set("notice", value);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { const navigated = await existing.navigate(url.href); if (navigated) return navigated.focus(); }
    return self.clients.openWindow(url.href);
  })());
});

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok) throw new Error(`Unable to cache ${path}`);
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("familyhub-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put("./", response.clone()));
          return response;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
