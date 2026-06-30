/* sw.js — 캐시 묵힘 영구 방지 버전.
   더 이상 앱 파일을 캐시하지 않고, 항상 네트워크에서 최신을 받는다.
   활성화 시 과거에 쌓인 캐시는 전부 제거한다. (PWA 설치성은 유지) */
const SW_VERSION = "v6-nocache";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // 예전 버전이 캐시해 둔 것 전부 삭제 → 옛 화면이 다시 뜨는 문제 제거
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// fetch 핸들러는 두되 가로채지 않음 → 브라우저 기본(항상 네트워크) 처리.
// (캐시를 안 하므로 옛 버전이 묵히지 않는다. 핸들러 존재로 PWA 설치 조건은 충족)
self.addEventListener("fetch", () => {});
