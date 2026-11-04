/* Offline copy of the viewer for the hosted site (GitHub Pages) or localhost.
 * Network first, so an online visitor always gets the current files; what was opened is kept in a
 * cache and served when the network fails. Only same-origin files are kept: NASA POWER on AWS,
 * GIBS and EOX imagery and the Earth Engine service are never cached here. The ZIP / file:// copy
 * of the viewer does not use this file. */
const CACHE = "trend-detective-v1";
const SHELL = ["index.html", "css/app.css", "js/stats.js", "js/i18n.js", "js/surface.js", "js/basemap.js", "js/vendor/fzstd.js", "js/zarr.js",
  "js/live.js", "js/season.js", "js/fire-map.js", "js/dust-map.js", "js/risk-maps.js", "js/qr.js", "js/cases.js", "js/app.js",
  "data/index.js", "data/geo.js", "data/places.js", "data/validation.js", "data/mn-t2m.js", "data/synthetic-truth.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((f) => c.add(f)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // same-origin GETs only; the Earth Engine / MODIS services (../api/...) are live answers, never a copy
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(e.request);
      if (fresh.ok) cache.put(e.request, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
