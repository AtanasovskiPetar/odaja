// The website's service worker (only the website registers it; see
// src/main.tsx). It keeps a copy of every file of the app, so Odaja opens
// and works offline after the first visit. Files are listed at build time
// (scripts/webBuild.ts fills in VERSION and FILES).
const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = `odaja-${VERSION}`;
// Older copies kept, so a page opened before an update can still load the
// parts it hasn't loaded yet.
const KEEP = 2;

self.addEventListener("install", (event) => {
  const scope = self.registration.scope;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new URL(f, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const older = (await caches.keys()).filter((k) => k.startsWith("odaja-") && k !== CACHE);
      for (const old of older.slice(0, Math.max(0, older.length - (KEEP - 1)))) await caches.delete(old);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === "navigate") {
    // The page itself: the newest from the network, the kept copy offline.
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? (await (await caches.open(CACHE)).match(self.registration.scope))),
    );
    return;
  }
  // Everything else is named by its content (or rarely changes): kept copy
  // first, this version's before older ones.
  event.respondWith(
    (async () => (await (await caches.open(CACHE)).match(request)) ?? (await caches.match(request)) ?? fetch(request))(),
  );
});
