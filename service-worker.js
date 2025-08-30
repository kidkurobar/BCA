const CACHE = "bca-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  // ไอคอน (เพิ่มเองภายหลัง)
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // ข้าม Cross-origin (เช่น CoinGecko) ให้เบราว์เซอร์จัดการปกติ
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // หน้า HTML ใช้ network-first เพื่ออัปเดตไฟล์
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // ไฟล์ static อื่น ๆ ใช้ cache-first
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
