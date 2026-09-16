// Service worker for Peaches & Pelucha.
// Strategy: cache the app shell so it installs and opens instantly / offline.
// (Live data still needs a connection — that's Supabase, never cached.)
const CACHE = "pp-v180";
// Separate, long-lived cache for memory IMAGE media (thumbnails + full photos).
// Survives shell-version bumps; self-evicts oldest entries past the cap so it
// never blows the device quota. Videos are NOT cached here — they stream.
// v2: previous cache held no-cors OPAQUE image responses. iOS pads every opaque
// Cache entry to multiple MB regardless of real size, so a few hundred thumbs
// could blow the PWA storage quota — and once over quota, caches.open() can
// throw and stall image loads. We now (a) request media with CORS so entries are
// non-opaque and counted at true size, (b) only cache non-opaque responses, and
// (c) never let a cache error break a load. Renaming drops the bloated v1.
const MEDIA_CACHE = "pp-media-v2";
const MEDIA_MAX = 300;
// Runtime deps (Preact/htm/supabase-js) load from esm.sh at version-pinned,
// immutable URLs. CacheFirst them in their own long-lived cache so cold starts
// after the first never wait on esm.sh — and the deps work offline too.
const DEPS_CACHE = "pp-deps-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./castle.js",
  "./engine.js",
  "./game.js",
  "./gems.js",
  "./gemgame.js",
  "./gemmap.js",
  "./joinme.js",
  "./push.js",
  "./roulette.js",
  "./home.js",
  "./gratitude.js",
  "./fight.js",
  "./daily.js",
  "./comments.js",
  "./rewards.js",
  "./memories.js",
  "./events.js",
  "./shopping.js",
  "./map.js",
  "./config.js",
  "./manifest.webmanifest",
  "./sounds/hit1.m4a",
  "./sounds/hit2.m4a",
  "./sounds/roll1.m4a",
  "./sounds/roll2.m4a",
  "./sounds/roll3.m4a",
  "./sounds/roll4.m4a",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // keep the current shell + the long-lived media & deps caches; drop stale shells
      Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE && k !== DEPS_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// FIFO trim: keep the media cache under MEDIA_MAX (oldest puts evicted first).
async function trimMedia() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i]);
}

// ---- Push notifications ("Your turn" alerts) ----
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Peaches & Pelucha", {
      body: data.body || "It's your turn! 💗",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "pp-turn",          // collapse repeats into one notification
      data: { url: "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      for (const w of ws) if ("focus" in w) return w.focus();
      return clients.openWindow("./");
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // CacheFirst for runtime deps from esm.sh (immutable, version-pinned URLs).
  if (url.hostname === "esm.sh") {
    e.respondWith((async () => {
      let cache = null, hit = null;
      try { cache = await caches.open(DEPS_CACHE); hit = await cache.match(e.request); } catch {}
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (cache && res && (res.ok || res.type === "opaque")) cache.put(e.request, res.clone()).catch(() => {});
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }

  // CacheFirst for memory IMAGE media (thumbnails + full photos), including
  // cross-origin Supabase Storage. Immutable, content-addressed paths → safe to
  // cache forever; repeat views and offline are instant. Videos fall through to
  // the network (Range streaming; never cached here).
  const isMediaImage =
    /\/storage\/v1\/object\/public\/memories\//.test(url.pathname) &&
    e.request.destination !== "video" &&
    !/\.(mp4|mov|m4v|webm)$/i.test(url.pathname);
  if (isMediaImage) {
    e.respondWith((async () => {
      // The whole cache layer is best-effort: if caches.open/match throws (iOS
      // over-quota or corrupt store), we must still serve the image from the
      // network rather than reject and leave a broken/stalled tile.
      let cache = null, hit = null;
      try { cache = await caches.open(MEDIA_CACHE); hit = await cache.match(e.request); } catch {}
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        // Only cache real (non-opaque) responses — opaque entries are what bloat
        // the quota on iOS. With CORS-enabled <img>, Storage responses are 'cors'.
        if (cache && res && res.ok && res.type !== "opaque") {
          cache.put(e.request, res.clone()).then(trimMedia).catch(() => {});
        }
        return res;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  // Never touch other cross-origin / API traffic — always go to the network.
  if (url.origin !== self.location.origin) return;

  // Network-first for our own files so updates show up; fall back to cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
