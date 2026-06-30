/* sw.js — 앱 셸 오프라인 캐시 (지도 타일은 네트워크 필요) */
const CACHE = "yeogiyeogi-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/db.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 일부 리소스 실패해도 설치는 진행
      Promise.allSettled(ASSETS.map((u) => c.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 지도 타일·지오코딩 API: 네트워크 우선 (캐시하지 않음)
  if (
    url.hostname.includes("basemaps.cartocdn.com") ||
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("photon.komoot.io") ||
    url.hostname.includes("nominatim.openstreetmap.org")
  ) {
    return; // 브라우저 기본 처리
  }

  // 그 외: 캐시 우선, 없으면 네트워크 후 캐시
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached)
    )
  );
});
