/* sw.js — 항상 최신 버전 보장.
   같은 출처(앱 파일)는 HTTP 캐시까지 무시(no-store)하고 서버에서 직접 받는다.
   → 그냥 새로고침만 해도 즉시 최신이 뜬다(캐시 묵힘 없음). 활성화 시 과거 캐시 전부 제거.
   외부(카카오/CDN)는 건드리지 않음. fetch 핸들러 존재로 PWA 설치성 유지. */
const SW_VERSION = "v11-photon-osm";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 외부 리소스(카카오 지도/검색, jsPDF 등)는 브라우저 기본 처리
  if (url.origin !== self.location.origin) return;
  // 같은 출처 앱 파일: HTTP 캐시 무시하고 항상 서버 최신을 받는다
  e.respondWith(
    fetch(req, { cache: "no-store" }).catch(() =>
      fetch(req).catch(() => new Response("", { status: 504 }))
    )
  );
});
