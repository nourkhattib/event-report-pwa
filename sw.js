/* =========================================
   sw.js - Service Worker (Offline-First)
   App Shell precache + runtime caching
   ========================================= */

const VERSION = "v1.0.0";
const APP_SHELL_CACHE = `app-shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// עדכן את הרשימה הזו כשאתה מוסיף קבצים חדשים "קריטיים"
const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./report.html",
  "./admin.html",
  "./admin-dashboard.html",

  "./css/style.css",

  "./js/supabase.js",
  "./js/auth-user.js",
  "./js/auth-admin.js",
  "./js/admin.js",
  "./js/offline.js",
  "./js/report.js",

  "./manifest.json",
];

// ---------- Install: cache app shell ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.addAll(APP_SHELL_FILES.map((p) => new Request(p, { cache: "reload" })));
      self.skipWaiting();
    })()
  );
});

// ---------- Activate: clean old caches ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

// Helpers
function isHTML(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

function isAppShellAsset(url) {
  // כל מה שבתיקיות css/js או manifest נחשב asset של האפליקציה
  return (
    url.pathname.includes("/css/") ||
    url.pathname.includes("/js/") ||
    url.pathname.endsWith("/manifest.json")
  );
}

function isFontOrImage(request, url) {
  const dest = request.destination;
  if (dest === "image" || dest === "font") return true;

  // גיבוי לפי סיומות
  return (
    /\.(png|jpg|jpeg|webp|svg|gif)$/i.test(url.pathname) ||
    /\.(woff|woff2|ttf|otf)$/i.test(url.pathname)
  );
}

// ---------- Fetch Strategies ----------
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // רק GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // אל תתערב בשיחות ל-Supabase (API/Storage/Auth) — זה Runtime Online
  if (url.hostname.includes("supabase.co")) return;

  // 1) ניווט דפים (HTML): Network-first עם fallback לקאש
  if (isHTML(request)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;

          // fallback: index.html
          const fallback = await caches.match("./index.html");
          return (
            fallback ||
            new Response("אין חיבור. נסה שוב מאוחר יותר.", {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
              status: 200,
            })
          );
        }
      })()
    );
    return;
  }

  // 2) Assets של האפליקציה (CSS/JS/manifest): Cache-first
  if (isAppShellAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        const res = await fetch(request);
        const cache = await caches.open(APP_SHELL_CACHE);
        cache.put(request, res.clone());
        return res;
      })()
    );
    return;
  }

  // 3) פונטים/תמונות: Stale-while-revalidate
  if (isFontOrImage(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);

        const fetchPromise = fetch(request)
          .then((res) => {
            cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })()
    );
    return;
  }

  // 4) כל השאר: Network-first עם fallback לקאש אם קיים
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, res.clone());
        return res;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })()
  );
});
