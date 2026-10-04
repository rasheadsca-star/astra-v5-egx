// Service Worker: الهيكل من الكاش (يعمل بلا إنترنت)، والبيانات من الشبكة أولاً ثم آخر نسخة محفوظة.
const PREFIX = `egx-${new URL(self.registration.scope).pathname}-`;
const SHELL = PREFIX + "shell-v6", DATA = PREFIX + "data-v2";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && ![SHELL, DATA].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url); if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.includes("/data/") && u.pathname.endsWith(".json")) {                                   // بيانات: شبكة أولاً
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(DATA).then(c => r.ok ? c.put(e.request, cp) : undefined); return r; }).catch(() => caches.match(e.request)));
  } else {                                                                      // هيكل: كاش ثم تحديث صامت
    e.respondWith(caches.match(e.request).then(hit => { const net = fetch(e.request).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => r.ok ? c.put(e.request, cp) : undefined); return r; }).catch(() => hit); return hit || net; }));
  }
});
