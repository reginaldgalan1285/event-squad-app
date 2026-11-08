// Saves the offline tournament app on the device so it opens with no signal.
// Scope is limited to this folder (/offline/), so it never touches the main
// Event Squad app.
const CACHE = "event-squad-offline-v1";
const CORE = [
  "./", "./index.html", "./manifest.json",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("event-squad-offline-") && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Opening the app (including links Facebook decorates with ?fbclid=...):
  // show the saved copy instantly, and quietly fetch a fresh one for next time.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match("./index.html");
      // Always fetch the canonical page and bypass the browser's own HTTP
      // cache, so updates show up promptly no matter how the host caches.
      const refresh = fetch("./index.html", { cache: "no-cache" })
        .then((res) => { if (res && res.ok) cache.put("./index.html", res.clone()); return res; })
        .catch(() => null);
      if (saved) { event.waitUntil(refresh); return saved; }
      return (await refresh) || new Response(
        "You're offline and the app hasn't been saved on this device yet. Open it once with internet, then it will work without signal.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    })());
    return;
  }

  // Icons, manifest, etc.: saved copy first, network as a fallback.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
    )
  );
});
