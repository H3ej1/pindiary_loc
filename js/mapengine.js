/* mapengine.js — 지도 엔진 어댑터: 카카오맵(국내) ↔ Leaflet(전세계) 전환.
   app.js는 이 어댑터의 공통 API(setCenter/addPin/openPopup 등)만 호출한다.
   실제 지도 라이브러리 차이는 여기서 흡수한다.
   ★ 북마크 좌표(lat/lng)는 엔진과 무관하게 동일하다. 엔진은 "그리는 도구"일 뿐,
     엔진을 바꿔도 데이터는 변하지 않는다(그래픽만 바뀜). */
(function () {
  "use strict";

  // 카카오 level(작을수록 확대) ↔ Leaflet zoom(클수록 확대) 대략 대응.
  const levelToZoom = (lv) => Math.max(2, Math.min(19, 19 - lv));
  const zoomToLevel = (z) => Math.max(1, Math.min(14, 19 - z));

  // 공용: 모바일 롱프레스(0.5초 꾹) → (lat,lng) 콜백.
  // project(clientX,clientY) → {lat,lng} | null : 화면좌표를 지도좌표로 변환.
  function attachLongPress(container, project, cb) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    container.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) { cancel(); return; }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const ll = project(start.x, start.y);
        if (ll) cb(ll.lat, ll.lng);
      }, 500);
    }, { passive: true });
    container.addEventListener("touchmove", (e) => {
      if (timer && start && e.touches && e.touches[0]) {
        const t = e.touches[0];
        if (Math.abs(t.clientX - start.x) > 12 || Math.abs(t.clientY - start.y) > 12) cancel();
      }
    }, { passive: true });
    container.addEventListener("touchend", cancel, { passive: true });
    container.addEventListener("touchcancel", cancel, { passive: true });
  }

  // ================= 카카오 드라이버 (국내) =================
  function createKakaoDriver(container, opts) {
    const map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(opts.lat, opts.lng),
      level: opts.level || 4,
    });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    let overlays = [], popup = null, temp = null, suppress = false;

    kakao.maps.event.addListener(map, "click", () => {
      if (suppress) return;
      opts.onBgClick && opts.onBgClick();
    });
    kakao.maps.event.addListener(map, "rightclick", (me) =>
      opts.onAddRequest && opts.onAddRequest(me.latLng.getLat(), me.latLng.getLng()));
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    attachLongPress(container, (x, y) => {
      try {
        const rect = container.getBoundingClientRect();
        const pt = new kakao.maps.Point(x - rect.left, y - rect.top);
        const ll = map.getProjection().coordsFromContainerPoint(pt);
        suppress = true; setTimeout(() => (suppress = false), 500);
        return { lat: ll.getLat(), lng: ll.getLng() };
      } catch (_) { return null; }
    }, (lat, lng) => opts.onAddRequest && opts.onAddRequest(lat, lng));

    return {
      engine: "kakao",
      raw: map,
      getView() {
        const c = map.getCenter();
        return { lat: c.getLat(), lng: c.getLng(), level: map.getLevel() };
      },
      setCenter(lat, lng) { map.setCenter(new kakao.maps.LatLng(lat, lng)); },
      setLevel(lv) { map.setLevel(lv); },
      relayout() { const c = map.getCenter(); map.relayout(); map.setCenter(c); },
      fitBounds(points) {
        if (!points || !points.length) return;
        const b = new kakao.maps.LatLngBounds();
        points.forEach((p) => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
        map.setBounds(b);
      },
      clearPins() { overlays.forEach((o) => o.setMap(null)); overlays = []; },
      addPin(lat, lng, el, onClick) {
        const ov = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(lat, lng), content: el,
          xAnchor: 0.5, yAnchor: 1, zIndex: 3, clickable: true,
        });
        ov.setMap(map);
        overlays.push(ov);
        if (onClick) el.addEventListener("click", onClick);
      },
      openPopup(lat, lng, el) {
        this.closePopup();
        popup = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(lat, lng), content: el,
          xAnchor: 0.5, yAnchor: 1, zIndex: 1000, clickable: true,
        });
        popup.setMap(map);
        // 박스 안 스크롤 시 지도가 같이 움직이지 않도록
        el.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
        el.addEventListener("mouseenter", () => map.setZoomable && map.setZoomable(false));
        el.addEventListener("mouseleave", () => map.setZoomable && map.setZoomable(true));
      },
      closePopup() {
        if (popup) { popup.setMap(null); popup = null; }
        if (map.setZoomable) map.setZoomable(true);
      },
      showTempAdd(lat, lng, el) {
        this.clearTempAdd();
        temp = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(lat, lng), content: el,
          xAnchor: 0.5, yAnchor: 1, zIndex: 6, clickable: true,
        });
        temp.setMap(map);
      },
      clearTempAdd() { if (temp) { temp.setMap(null); temp = null; } },
      destroy() {
        this.clearPins(); this.closePopup(); this.clearTempAdd();
        container.innerHTML = "";
      },
    };
  }

  // ================= Leaflet 드라이버 (전세계) =================
  // 바탕 타일: CARTO Voyager (전세계·무료·키 불필요). 부드러운 파스텔로 색 핀이 잘 보인다.
  function createLeafletDriver(container, opts) {
    const map = L.map(container, { zoomControl: true, attributionControl: true })
      .setView([opts.lat, opts.lng], levelToZoom(opts.level || 4));
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map);

    let pins = [], popup = null, temp = null;

    map.on("click", () => opts.onBgClick && opts.onBgClick());
    map.on("contextmenu", (e) => {
      if (e.originalEvent) e.originalEvent.preventDefault();
      opts.onAddRequest && opts.onAddRequest(e.latlng.lat, e.latlng.lng);
    });
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    // 롱프레스 폴백(모바일에서 contextmenu 미발생 브라우저 대비)
    attachLongPress(container, (x, y) => {
      const rect = container.getBoundingClientRect();
      const ll = map.containerPointToLatLng([x - rect.left, y - rect.top]);
      return { lat: ll.lat, lng: ll.lng };
    }, (lat, lng) => opts.onAddRequest && opts.onAddRequest(lat, lng));

    // 좌표 위에 임의 DOM 요소(핀·버튼 등)를 얹는 마커.
    // divIcon은 html 문자열만 받아 이벤트 리스너가 사라지므로, 빈 아이콘을 만든 뒤
    // 실제 요소를 append하여 리스너를 보존한다. CSS(.lf-overlay)로 바닥-중앙 정렬.
    function overlayMarker(lat, lng, el, z) {
      const icon = L.divIcon({ className: "lf-overlay", html: "", iconSize: [0, 0], iconAnchor: [0, 0] });
      const m = L.marker([lat, lng], { icon, interactive: true, zIndexOffset: z || 0 }).addTo(map);
      const node = m.getElement();
      if (node) {
        node.appendChild(el);
        // 핀/버튼 클릭이 지도까지 버블링되어 배경클릭(말풍선 닫기)을 유발하지 않도록 차단.
        L.DomEvent.disableClickPropagation(node);
        L.DomEvent.disableScrollPropagation(node);
      }
      return m;
    }

    return {
      engine: "leaflet",
      raw: map,
      getView() {
        const c = map.getCenter();
        return { lat: c.lat, lng: c.lng, level: zoomToLevel(map.getZoom()) };
      },
      setCenter(lat, lng) { map.panTo([lat, lng]); },
      setLevel(lv) { map.setZoom(levelToZoom(lv)); },
      relayout() { map.invalidateSize(); },
      fitBounds(points) {
        if (!points || !points.length) return;
        if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 15); return; }
        map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40] });
      },
      clearPins() { pins.forEach((m) => map.removeLayer(m)); pins = []; },
      addPin(lat, lng, el, onClick) {
        const m = overlayMarker(lat, lng, el, 0);
        pins.push(m);
        if (onClick) el.addEventListener("click", onClick);
      },
      openPopup(lat, lng, el) {
        this.closePopup();
        popup = L.popup({
          closeButton: false, autoClose: false, closeOnClick: false,
          className: "lf-bare-popup", maxWidth: 260, offset: [0, -30],
        }).setLatLng([lat, lng]).setContent(el).openOn(map);
        // 말풍선 내부 클릭/스크롤이 지도로 새어나가 닫히지 않도록 차단.
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
        el.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
      },
      closePopup() { if (popup) { map.closePopup(popup); popup = null; } },
      showTempAdd(lat, lng, el) {
        this.clearTempAdd();
        temp = overlayMarker(lat, lng, el, 1000);
      },
      clearTempAdd() { if (temp) { map.removeLayer(temp); temp = null; } },
      destroy() {
        this.clearPins(); this.closePopup(); this.clearTempAdd();
        map.remove();
        container.innerHTML = "";
      },
    };
  }

  // ================= 공개 팩토리 =================
  window.MapEngine = {
    create(engine, container, opts) {
      return engine === "leaflet"
        ? createLeafletDriver(container, opts)
        : createKakaoDriver(container, opts);
    },
  };
})();
