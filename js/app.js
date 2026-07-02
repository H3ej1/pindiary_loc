/* app.js — 여기여기 장소 다이어리 메인 로직 */
(function () {
  "use strict";

  // ---------- 상태 ----------
  const state = {
    places: [],
    mainMap: null, // 메인 지도 드라이버 (mapengine.js)
    engine: "kakao", // 현재 메인 지도 엔진: "kakao"(국내) | "leaflet"(전세계)
    markers: new Map(), // id -> { places, lat, lng }
    editorMap: null, // 편집기 미니지도 드라이버 (엔진은 메인과 동일)
    editorEngine: null, // 편집기 지도가 현재 만들어진 엔진
    draft: null, // 편집 중인 레코드
    calCursor: null, // 달력 기준 월 (Date)
    selectedDay: null, // 'YYYY-MM-DD'
    catFilter: "all", // 목록 폴더 필터
    dateFilter: "", // 'YYYY-MM-DD' — 특정 하루만 보기(빈 값=전체)
    folders: [], // 사용자 정의 폴더 [{id,name,color}]
  };

  // 첫 실행 시 기본 제공 폴더 (이후 사용자가 이름·색 수정/추가/삭제 가능)
  const DEFAULT_FOLDERS = [
    { id: "food", name: "맛집", color: "#ff6b6b" },
    { id: "cafe", name: "카페", color: "#b07d4f" },
    { id: "travel", name: "여행", color: "#4dabf7" },
    { id: "shopping", name: "쇼핑", color: "#cc5de8" },
    { id: "culture", name: "문화", color: "#f06595" },
    { id: "nature", name: "자연", color: "#51cf66" },
  ];
  // 새 폴더 색 팔레트(사용자 색 선택지)
  const FOLDER_COLORS = [
    "#ff6b6b", "#f06595", "#cc5de8", "#845ef7", "#5c7cfa",
    "#4dabf7", "#22b8cf", "#20c997", "#51cf66", "#94d82d",
    "#fab005", "#ff922b", "#b07d4f", "#868e96",
  ];
  const folderById = (id) => state.folders.find((f) => f.id === id) || null;
  const catById = folderById; // 호환 별칭 (기존 호출부 유지)

  // ---------- 유틸 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () =>
    "p_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function fmtDate(s) {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${y}.${m}.${d}`;
  }

  // ISO 문자열 → "2026.07.01 14:30"
  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function starStr(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }

  // 카카오 검색 키는 배포 도메인(h3ej1.github.io)에서만 동작.
  // 로컬 파일(file://)이나 미등록 주소에서는 검색이 막히므로, 그 상황엔 안내 문구를 다르게 보여준다.
  function searchFailMsg() {
    const onApp = /(^|\.)h3ej1\.github\.io$/i.test(location.hostname);
    return onApp
      ? "검색 실패 (네트워크 확인)."
      : "이 주소에선 검색이 안 돼요. 앱 링크(h3ej1.github.io)에서 검색해 주세요.";
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // 이미지 리사이즈 압축 -> dataURL (저장 용량 절감)
  function fileToCompressedDataURL(file, maxSize = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 붙여넣은 지도 링크에서 좌표 추출 (구글/카카오/네이버/일반 @lat,lng 등)
  function extractCoords(text) {
    if (!text) return null;
    const patterns = [
      /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,                 // 구글 @lat,lng
      /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,            // ?q=lat,lng
      /[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,           // ?ll=lat,lng
      /[?&]lat=(-?\d{1,3}\.\d+)&(?:lng|lon)=(-?\d{1,3}\.\d+)/, // lat=..&lng=..
      /\/map\/[^/]+\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,    // 카카오 link/map
      /(-?\d{1,2}\.\d{4,}),\s*(-?\d{2,3}\.\d{4,})/,          // 일반 lat,lng
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
      }
    }
    return null;
  }

  // ---------- 뷰 전환 ----------
  function switchView(name) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name === "map") {
      renderList(); // 목록이 지도 뷰에 통합됨
      if (state.mainMap) setTimeout(fixMapSize, 60);
      // 서랍은 뷰가 보일 때만 높이 측정 가능 → 탭 복귀 시 재배치
      if (state.listSheet) setTimeout(() => state.listSheet.enable(false), 60);
    }
    if (name === "folders") renderFoldersHome();
    if (name === "calendar") renderCalendar();
    if (name === "backup") renderBackupStat();
  }

  // ---------- 지도 (메인) — 엔진 어댑터(카카오 국내 ↔ Leaflet 전세계) ----------
  // 카카오 level: 숫자가 작을수록 확대(가까움). 3~4 = 거리/건물 보이는 줌.
  // 실제 지도 조작은 state.mainMap 드라이버(mapengine.js)를 통해 이뤄진다.
  // ★ 엔진을 바꿔도 북마크 좌표(lat/lng)는 그대로 — 그래픽(엔진)만 바뀐다.
  // 엔진 전환 시 이전 지도 라이브러리(카카오/Leaflet)가 컨테이너에 남긴 잔재
  // (_leaflet_id·leaflet 클래스·인라인 스타일 등)를 없애기 위해 컨테이너를 깨끗한 새 노드로 교체.
  // 잔재 위에 다른 지도 엔진을 초기화하면 렌더가 깨지므로 매번 새 컨테이너를 쓴다.
  function freshContainer(id) {
    const old = document.getElementById(id);
    const fresh = old.cloneNode(false); // 자식 없이 id/class만 복제 (_leaflet_id 같은 expando는 복제 안 됨)
    fresh.removeAttribute("style"); // 이전 엔진이 남긴 인라인 스타일 제거
    fresh.className = (old.className || "")
      .split(/\s+/).filter((c) => c && !c.startsWith("leaflet")).join(" ");
    old.parentNode.replaceChild(fresh, old);
    return fresh;
  }

  function buildMainMap(view) {
    const container = freshContainer("map");
    state.mainMap = MapEngine.create(state.engine, container, {
      lat: view ? view.lat : 37.5665,
      lng: view ? view.lng : 126.978,
      level: view ? view.level : 4,
      // 좌클릭/탭 → 열린 추가핀·말풍선 닫기
      onBgClick: () => { clearTempMarker(); closeOpenPopup(); },
      // 우클릭(PC)·길게누르기(폰) → 그 위치에 추가 핀
      onAddRequest: (lat, lng) => onMapClickAdd(lat, lng),
    });
  }

  // 첫 진입 시 현재 위치로 이동 시도 (기록이 하나도 없을 때만)
  function tryGeolocateOnce() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (state.places.length === 0 && state.mainMap)
          state.mainMap.setCenter(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { timeout: 5000 }
    );
  }

  // 지도 엔진 전환 (카카오 ↔ Leaflet). 보던 위치/줌 유지, 데이터는 불변.
  function switchMapEngine(engine) {
    if (!state.mainMap || state.engine === engine) return;
    // 대상 엔진이 준비돼 있는지 먼저 확인 — 없으면 현재 지도를 부수지 않고 그대로 유지한다.
    // (카카오 키는 배포 도메인 전용이라 localhost 등에선 카카오가 로드되지 않을 수 있음)
    if (engine === "kakao" && !(window.kakao && kakao.maps && kakao.maps.Map)) {
      toast("국내(카카오) 지도를 불러오지 못했어요. 배포 주소에서 사용해 주세요.");
      return;
    }
    if (engine === "leaflet" && !window.L) {
      toast("전세계 지도를 불러오지 못했어요 (인터넷 확인).");
      return;
    }
    let view = null;
    try { view = state.mainMap.getView(); } catch (_) {}
    try {
      state.mainMap.destroy();
      state.engine = engine;
      state._fitted = true; // 수동 전환 시 자동 범위맞춤 없이 보던 위치 유지
      buildMainMap(view);
      refreshMarkers();
      try { localStorage.setItem("pindiary.mapEngine", engine); } catch (_) {}
    } catch (e) {
      console.error("지도 전환 실패", e);
      toast("지도 전환에 실패했어요");
    }
    updateEngineToggle(); // 버튼 라벨은 항상 현재 엔진에 맞춘다
    setTimeout(fixMapSize, 60);
  }

  // 토글 버튼 라벨: 지금 누르면 "바뀔 대상"을 보여준다.
  function updateEngineToggle() {
    const btn = document.getElementById("map-engine-toggle");
    if (!btn) return;
    btn.textContent = state.engine === "kakao" ? "🌐 전세계" : "🇰🇷 국내";
  }

  // 모바일 등에서 컨테이너 크기 확정이 늦어 지도가 빈칸으로 뜨는 것 방지 (relayout)
  function fixMapSize() {
    if (!state.mainMap) return;
    try { state.mainMap.relayout(); } catch (_) { /* 파괴된 지도 등은 무시 */ }
  }

  // 메인 지도 시작(현재 엔진으로 생성 + 마커 + 위치이동 + 크기보정)
  function startMap() {
    buildMainMap();
    refreshMarkers();
    tryGeolocateOnce();
    [150, 500, 1200].forEach((t) => setTimeout(fixMapSize, t));
  }

  // 지도 부트스트랩: 엔진에 맞춰 가능한 한 빨리 메인 지도를 띄운다.
  // 카카오 SDK가 안 뜨는 환경(미등록 도메인·차단·해외 등)에서도 전세계(Leaflet)로 폴백해
  // 항상 지도가 나오게 한다. (편집기 지도·국내 검색은 카카오가 있을 때만 동작 — Phase 2/3에서 이관 예정)
  function bootstrapMap() {
    const haveKakao = () => window.kakao && kakao.maps && kakao.maps.load;
    // 저장된 엔진이 Leaflet이면 카카오를 기다릴 것 없이 바로 띄운다.
    // 단, 카카오 SDK가 있으면 백그라운드로 load()를 걸어 편집기 지도·국내 검색(kakao.maps.*)을 준비시킨다.
    if (state.engine === "leaflet" && window.L) {
      startMap();
      if (haveKakao()) kakao.maps.load(() => {});
      return;
    }
    if (haveKakao()) { kakao.maps.load(startMap); return; }
    // 카카오가 아직/영영 안 뜨면 잠깐 기다렸다가, 그래도 없으면 Leaflet로 폴백.
    let waited = 0;
    const timer = setInterval(() => {
      if (haveKakao()) { clearInterval(timer); kakao.maps.load(startMap); }
      else if ((waited += 300) >= 2400) {
        clearInterval(timer);
        if (window.L) { state.engine = "leaflet"; updateEngineToggle(); startMap(); }
      }
    }, 300);
  }

  // 같은 위치(≈1m) 북마크 묶기용 키
  const coordKey = (p) => p.lat.toFixed(5) + "," + p.lng.toFixed(5);

  // 한 그룹(같은 위치 북마크들) 말풍선 — 간략 목록, 길면 스크롤
  function groupPopupHtml(places) {
    const items = places.map((p) => {
      const fc = folderById(p.category);
      const dot = fc ? `<span class="pp-dot" style="background:${fc.color}"></span>` : "";
      const rating = p.rating ? `<span class="pp-stars">${starStr(p.rating)}</span>` : "";
      const memo = p.memo ? `<div class="pp-memo">${escapeHtml(p.memo)}</div>` : "";
      return `<div class="popup-item" data-id="${p.id}">
        <div class="pp-top">${dot}<b>${escapeHtml(p.name)}</b> <span class="pp-mood">${p.mood || ""}</span></div>
        <div class="pp-sub">${rating}<span class="pp-date">${fmtDate(p.date)}</span></div>
        ${memo}
      </div>`;
    }).join("");
    const header = places.length > 1 ? `<div class="popup-head">이 위치의 북마크 ${places.length}개</div>` : "";
    return `<div class="popup-list">${header}${items}</div>`;
  }

  function closeOpenPopup() {
    if (state.mainMap) state.mainMap.closePopup();
  }

  // 그룹 말풍선: 핀 위에 떠서 핀에 안 가림 + 흰 박스 안에서 스크롤.
  // 요소만 만들고 실제 배치는 드라이버(state.mainMap.openPopup)가 담당.
  function openGroupPopup(places, lat, lng) {
    closeOpenPopup();
    const wrap = document.createElement("div");
    wrap.className = "map-popup-wrap";
    wrap.innerHTML =
      `<div class="map-popup"><button class="map-popup-close" type="button" aria-label="닫기">✕</button>` +
      groupPopupHtml(places) + `</div>`;
    wrap.querySelector(".map-popup-close").addEventListener("click", () => closeOpenPopup());
    wrap.querySelectorAll(".popup-item").forEach((it) => {
      it.addEventListener("click", () => openViewer(it.dataset.id));
    });
    state.mainMap.openPopup(lat, lng, wrap);
    focusListItem(places[0].id);
  }

  function refreshMarkers() {
    if (!state.mainMap) return;
    state.mainMap.clearPins();
    state.markers.clear();
    closeOpenPopup();

    // 같은 위치 북마크 그룹핑
    const groups = new Map();
    state.places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      if (state.dateFilter && p.date !== state.dateFilter) return; // 특정 하루만
      const k = coordKey(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });

    const points = [];
    groups.forEach((places) => {
      const lat = places[0].lat, lng = places[0].lng;

      // 폴더색 핀 + 이름 라벨 (엔진 무관 — 드라이버가 해당 지도에 얹는다)
      const fc = folderById(places[0].category);
      const color = fc ? fc.color : "#868e96"; // 폴더 없음 = 회색(맛집 빨강과 구분)
      const label = places.length > 1 ? `${places[0].name} +${places.length - 1}` : places[0].name;
      const el = document.createElement("div");
      el.className = "kk-pin-wrap";
      el.innerHTML =
        `<div class="kk-label">${escapeHtml(label)}</div>` +
        `<div class="cat-marker" style="background:${color}"><span class="cat-marker-dot"></span></div>`;
      state.mainMap.addPin(lat, lng, el, () => openGroupPopup(places, lat, lng));

      // 그룹 내 모든 id가 같은 위치/목록을 가리키도록(focus/이동용)
      places.forEach((p) => state.markers.set(p.id, { places, lat, lng }));
      points.push({ lat, lng });
    });

    if (points.length && !state._fitted) {
      state.mainMap.fitBounds(points);
      state._fitted = true;
    }
  }

  // 지도 클릭/길게누르기 → 임시 핀 + "여기에 북마크 추가" 버튼 (버튼만 핀 위에)
  function onMapClickAdd(lat, lng) {
    clearTempMarker();
    const el = document.createElement("div");
    el.className = "kk-add-wrap";
    el.innerHTML =
      `<button class="popup-add-btn" type="button">📍 여기에 북마크 추가</button>` +
      `<div class="cat-marker add-pin"><span class="add-plus">＋</span></div>`;
    el.querySelector(".popup-add-btn").addEventListener("click", () => startAddAt(lat, lng));
    state.mainMap.showTempAdd(lat, lng, el);
  }

  function clearTempMarker() {
    if (state.mainMap) state.mainMap.clearTempAdd();
  }

  // 지정 좌표로 새 북마크 추가 시작
  function startAddAt(lat, lng) {
    clearTempMarker();
    openEditor(null);
    state.draft.lat = lat;
    state.draft.lng = lng;
    reverseGeocode(lat, lng);
  }

  // 검색 결과(이름·주소·좌표)로 바로 북마크 추가 시작
  function startAddAtPlace(name, addr, lat, lng) {
    clearTempMarker();
    if (state.mainMap) { state.mainMap.setCenter(lat, lng); state.mainMap.setLevel(3); }
    openEditor(null);
    state.draft.lat = lat;
    state.draft.lng = lng;
    state.draft.name = name;
    state.draft.address = addr;
    $("#place-name").value = name;
    $("#place-address").value = addr;
  }

  // ---------- 해외 검색·주소 (Photon, 무료·키 불필요) ----------
  // 전세계(Leaflet) 모드에서 카카오(국내 전용) 대신 사용한다.
  async function photonSearch(query) {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=12`);
    if (!res.ok) throw new Error("photon " + res.status);
    const data = await res.json();
    return (data.features || []).map((f) => {
      const c = (f.geometry && f.geometry.coordinates) || null; // [lng, lat]
      const p = f.properties || {};
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      const name = p.name || street || p.city || p.county || "이름 미상";
      const addr = [street, p.district, p.city, p.state, p.country]
        .filter(Boolean).filter((x) => x !== name).join(", ");
      return { name, addr, lat: c ? c[1] : null, lng: c ? c[0] : null };
    }).filter((r) => r.lat != null);
  }

  async function photonReverse(lat, lng) {
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
      if (!res.ok) return "";
      const data = await res.json();
      const p = (data.features && data.features[0] && data.features[0].properties) || {};
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      return [street, p.district, p.city, p.state, p.country].filter(Boolean).join(", ");
    } catch (_) { return ""; }
  }

  // 지도 탭 검색결과 렌더 (엔진 무관 공통 형태 {name,addr,lat,lng})
  function fillMapResults(box, items) {
    if (!items.length) { box.innerHTML = "<li>검색 결과가 없어요.</li>"; return; }
    box.innerHTML = "";
    items.slice(0, 12).forEach((it) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="r-name">${escapeHtml(it.name)}</div><div class="r-addr">${escapeHtml(it.addr)}</div>`;
      li.addEventListener("click", () => {
        box.innerHTML = "";
        $("#map-search-input").value = "";
        startAddAtPlace(it.name, it.addr, it.lat, it.lng);
      });
      box.appendChild(li);
    });
  }

  // 지도 탭 검색창: 장소 검색 → 결과 클릭 시 바로 추가
  // 전세계(Leaflet) 모드 = Photon(해외), 국내(카카오) 모드 = 카카오 Places
  function mapSearch(query) {
    const box = $("#map-search-results");
    if (!box) return;
    box.innerHTML = "<li>검색 중…</li>";
    if (state.engine === "leaflet") {
      photonSearch(query)
        .then((items) => fillMapResults(box, items))
        .catch(() => { box.innerHTML = "<li>검색 실패 (네트워크 확인).</li>"; });
      return;
    }
    if (!(window.kakao && kakao.maps && kakao.maps.services)) { box.innerHTML = "<li>검색 모듈 로드 실패</li>"; return; }
    const ps = new kakao.maps.services.Places();
    // 위치/반경 제한 없이 전국 검색 (먼 장소도 찾도록)
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length) {
        fillMapResults(box, data.map((place) => ({
          name: place.place_name || "이름 미상",
          addr: place.road_address_name || place.address_name || "",
          lat: parseFloat(place.y), lng: parseFloat(place.x),
        })));
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        box.innerHTML = "<li>검색 결과가 없어요.</li>";
      } else {
        box.innerHTML = "<li>" + searchFailMsg() + "</li>";
      }
    }, {});
  }

  // ---------- 목록 ----------
  function renderCatFilter() {
    const box = $("#cat-filter");
    if (!box) return;
    // 실제 사용 중인 폴더만 + 전체
    const used = new Set(state.places.map((p) => p.category).filter(Boolean));
    const chips = [{ id: "all", name: "전체", color: "#495057" }]
      .concat(state.folders.filter((c) => used.has(c.id)));
    box.innerHTML = chips
      .map((c) => {
        const on = state.catFilter === c.id;
        const dot = c.id === "all" ? "🗂️ " : `<span class="chip-dot" style="background:${c.color}"></span>`;
        return `<button data-cat="${c.id}" class="${on ? "on" : ""}"` +
          `${on ? ` style="background:${c.color}"` : ""}>${dot}${escapeHtml(c.name)}</button>`;
      })
      .join("");
    $$("button", box).forEach((b) =>
      b.addEventListener("click", () => {
        state.catFilter = b.dataset.cat;
        renderList();
      })
    );
  }

  function renderList() {
    const q = $("#list-search").value.trim().toLowerCase();
    const sort = $("#list-sort").value;
    let items = state.places.slice();

    renderCatFilter();
    if (state.catFilter !== "all") {
      items = items.filter((p) => p.category === state.catFilter);
    }
    if (state.dateFilter) {
      items = items.filter((p) => p.date === state.dateFilter);
    }

    if (q) {
      items = items.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.memo || "").toLowerCase().includes(q) ||
          (p.address || "").toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => {
      switch (sort) {
        case "date-asc": return (a.date || "").localeCompare(b.date || "");
        case "rating-desc": return (b.rating || 0) - (a.rating || 0);
        case "name-asc": return (a.name || "").localeCompare(b.name || "");
        default: return (b.date || "").localeCompare(a.date || "");
      }
    });

    const cont = $("#list-container");
    cont.innerHTML = items.map(cardHtml).join("");
    const empty = $("#list-empty");
    if (!state.places.length) {
      empty.innerHTML = "아직 기록한 장소가 없어요.<br />오른쪽 위 <b>＋ 장소</b>로 첫 기록을 남겨보세요!";
      empty.style.display = "block";
    } else if (!items.length) {
      empty.innerHTML = "조건에 맞는 기록이 없어요.";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
    }
    bindCards(cont);
  }

  // 카드 클릭(상세) + 인라인 편집/삭제 버튼 바인딩 (목록·달력 공용)
  function bindCards(cont) {
    $$(".place-card", cont).forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener("click", (e) => {
        if (e.target.closest(".card-actions")) return; // 버튼 클릭은 제외
        openViewer(id);
      });
      const mapBtn = el.querySelector(".act-map");
      const editBtn = el.querySelector(".act-edit");
      const delBtn = el.querySelector(".act-del");
      if (mapBtn) mapBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveToOnMap(id);
      });
      if (editBtn) editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = state.places.find((x) => x.id === id);
        if (p) openEditor(p);
      });
      if (delBtn) delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePlace(id);
      });
    });
  }

  // ---------- 폴더(목록) 탭 ----------
  function renderFoldersHome() {
    $("#folders-detail").hidden = true;
    $("#folders-home").hidden = false;
    const home = $("#folders-home");
    const counts = {};
    state.places.forEach((p) => { const k = p.category || "__none__"; counts[k] = (counts[k] || 0) + 1; });
    const cards = state.folders.map((f) =>
      `<div class="folder-card" data-folder="${f.id}">
        <div class="fc-dot" style="background:${f.color}"></div>
        <div class="fc-name">${escapeHtml(f.name)}</div>
        <div class="fc-count">${counts[f.id] || 0}곳</div>
      </div>`
    );
    if (counts["__none__"]) {
      cards.push(`<div class="folder-card" data-folder="__none__">
        <div class="fc-dot" style="background:#adb5bd"></div>
        <div class="fc-name">폴더 없음</div>
        <div class="fc-count">${counts["__none__"]}곳</div>
      </div>`);
    }
    const toolbar = `<div class="folders-toolbar">
      <button id="folders-manage" class="btn-secondary">🗂️ 폴더 관리 (이름·색·추가·삭제)</button>
    </div>`;
    home.innerHTML = toolbar + (cards.join("") || '<p class="empty-state folders-empty">폴더가 없습니다.</p>');
    $("#folders-manage").addEventListener("click", openFolderManager);
    $$(".folder-card", home).forEach((el) =>
      el.addEventListener("click", () => renderFolderList(el.dataset.folder))
    );
  }

  function renderFolderList(folderKey) {
    $("#folders-home").hidden = true;
    $("#folders-detail").hidden = false;
    const isNone = folderKey === "__none__";
    const f = isNone ? null : folderById(folderKey);
    $("#folders-detail-title").textContent = isNone ? "폴더 없음" : (f ? f.name : "폴더");
    const items = state.places
      .filter((p) => (isNone ? !p.category : p.category === folderKey))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const list = $("#folders-list");
    list.innerHTML = items.length ? items.map(cardHtml).join("") : '<p class="empty-state">이 폴더에 기록이 없어요.</p>';
    bindCards(list);
  }

  // 카드의 📍 → 지도 탭으로 이동 후 해당 위치로 이동 + 말풍선 열기
  function moveToOnMap(id) {
    const p = state.places.find((x) => x.id === id);
    if (!p || p.lat == null) { toast("위치 정보가 없어요"); return; }
    switchView("map");
    setTimeout(() => {
      if (!state.mainMap) return;
      state.mainMap.setLevel(3);
      state.mainMap.setCenter(p.lat, p.lng);
      const mk = state.markers.get(id);
      if (mk) openGroupPopup(mk.places, mk.lat, mk.lng);
      focusListItem(id);
    }, 160);
  }

  // 목록/달력에서 바로 삭제
  async function deletePlace(id) {
    const p = state.places.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`'${p.name}' 기록을 삭제할까요?`)) return;
    await PlaceDB.remove(id);
    state.places = state.places.filter((x) => x.id !== id);
    refreshMarkers();
    refreshActiveView();
    toast("삭제했어요");
  }

  function catBadgeHtml(catId) {
    const c = folderById(catId);
    if (!c) return "";
    return `<span class="cat-badge" style="background:${c.color}">${escapeHtml(c.name)}</span>`;
  }

  function cardHtml(p) {
    const fc = folderById(p.category);
    const thumb = p.photo
      ? `<img class="thumb" src="${p.photo}" alt="">`
      : `<div class="thumb" ${fc ? `style="background:${fc.color}1f;color:${fc.color}"` : ""}>📍</div>`;
    const ratingHtml = p.rating ? `<span class="stars-readonly">${starStr(p.rating)}</span>` : "";
    return `<div class="place-card" data-id="${p.id}">
      ${thumb}
      <div class="body">
        <h3>${escapeHtml(p.name)} <span style="font-size:14px">${p.mood || ""}</span></h3>
        <div class="addr">${escapeHtml(p.address || "")}</div>
        <div class="meta">
          ${catBadgeHtml(p.category)}
          ${ratingHtml}
          <span>${fmtDate(p.date)}</span>
        </div>
        ${p.memo ? `<div class="memo">${escapeHtml(p.memo)}</div>` : ""}
      </div>
      <div class="card-actions">
        <button class="act-map" title="지도에서 보기" aria-label="지도에서 보기">📍</button>
        <button class="act-edit" title="편집" aria-label="편집">✏️</button>
        <button class="act-del" title="삭제" aria-label="삭제">🗑️</button>
      </div>
    </div>`;
  }

  // ---------- 달력 ----------
  function renderCalendar() {
    if (!state.calCursor) state.calCursor = new Date();
    const cur = state.calCursor;
    const year = cur.getFullYear();
    const month = cur.getMonth();
    $("#cal-title").textContent = `${year}년 ${month + 1}월`;

    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 날짜별 기록 모음 (날짜순 안정 정렬)
    const byDate = {};
    state.places.forEach((p) => {
      if (!p.date) return;
      (byDate[p.date] = byDate[p.date] || []).push(p);
    });

    const grid = $("#cal-grid");
    grid.innerHTML = "";
    for (let i = 0; i < startDow; i++) {
      const c = document.createElement("div");
      c.className = "cal-cell empty";
      grid.appendChild(c);
    }
    const today = todayStr();
    const MAX_BARS = 3;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${pad(month + 1)}-${pad(d)}`;
      const recs = byDate[ds] || [];
      const c = document.createElement("div");
      c.className = "cal-cell";
      if (recs.length) c.classList.add("has-records");
      if (ds === today) c.classList.add("today");
      if (ds === state.selectedDay) c.classList.add("selected");

      // 날짜별 북마크 가로 바 (폴더 색 + 이름)
      const bars = recs.slice(0, MAX_BARS).map((p) => {
        const f = folderById(p.category);
        const style = f ? `style="background:${f.color}"` : "";
        const cls = f ? "cal-bar" : "cal-bar no-folder";
        return `<div class="${cls}" ${style} data-id="${p.id}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`;
      }).join("");
      const more = recs.length > MAX_BARS ? `<div class="cal-bar more">+${recs.length - MAX_BARS}</div>` : "";
      c.innerHTML = `<span class="cal-daynum">${d}</span>` +
        (recs.length ? `<div class="cal-bars">${bars}${more}</div>` : "");

      c.addEventListener("click", () => {
        state.selectedDay = ds;
        renderCalendar();
        renderDayRecords(ds);
      });
      // 바 클릭 시 해당 북마크 상세 (날짜 선택보다 우선)
      $$(".cal-bar[data-id]", c).forEach((bar) =>
        bar.addEventListener("click", (e) => {
          e.stopPropagation();
          openViewer(bar.dataset.id);
        })
      );
      grid.appendChild(c);
    }
    if (state.selectedDay) renderDayRecords(state.selectedDay);
    else $("#cal-day-records").innerHTML = '<p class="empty-state">날짜를 누르면<br>그날의 기록이 여기에 표시됩니다.</p>';
  }

  function renderDayRecords(ds) {
    const items = state.places.filter((p) => p.date === ds);
    const box = $("#cal-day-records");
    if (!items.length) {
      box.innerHTML = `<h3>${fmtDate(ds)} · 기록 없음</h3>`;
      return;
    }
    box.innerHTML =
      `<h3>${fmtDate(ds)} · ${items.length}곳</h3>` + items.map(cardHtml).join("");
    bindCards(box);
  }

  // ---------- 에디터 ----------
  function openEditor(record) {
    // 편집 시 원본을 복제(취소해도 원본 보존). photos 배열로 정규화.
    state.draft = record
      ? { ...record, photos: (record.photos || (record.photo ? [record.photo] : [])).slice() }
      : {
          id: uid(),
          name: "",
          address: "",
          lat: null,
          lng: null,
          date: todayStr(),
          category: null,
          rating: 0,
          mood: null,
          memo: "",
          photos: [],
          createdAt: Date.now(),
        };
    const d = state.draft;
    const isEdit = !!record;

    $("#editor-title").textContent = isEdit ? "기록 편집" : "장소 기록";
    $("#place-name").value = d.name || "";
    $("#place-address").value = d.address || "";
    $("#place-date").value = d.date || todayStr();
    $("#place-memo").value = d.memo || "";
    $("#memo-count").textContent = `${(d.memo || "").length}/100`;
    $("#place-search").value = "";
    $("#search-results").innerHTML = "";

    renderCategoryPicker();
    setCategory(d.category || null);
    setRating(d.rating || 0);
    setMood(d.mood || null);
    renderPhotoThumbs();
    $("#editor-delete").hidden = !isEdit;

    openModal("editor");
    setTimeout(initEditorMap, 60);
  }

  // 편집기 미니지도. 메인 지도와 같은 엔진(국내=카카오 / 해외=Leaflet-OSM)을 따른다.
  function initEditorMap() {
    // 카카오 엔진인데 카카오가 아직 준비 안 됐으면(로딩 지연 등) 잠시 후 재시도.
    if (state.engine === "kakao" && !(window.kakao && kakao.maps && kakao.maps.Map)) {
      state._editorMapRetry = (state._editorMapRetry || 0) + 1;
      if (state._editorMapRetry <= 25) { setTimeout(initEditorMap, 200); }
      return;
    }
    state._editorMapRetry = 0;
    const d = state.draft;
    const lat = d.lat != null ? d.lat : 37.5665;
    const lng = d.lat != null ? d.lng : 126.978;
    const level = d.lat != null ? 3 : 7;

    // 엔진이 바뀌었거나 아직 없으면 (새 컨테이너로) 다시 만든다.
    if (!state.editorMap || state.editorEngine !== state.engine) {
      if (state.editorMap) { try { state.editorMap.destroy(); } catch (_) {} state.editorMap = null; }
      const container = freshContainer("editor-map");
      state.editorMap = MapEngine.create(state.engine, container, {
        lat, lng, level,
        onBgClick: (clat, clng) => { if (clat != null) setEditorPin(clat, clng, true); },
      });
      state.editorEngine = state.engine;
    } else {
      state.editorMap.setCenter(lat, lng);
      state.editorMap.setLevel(level);
    }
    [60, 250].forEach((t) => setTimeout(() => state.editorMap && state.editorMap.relayout(), t));
    if (d.lat != null) setEditorPin(d.lat, d.lng, false);
    else state.editorMap.clearPin();
  }

  function setEditorPin(lat, lng, reverse) {
    state.draft.lat = lat;
    state.draft.lng = lng;
    if (state.editorMap) {
      state.editorMap.setPin(lat, lng);
      state.editorMap.setCenter(lat, lng);
    }
    if (reverse) reverseGeocode(lat, lng);
  }

  // ---------- 편집기 장소 검색 (국내=카카오 / 전세계=Photon) ----------
  // 편집기 검색결과 렌더 (엔진 무관 공통 형태 {name,addr,lat,lng})
  function fillEditorResults(results, items) {
    if (!items.length) {
      results.innerHTML = `<li>검색 결과가 없어요. 지도를 직접 눌러 위치를 찍어보세요.</li>`;
      return;
    }
    results.innerHTML = "";
    items.slice(0, 12).forEach((it) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="r-name">${escapeHtml(it.name)}</div><div class="r-addr">${escapeHtml(it.addr)}</div>`;
      li.addEventListener("click", () => {
        if (!$("#place-name").value) $("#place-name").value = it.name;
        $("#place-address").value = it.addr;
        state.draft.name = $("#place-name").value;
        state.draft.address = it.addr;
        setEditorPin(it.lat, it.lng, false);
        if (state.editorMap) { state.editorMap.setCenter(it.lat, it.lng); state.editorMap.setLevel(3); }
        results.innerHTML = "";
      });
      results.appendChild(li);
    });
  }

  function searchPlace(query) {
    const results = $("#search-results");
    // 먼저 링크 붙여넣기 좌표 추출 시도
    const coords = extractCoords(query);
    if (coords) {
      results.innerHTML = "";
      setEditorPin(coords.lat, coords.lng, true);
      if (state.editorMap) { state.editorMap.setCenter(coords.lat, coords.lng); state.editorMap.setLevel(3); }
      toast("링크에서 좌표를 찾았어요");
      return;
    }
    results.innerHTML = `<li>검색 중…</li>`;
    // 전세계(Leaflet) 모드 = Photon(해외 검색), 국내(카카오) 모드 = 카카오 Places
    if (state.engine === "leaflet") {
      photonSearch(query)
        .then((items) => fillEditorResults(results, items))
        .catch(() => { results.innerHTML = `<li>검색 실패 (인터넷 확인). 지도를 직접 눌러도 됩니다.</li>`; });
      return;
    }
    if (!(window.kakao && kakao.maps && kakao.maps.services)) {
      results.innerHTML = `<li>검색 모듈 로드 실패 (인터넷 확인)</li>`;
      return;
    }
    const ps = new kakao.maps.services.Places();
    // 위치/반경 제한 없이 전국 검색 (카카오 키워드 검색, 띄어쓰기 차이도 잘 처리)
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        fillEditorResults(results, (data || []).map((place) => ({
          name: place.place_name || "이름 미상",
          addr: place.road_address_name || place.address_name || "",
          lat: parseFloat(place.y), lng: parseFloat(place.x),
        })));
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        results.innerHTML = `<li>검색 결과가 없어요. 지도를 직접 눌러 위치를 찍어보세요.</li>`;
      } else {
        results.innerHTML = `<li>${searchFailMsg()} 지도를 직접 눌러도 됩니다.</li>`;
      }
    }, {});
  }

  function reverseGeocode(lat, lng) {
    // 전세계(Leaflet) 모드는 Photon 역지오코딩으로 주소 자동입력
    if (state.engine === "leaflet") {
      photonReverse(lat, lng).then((addr) => {
        if (addr && !$("#place-address").value) {
          $("#place-address").value = addr;
          if (state.draft) state.draft.address = addr;
        }
      });
      return;
    }
    if (!(window.kakao && kakao.maps && kakao.maps.services)) return;
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.coord2Address(lng, lat, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const r = result[0];
        const addr = (r.road_address && r.road_address.address_name) ||
                     (r.address && r.address.address_name) || "";
        if (addr && !$("#place-address").value) {
          $("#place-address").value = addr;
          if (state.draft) state.draft.address = addr;
        }
      }
    });
  }

  // ---------- 폴더/별점/기분/사진 위젯 ----------
  function renderCategoryPicker() {
    const box = $("#category-picker");
    box.innerHTML =
      state.folders
        .map((c) => `<button type="button" data-cat="${c.id}">` +
          `<span class="chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</button>`)
        .join("") +
      `<button type="button" class="cat-add" data-act="manage">＋ 폴더 관리</button>`;
    $$("button", box).forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.act === "manage") { openFolderManager(); return; }
        // 같은 폴더 다시 누르면 해제(선택)
        setCategory(state.draft.category === b.dataset.cat ? null : b.dataset.cat);
      })
    );
  }
  function setCategory(id) {
    state.draft.category = id;
    $$("#category-picker button").forEach((b) => {
      const on = b.dataset.cat === id;
      b.classList.toggle("on", on);
      b.style.background = on ? (folderById(id)?.color || "") : "";
    });
  }

  // ---------- 폴더 관리 ----------
  async function loadFolders() {
    let folders = await PlaceDB.getFolders();
    if (!folders.length) {
      // 첫 실행: 기본 폴더 시드
      folders = DEFAULT_FOLDERS.map((f, i) => ({ ...f, order: i, createdAt: Date.now() + i }));
      await PlaceDB.bulkPutFolders(folders);
    }
    folders.sort((a, b) => (a.order || 0) - (b.order || 0));
    state.folders = folders;
  }

  function openFolderManager() {
    renderFolderManager();
    openModal("folder-manager");
  }

  function renderFolderManager() {
    const box = $("#folder-manager-body");
    const rows = state.folders
      .map((f) => {
        const count = state.places.filter((p) => p.category === f.id).length;
        return `<div class="fm-row" data-id="${f.id}">
          <input type="color" class="fm-color" value="${f.color}" aria-label="색상" />
          <input type="text" class="fm-name" value="${escapeHtml(f.name)}" maxlength="20" />
          <span class="fm-count">${count}곳</span>
          <button type="button" class="fm-del icon-btn" aria-label="삭제">🗑️</button>
        </div>`;
      })
      .join("");
    const nextColor = FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length];
    box.innerHTML = `
      <p class="hint">폴더 이름과 색을 자유롭게 지정하세요. 변경은 바로 저장됩니다.</p>
      <div class="fm-list">${rows || '<p class="muted">폴더가 없습니다.</p>'}</div>
      <div class="fm-add">
        <input type="color" id="fm-new-color" value="${nextColor}" aria-label="새 폴더 색" />
        <input type="text" id="fm-new-name" placeholder="새 폴더 이름" maxlength="20" />
        <button type="button" id="fm-add-btn" class="btn-mini">추가</button>
      </div>`;

    // 바인딩
    $$(".fm-row", box).forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".fm-name").addEventListener("change", (e) =>
        updateFolder(id, { name: e.target.value.trim() || "이름없음" })
      );
      row.querySelector(".fm-color").addEventListener("change", (e) =>
        updateFolder(id, { color: e.target.value })
      );
      row.querySelector(".fm-del").addEventListener("click", () => deleteFolder(id));
    });
    $("#fm-add-btn").addEventListener("click", () => {
      const name = $("#fm-new-name").value.trim();
      if (!name) { toast("폴더 이름을 입력하세요"); return; }
      createFolder(name, $("#fm-new-color").value);
    });
  }

  async function createFolder(name, color) {
    const folder = { id: "f_" + Date.now().toString(36), name, color, order: state.folders.length, createdAt: Date.now() };
    await PlaceDB.putFolder(folder);
    state.folders.push(folder);
    renderFolderManager();
    afterFolderChange();
    toast(`'${name}' 폴더를 만들었어요`);
  }

  async function updateFolder(id, patch) {
    const f = folderById(id);
    if (!f) return;
    Object.assign(f, patch);
    await PlaceDB.putFolder(f);
    afterFolderChange();
  }

  async function deleteFolder(id) {
    const f = folderById(id);
    if (!f) return;
    const count = state.places.filter((p) => p.category === id).length;
    const msg = count
      ? `'${f.name}' 폴더를 삭제할까요?\n이 폴더의 기록 ${count}곳은 '폴더 없음'이 됩니다(기록은 유지).`
      : `'${f.name}' 폴더를 삭제할까요?`;
    if (!confirm(msg)) return;
    await PlaceDB.removeFolder(id);
    state.folders = state.folders.filter((x) => x.id !== id);
    // 해당 폴더를 쓰던 기록은 폴더 해제
    const affected = state.places.filter((p) => p.category === id);
    for (const p of affected) { p.category = null; await PlaceDB.put(p); }
    if (state.catFilter === id) state.catFilter = "all";
    renderFolderManager();
    afterFolderChange();
    toast("폴더를 삭제했어요");
  }

  // 폴더가 바뀌면 관련 화면 모두 갱신
  function afterFolderChange() {
    refreshMarkers();
    if ($("#editor").classList.contains("open")) {
      renderCategoryPicker();
      setCategory(state.draft ? state.draft.category : null);
    }
    refreshActiveView();
  }
  function setRating(n) {
    state.draft.rating = n;
    $$("#rating-stars button").forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.v) <= n)
    );
  }
  function setMood(m) {
    state.draft.mood = m;
    $$("#mood-picker button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  }
  // 여러 장의 사진 썸네일 렌더 (첫 장이 대표)
  function renderPhotoThumbs() {
    const box = $("#photo-thumbs");
    const photos = state.draft.photos || [];
    box.innerHTML = photos
      .map((src, i) =>
        `<div class="photo-thumb" data-i="${i}">
          <img src="${src}" alt="">
          ${i === 0 ? '<span class="pt-cover">대표</span>' : ""}
          <button type="button" class="pt-del" aria-label="삭제">✕</button>
        </div>`
      )
      .join("");
    $$(".pt-del", box).forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const i = Number(btn.closest(".photo-thumb").dataset.i);
        state.draft.photos.splice(i, 1);
        renderPhotoThumbs();
      })
    );
  }

  async function addPhotoFiles(files) {
    if (!files || !files.length) return;
    if (!state.draft.photos) state.draft.photos = [];
    toast("사진 처리 중…");
    for (const file of files) {
      try {
        const dataUrl = await fileToCompressedDataURL(file);
        state.draft.photos.push(dataUrl);
      } catch (e) { /* 개별 실패 무시 */ }
    }
    renderPhotoThumbs();
  }

  // ---------- 저장 ----------
  async function saveDraft() {
    const d = state.draft;
    d.name = $("#place-name").value.trim();
    d.address = $("#place-address").value.trim();
    d.date = $("#place-date").value || todayStr();
    d.memo = $("#place-memo").value.trim();

    if (!d.name) { toast("장소 이름을 입력해 주세요"); $("#place-name").focus(); return; }
    if (d.lat == null) { toast("지도에서 위치를 지정해 주세요"); return; }

    if (!d.photos) d.photos = [];
    d.photo = d.photos[0] || null; // 대표 사진(목록·마커·상세 표지용)

    await PlaceDB.put(d);
    const idx = state.places.findIndex((p) => p.id === d.id);
    if (idx >= 0) state.places[idx] = { ...d };
    else state.places.push({ ...d });

    closeModal("editor");
    state._fitted = true; // 사용자 편집 후엔 자동 줌 방지
    refreshMarkers();
    refreshActiveView();
    toast("저장했어요 ✓");
  }

  async function deleteDraft() {
    const d = state.draft;
    if (!confirm(`'${d.name}' 기록을 삭제할까요?`)) return;
    await PlaceDB.remove(d.id);
    state.places = state.places.filter((p) => p.id !== d.id);
    closeModal("editor");
    refreshMarkers();
    refreshActiveView();
    toast("삭제했어요");
  }

  function refreshActiveView() {
    const active = $$(".view.active")[0];
    if (!active) return;
    if (active.id === "view-map") renderList();
    if (active.id === "view-folders") {
      if ($("#folders-detail").hidden) renderFoldersHome();
      else renderFoldersHome(); // 변경 후엔 폴더 홈으로 (카운트 갱신)
    }
    if (active.id === "view-calendar") renderCalendar();
    if (active.id === "view-backup") renderBackupStat();
  }

  // 지도 핀 클릭 시 오른쪽 목록에서 해당 카드 강조·스크롤
  function focusListItem(id) {
    const cont = $("#list-container");
    if (!cont) return;
    $$(".place-card", cont).forEach((el) => el.classList.toggle("focused", el.dataset.id === id));
    const card = cont.querySelector('.place-card[data-id="' + id + '"]');
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // 상세 보기에서 바로 삭제
  async function deleteFromViewer() {
    const p = state.viewing;
    if (!p) return;
    if (!confirm(`'${p.name}' 기록을 삭제할까요?`)) return;
    await PlaceDB.remove(p.id);
    state.places = state.places.filter((x) => x.id !== p.id);
    closeModal("viewer");
    refreshMarkers();
    refreshActiveView();
    toast("삭제했어요");
  }

  // ---------- 상세 보기 ----------
  function openViewer(id) {
    const p = state.places.find((x) => x.id === id);
    if (!p) return;
    state.viewing = p;
    $("#viewer-title").textContent = p.name;
    const body = $("#viewer-body");
    const photos = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
    const photoHtml = photos.length
      ? `<img class="viewer-photo" src="${photos[0]}" alt="">` +
        (photos.length > 1
          ? `<div class="viewer-photo-strip">${photos.slice(1).map((s) => `<img src="${s}" alt="">`).join("")}</div>`
          : "")
      : "";
    body.innerHTML = `
      ${photoHtml}
      <div class="viewer-row">
        ${catBadgeHtml(p.category)}
        ${p.rating ? `<span class="stars-readonly" style="font-size:18px">${starStr(p.rating)}</span>` : ""}
        ${p.mood ? `<span style="font-size:20px">${p.mood}</span>` : ""}
        <span class="chip">${fmtDate(p.date)}</span>
      </div>
      <div class="viewer-addr">📍 ${escapeHtml(p.address || "주소 없음")}</div>
      ${p.memo ? `<div class="viewer-memo">${escapeHtml(p.memo)}</div>` : ""}
      <button class="btn-open-map" id="viewer-open-map">🧭 외부 지도/앱에서 열기</button>
    `;
    $("#viewer-open-map").onclick = () => openExternalMapSheet(p);
    openModal("viewer");
  }

  // ---------- 외부 지도 열기 ----------
  function openExternalMapSheet(p) {
    const { lat, lng, name } = p;
    const enc = encodeURIComponent(name || "");
    const box = $("#open-links");
    const links = [
      { ico: "🌐", label: "구글 지도 (앱/웹 자동)", url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` },
      { ico: "🟡", label: "카카오맵 (웹)", url: `https://map.kakao.com/link/map/${enc},${lat},${lng}` },
      { ico: "🟢", label: "네이버 지도 (웹)", url: `https://map.naver.com/v5/?c=${lng},${lat},15,0,0,0,dh` },
      { ico: "📱", label: "카카오맵 앱으로 열기", url: `kakaomap://look?p=${lat},${lng}`, fallback: `https://map.kakao.com/link/map/${enc},${lat},${lng}` },
      { ico: "📱", label: "네이버 지도 앱으로 열기", url: `nmap://place?lat=${lat}&lng=${lng}&name=${enc}&appname=yeogiyeogi`, fallback: `https://map.naver.com/v5/?c=${lng},${lat},15,0,0,0,dh` },
    ];
    box.innerHTML = links
      .map(
        (l, i) =>
          `<a class="open-link" data-i="${i}" href="${l.url}" target="_blank" rel="noopener">
            <span class="ico">${l.ico}</span><span>${l.label}</span></a>`
      )
      .join("");
    $$(".open-link", box).forEach((a) => {
      const l = links[Number(a.dataset.i)];
      if (l.fallback) {
        a.addEventListener("click", () => {
          // 앱 스킴 실패 대비 폴백
          setTimeout(() => { window.location.href = l.fallback; }, 1200);
        });
      }
    });
    openModal("open-sheet");
  }

  // ---------- 카드 이미지 내보내기 ----------
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  function drawCover(ctx, img, x, y, w, h, r) {
    const aspect = img.width / img.height;
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (aspect > w / h) { sw = img.height * (w / h); sx = (img.width - sw) / 2; }
    else { sh = img.width * (h / w); sy = (img.height - sh) / 2; }
    roundRectPath(ctx, x, y, w, h, r);
    ctx.save(); ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }

  // 1~4장 사진을 격자로 배치
  async function drawPhotoGrid(ctx, photos, X, Y, W, H, gap) {
    const n = Math.min(photos.length, 4);
    const layouts = {
      1: [[0, 0, 1, 1]],
      2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
      3: [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
      4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    };
    const cells = layouts[n] || layouts[1];
    const imgs = await Promise.all(photos.slice(0, 4).map(loadImg));
    cells.forEach((c, i) => {
      const img = imgs[i];
      const x = X + c[0] * W + (c[0] > 0 ? gap / 2 : 0);
      const y = Y + c[1] * H + (c[1] > 0 ? gap / 2 : 0);
      const w = c[2] * W - (c[2] < 1 ? gap / 2 : 0);
      const h = c[3] * H - (c[3] < 1 ? gap / 2 : 0);
      if (img) drawCover(ctx, img, x, y, w, h, 18);
    });
  }

  // 장소 이름·주소·사진(선택분)·메모를 한 장의 카드 캔버스로 정리
  async function buildCardCanvas(p, selPhotos) {
    const canvas = $("#export-canvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const photos = selPhotos !== undefined ? selPhotos : (p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []));

    // 배경
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#fff5f5");
    grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 사진 영역
    const padding = 50;
    const photoH = 460;
    const photoY = padding;
    if (photos.length) {
      await drawPhotoGrid(ctx, photos, padding, photoY, W - padding * 2, photoH, 12);
    } else {
      roundRectPath(ctx, padding, photoY, W - padding * 2, photoH, 24);
      ctx.fillStyle = "#ffe3e3";
      ctx.fill();
      ctx.fillStyle = "#ff8787";
      ctx.font = "120px serif";
      ctx.textAlign = "center";
      ctx.fillText("📍", W / 2, photoY + photoH / 2 + 40);
      ctx.textAlign = "left";
    }

    let y = photoY + photoH + 60;
    // 제목 + 기분
    ctx.fillStyle = "#1f2330";
    ctx.font = "bold 48px -apple-system, 'Malgun Gothic', sans-serif";
    const title = (p.name || "") + "  " + (p.mood || "");
    wrapText(ctx, title, padding, y, W - padding * 2, 56);
    y += 70;

    // 폴더 + 별점 + 날짜 (있는 것만)
    let metaX = padding;
    const cat = folderById(p.category);
    if (cat) {
      ctx.font = "30px -apple-system, 'Malgun Gothic', sans-serif";
      const label = "● " + cat.name;
      ctx.fillStyle = cat.color;
      ctx.fillText(label, metaX, y);
      metaX += ctx.measureText(label).width + 24;
    }
    if (p.rating) {
      ctx.fillStyle = "#ffc107";
      ctx.font = "40px serif";
      ctx.fillText(starStr(p.rating), metaX, y);
      metaX += ctx.measureText(starStr(p.rating)).width + 24;
    }
    ctx.fillStyle = "#7a8194";
    ctx.font = "30px -apple-system, 'Malgun Gothic', sans-serif";
    ctx.fillText(fmtDate(p.date), metaX, y);
    y += 56;

    // 주소
    ctx.fillStyle = "#7a8194";
    ctx.font = "28px -apple-system, 'Malgun Gothic', sans-serif";
    y = wrapText(ctx, "📍 " + (p.address || ""), padding, y, W - padding * 2, 38);
    y += 30;

    // 메모
    if (p.memo) {
      roundRectPath(ctx, padding, y, W - padding * 2, 0, 0); // no-op spacing
      ctx.fillStyle = "#4a4f5e";
      ctx.font = "32px -apple-system, 'Malgun Gothic', sans-serif";
      y = wrapText(ctx, p.memo, padding, y + 10, W - padding * 2, 44);
    }

    // 워터마크
    ctx.fillStyle = "#c5cad6";
    ctx.font = "24px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("pindiary · 장소 다이어리", W - padding, H - 40);
    ctx.textAlign = "left";

    return canvas;
  }

  function safeName(s) { return (s || "place").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40); }

  // 내보내기 시트 열기 (사진 선택 + 미리보기 + PNG/PDF)
  async function openExportSheet(p) {
    if (!p) return;
    state.exporting = p;
    const all = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
    // 기본 선택: 최대 4장 (선택 해제하면 사진 없이 내보내기 가능)
    state.exportSel = all.slice(0, 4).map((_, i) => i);
    openModal("export-sheet");
    const note = $("#export-folder-note");
    note.textContent = window.showDirectoryPicker
      ? "저장 위치(폴더)를 직접 고를 수 있어요. 처음 한 번 고르면 'pindiary 내보내기' 폴더에 모읍니다."
      : "이 브라우저는 폴더 지정을 지원하지 않아 다운로드 폴더에 저장됩니다.";
    renderExportPhotoPick(all);
    await refreshExportPreview();
  }

  function exportSelectedPhotos() {
    const p = state.exporting;
    const all = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
    return state.exportSel.slice(0, 4).map((i) => all[i]).filter(Boolean);
  }

  function renderExportPhotoPick(all) {
    const box = $("#export-photo-pick");
    if (!all.length) { box.innerHTML = ""; return; }
    box.innerHTML = all
      .map((src, i) =>
        `<div class="ep-thumb ${state.exportSel.includes(i) ? "on" : ""}" data-i="${i}">
          <img src="${src}" alt=""><span class="ep-check">✓</span>
        </div>`
      )
      .join("");
    $$(".ep-thumb", box).forEach((el) =>
      el.addEventListener("click", async () => {
        const i = Number(el.dataset.i);
        const at = state.exportSel.indexOf(i);
        if (at >= 0) state.exportSel.splice(at, 1);
        else {
          if (state.exportSel.length >= 4) { toast("사진은 최대 4장까지 선택돼요"); return; }
          state.exportSel.push(i);
        }
        el.classList.toggle("on", state.exportSel.includes(i));
        await refreshExportPreview();
      })
    );
  }

  async function refreshExportPreview() {
    const canvas = await buildCardCanvas(state.exporting, exportSelectedPhotos());
    $("#export-preview").src = canvas.toDataURL("image/png");
  }

  // 사용자가 고른 폴더(없으면 다운로드)로 저장. 폴더 핸들은 세션 동안 재사용.
  async function saveBlob(blob, filename) {
    if (window.showDirectoryPicker) {
      try {
        if (!state.exportDir) {
          const root = await window.showDirectoryPicker({ mode: "readwrite" });
          state.exportDir = await root.getDirectoryHandle("pindiary 내보내기", { create: true });
        }
        const fh = await state.exportDir.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        toast(`'pindiary 내보내기' 폴더에 저장했어요`);
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // 사용자가 취소
        state.exportDir = null; // 실패 시 폴백
      }
    }
    // 폴백: 일반 다운로드
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("저장(다운로드)했어요");
  }

  async function exportAsPNG() {
    const p = state.exporting;
    if (!p) return;
    const canvas = await buildCardCanvas(p, exportSelectedPhotos());
    canvas.toBlob((blob) => saveBlob(blob, `${safeName(p.name)}_카드.png`), "image/png");
  }

  async function exportAsPDF() {
    const p = state.exporting;
    if (!p) return;
    if (!(window.jspdf && window.jspdf.jsPDF)) { toast("PDF 모듈 로드 실패 (인터넷 확인)"); return; }
    const canvas = await buildCardCanvas(p, exportSelectedPhotos());
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    const blob = pdf.output("blob");
    await saveBlob(blob, `${safeName(p.name)}_카드.pdf`);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = String(text).split("");
    let line = "";
    for (let i = 0; i < words.length; i++) {
      const test = line + words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y);
        line = words[i];
        y += lineH;
      } else {
        line = test;
      }
    }
    if (line) { ctx.fillText(line, x, y); y += lineH; }
    return y;
  }

  // ---------- 백업 ----------
  function renderBackupStat() {
    const photos = state.places.reduce((n, p) => n + ((p.photos && p.photos.length) || (p.photo ? 1 : 0)), 0);
    $("#backup-stat").textContent = `기록 ${state.places.length}개 · 사진 ${photos}장`;
    renderLastBackup();
  }

  // 마지막 드라이브 백업 시각(이 기기 기준) 표시
  const LAST_BACKUP_KEY = "pindiary_last_backup";
  function renderLastBackup() {
    const el = $("#gdrive-last");
    if (!el) return;
    let iso = null;
    try { iso = localStorage.getItem(LAST_BACKUP_KEY); } catch (_) {}
    el.textContent = iso
      ? `마지막 드라이브 백업: ${fmtDateTime(iso)}`
      : "마지막 드라이브 백업: 아직 없음";
  }
  function setLastBackup(iso) {
    try { localStorage.setItem(LAST_BACKUP_KEY, iso); } catch (_) {}
    renderLastBackup();
  }

  // 내보내기·드라이브 공용: 현재 상태를 백업 객체로 묶음(사진 포함)
  function buildBackupData() {
    return { app: "yeogi-yeogi", version: 2, exportedAt: new Date().toISOString(), folders: state.folders, places: state.places };
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(buildBackupData())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `pindiary-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("백업 파일을 내보냈어요 📦");
  }

  async function importJSON(file) {
    try {
      await importFromText(await file.text());
    } catch (e) {
      toast("불러오기 실패: 올바른 백업 파일이 아니에요");
    }
  }

  // 파일·드라이브 공용 복원: JSON 문자열을 받아 기존 기록에 병합
  async function importFromText(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.places;
    if (!Array.isArray(list)) throw new Error("형식 오류");
    // id 보정
    const valid = list
      .filter((p) => p && p.name)
      .map((p) => ({ ...p, id: p.id || uid(), createdAt: p.createdAt || Date.now() }));
    if (!confirm(`${valid.length}개의 기록을 불러옵니다. 같은 ID는 덮어씁니다. 계속할까요?`)) return;
    await PlaceDB.bulkPut(valid);
    // 폴더도 함께 복원(있으면 병합)
    if (Array.isArray(data.folders) && data.folders.length) {
      const fmap = new Map(state.folders.map((f) => [f.id, f]));
      data.folders.forEach((f) => { if (f && f.id) fmap.set(f.id, f); });
      state.folders = Array.from(fmap.values());
      await PlaceDB.bulkPutFolders(state.folders);
    }
    // 메모리 병합
    const map = new Map(state.places.map((p) => [p.id, p]));
    valid.forEach((p) => map.set(p.id, p));
    state.places = Array.from(map.values());
    state._fitted = false;
    refreshMarkers();
    refreshActiveView();
    renderBackupStat();
    toast(`${valid.length}개 기록을 불러왔어요 ✓`);
  }

  // ---------- 구글 드라이브 백업/복원 ----------
  // 최신 파일 1개 + 직전 파일 1개(자동 보관)만 유지한다.
  // 권한 범위는 drive.file → 이 앱이 만든 파일만 접근(구글 심사 불필요).
  const GDRIVE = {
    CLIENT_ID: "746685165176-trb72vmjkg36grnjpmfd8ks7r51im45j.apps.googleusercontent.com",
    SCOPE: "https://www.googleapis.com/auth/drive.file",
    FILE_NAME: "pindiary-backup.json",       // 최신
    PREV_NAME: "pindiary-backup-prev.json",   // 직전(안전망)
    tokenClient: null,
    accessToken: null,
    tokenExpiry: 0,
  };

  // 로그인해서 액세스 토큰 확보(유효하면 재사용). 반드시 클릭 이벤트 안에서 호출.
  function gdriveGetToken() {
    return new Promise((resolve, reject) => {
      const g = window.google;
      if (!g || !g.accounts || !g.accounts.oauth2) {
        reject(new Error("구글 로그인 모듈 로드 전이에요. 인터넷 확인 후 다시 시도"));
        return;
      }
      if (GDRIVE.accessToken && Date.now() < GDRIVE.tokenExpiry - 60000) {
        resolve(GDRIVE.accessToken);
        return;
      }
      if (!GDRIVE.tokenClient) {
        GDRIVE.tokenClient = g.accounts.oauth2.initTokenClient({
          client_id: GDRIVE.CLIENT_ID,
          scope: GDRIVE.SCOPE,
          callback: () => {},
        });
      }
      GDRIVE.tokenClient.callback = (resp) => {
        if (!resp || resp.error) {
          reject(new Error((resp && (resp.error_description || resp.error)) || "로그인 취소"));
          return;
        }
        GDRIVE.accessToken = resp.access_token;
        GDRIVE.tokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000);
        resolve(resp.access_token);
      };
      try {
        GDRIVE.tokenClient.requestAccessToken({ prompt: "" });
      } catch (e) { reject(e); }
    });
  }

  function gdriveHeaders(token, extra) {
    return Object.assign({ Authorization: "Bearer " + token }, extra || {});
  }

  // 이름으로 이 앱이 만든 파일 찾기(없으면 null)
  async function gdriveFindByName(token, name) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
      { headers: gdriveHeaders(token) }
    );
    if (!res.ok) throw new Error("드라이브 조회 실패 (" + res.status + ")");
    const data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function gdriveDeleteFile(token, id) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: "DELETE", headers: gdriveHeaders(token),
    });
    if (!res.ok && res.status !== 404) throw new Error("이전 파일 정리 실패 (" + res.status + ")");
  }

  async function gdriveRenameFile(token, id, newName) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: "PATCH",
      headers: gdriveHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error("이름 변경 실패 (" + res.status + ")");
  }

  async function gdriveCreateFile(token, name, jsonStr) {
    const metadata = { name, mimeType: "application/json" };
    const boundary = "pindiaryBoundary" + Date.now().toString(36);
    const body =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n" +
      `--${boundary}\r\n` +
      "Content-Type: application/json\r\n\r\n" +
      jsonStr + "\r\n" +
      `--${boundary}--`;
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: gdriveHeaders(token, { "Content-Type": `multipart/related; boundary=${boundary}` }),
        body,
      }
    );
    if (!res.ok) throw new Error("업로드 실패 (" + res.status + ")");
    return res.json();
  }

  async function gdriveDownloadById(token, id) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: gdriveHeaders(token),
    });
    if (!res.ok) throw new Error("다운로드 실패 (" + res.status + ")");
    return res.text();
  }

  async function gdriveBackup() {
    const btn = $("#btn-gdrive-backup");
    if (btn) btn.disabled = true;
    try {
      toast("구글 로그인 확인 중…");
      const token = await gdriveGetToken();
      // 실수로 빈 데이터를 덮어쓰는 사고 방지
      if (state.places.length === 0 &&
          !confirm("지금 기록이 0개예요. 드라이브의 기존 백업을 빈 내용으로 덮어쓸 수 있어요. 계속할까요?")) {
        return;
      }
      toast("드라이브에 올리는 중…");
      // 최신 → 이전으로 한 칸 밀기(안전망), 그 뒤 새 최신 생성
      const latest = await gdriveFindByName(token, GDRIVE.FILE_NAME);
      if (latest) {
        const prev = await gdriveFindByName(token, GDRIVE.PREV_NAME);
        if (prev) await gdriveDeleteFile(token, prev.id);
        await gdriveRenameFile(token, latest.id, GDRIVE.PREV_NAME);
      }
      await gdriveCreateFile(token, GDRIVE.FILE_NAME, JSON.stringify(buildBackupData()));
      setLastBackup(new Date().toISOString());
      toast("드라이브에 백업했어요 ☁️✓");
    } catch (e) {
      toast("드라이브 백업 실패: " + (e.message || "다시 시도"));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // kind: "latest" | "prev"
  async function gdriveRestore(kind) {
    const btnId = kind === "prev" ? "#btn-gdrive-restore-prev" : "#btn-gdrive-restore";
    const btn = $(btnId);
    if (btn) btn.disabled = true;
    try {
      toast("구글 로그인 확인 중…");
      const token = await gdriveGetToken();
      toast("드라이브에서 가져오는 중…");
      const name = kind === "prev" ? GDRIVE.PREV_NAME : GDRIVE.FILE_NAME;
      const file = await gdriveFindByName(token, name);
      if (!file) {
        toast(kind === "prev" ? "드라이브에 이전 백업이 없어요" : "드라이브에 백업 파일이 없어요");
        return;
      }
      const text = await gdriveDownloadById(token, file.id);
      await importFromText(text);
      // 다른 기기에서 복원한 경우에도, 그 백업이 만들어진 시각을 표시에 반영
      if (file.modifiedTime) setLastBackup(file.modifiedTime);
    } catch (e) {
      toast("드라이브 복원 실패: " + (e.message || "다시 시도"));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function clearAll() {
    if (!confirm("정말 모든 기록을 삭제할까요? 되돌릴 수 없습니다.")) return;
    if (!confirm("마지막 확인입니다. 백업은 하셨나요? 모두 삭제합니다.")) return;
    await PlaceDB.clear();
    state.places = [];
    state._fitted = false;
    refreshMarkers();
    refreshActiveView();
    renderBackupStat();
    toast("모든 기록을 삭제했어요");
  }

  // ---------- 모달 ----------
  function openModal(id) {
    const m = document.getElementById(id);
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
  }

  // ---------- 이벤트 바인딩 ----------
  function bindEvents() {
    // 탭
    $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
    // 추가 버튼
    $("#btn-add").addEventListener("click", () => openEditor(null));

    // 에디터
    $("#editor-close").addEventListener("click", () => closeModal("editor"));
    $("#editor-save").addEventListener("click", saveDraft);
    $("#editor-delete").addEventListener("click", deleteDraft);
    $("#place-search-btn").addEventListener("click", () => {
      const q = $("#place-search").value.trim();
      if (q) searchPlace(q);
    });
    $("#place-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = $("#place-search").value.trim();
        if (q) searchPlace(q);
      }
    });
    // 붙여넣기 → 좌표 추출
    $("#place-search").addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      const coords = extractCoords(text);
      if (coords) {
        setTimeout(() => {
          setEditorPin(coords.lat, coords.lng, true);
          if (state.editorMap) { state.editorMap.setCenter(coords.lat, coords.lng); state.editorMap.setLevel(3); }
          toast("링크에서 좌표를 찾았어요");
        }, 0);
      }
    });
    $("#place-memo").addEventListener("input", (e) => {
      $("#memo-count").textContent = `${e.target.value.length}/100`;
    });

    // 별점 (같은 별 다시 누르면 0으로 해제 → 선택사항)
    $$("#rating-stars button").forEach((b) =>
      b.addEventListener("click", () => {
        const v = Number(b.dataset.v);
        setRating(state.draft.rating === v ? 0 : v);
      })
    );
    // 기분 (같은 기분 다시 누르면 해제 → 선택사항)
    $$("#mood-picker button").forEach((b) =>
      b.addEventListener("click", () => {
        const m = b.dataset.m;
        setMood(state.draft.mood === m ? null : m);
      })
    );
    // 사진 (여러 장 추가)
    $("#place-photo").addEventListener("change", async (e) => {
      await addPhotoFiles(Array.from(e.target.files || []));
      e.target.value = ""; // 같은 파일 재선택 허용
    });

    // 뷰어
    $("#viewer-close").addEventListener("click", () => closeModal("viewer"));
    $("#viewer-edit").addEventListener("click", () => {
      closeModal("viewer");
      openEditor(state.viewing);
    });
    $("#viewer-export").addEventListener("click", () => openExportSheet(state.viewing));
    $("#viewer-delete").addEventListener("click", deleteFromViewer);

    // 내보내기 시트
    $("#export-close").addEventListener("click", () => closeModal("export-sheet"));
    $("#export-png").addEventListener("click", exportAsPNG);
    $("#export-pdf").addEventListener("click", exportAsPDF);

    // 외부 지도 시트
    $("#open-close").addEventListener("click", () => closeModal("open-sheet"));

    // 폴더 관리 모달 닫기
    $("#folder-manager-close").addEventListener("click", () => closeModal("folder-manager"));

    // 지도 엔진 전환 버튼 (카카오 국내 ↔ Leaflet 전세계)
    const engineToggle = $("#map-engine-toggle");
    if (engineToggle) {
      engineToggle.addEventListener("click", () =>
        switchMapEngine(state.engine === "kakao" ? "leaflet" : "kakao"));
    }

    // 지도 탭 장소 검색창
    const mapSearchInput = $("#map-search-input");
    if (mapSearchInput) {
      mapSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); const q = e.target.value.trim(); if (q) mapSearch(q); }
      });
      mapSearchInput.addEventListener("input", (e) => {
        if (!e.target.value.trim()) $("#map-search-results").innerHTML = "";
      });
    }

    // 목록
    $("#list-search").addEventListener("input", renderList);
    $("#list-sort").addEventListener("change", renderList);
    // 특정 하루만 보기: 목록 + 지도 핀 함께 필터
    $("#list-date").addEventListener("change", (e) => {
      state.dateFilter = e.target.value || "";
      $("#list-date-clear").hidden = !state.dateFilter;
      renderList();
      state._fitted = false; // 필터된 핀에 맞춰 지도 범위 다시 맞춤
      refreshMarkers();
    });
    $("#list-date-clear").addEventListener("click", () => {
      state.dateFilter = "";
      $("#list-date").value = "";
      $("#list-date-clear").hidden = true;
      renderList();
      state._fitted = false; // 전체로 되돌리며 지도 범위 재조정
      refreshMarkers();
    });
    $("#list-search-toggle").addEventListener("click", () =>
      $(".list-pane .list-toolbar").classList.toggle("show")
    );

    // 폴더(목록) 탭 뒤로가기
    $("#folders-back").addEventListener("click", renderFoldersHome);

    // 달력
    $("#cal-prev").addEventListener("click", () => {
      state.calCursor.setMonth(state.calCursor.getMonth() - 1);
      renderCalendar();
    });
    $("#cal-next").addEventListener("click", () => {
      state.calCursor.setMonth(state.calCursor.getMonth() + 1);
      renderCalendar();
    });

    // 백업
    $("#btn-export-json").addEventListener("click", exportJSON);
    $("#file-import").addEventListener("change", (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });
    $("#btn-clear-all").addEventListener("click", clearAll);
    $("#btn-manage-folders").addEventListener("click", openFolderManager);
    // 구글 드라이브 백업/복원
    const gb = $("#btn-gdrive-backup"); if (gb) gb.addEventListener("click", gdriveBackup);
    const gr = $("#btn-gdrive-restore"); if (gr) gr.addEventListener("click", () => gdriveRestore("latest"));
    const grp = $("#btn-gdrive-restore-prev"); if (grp) grp.addEventListener("click", () => gdriveRestore("prev"));

    // 모달 배경 클릭으로 닫기
    $$(".modal").forEach((m) =>
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m.id);
      })
    );
  }

  // ---------- 모바일 지도 탭: 목록 바텀시트(서랍) ----------
  // 지도가 화면을 채우고, 목록은 아래 손잡이를 끌어 3단계(작게/중간/최대)로 올라온다.
  // 최대 = 시트 높이 100%(=기존 목록 높이, 지도 최소 48%), 작게 = 손잡이만 보임.
  function initListSheet() {
    const sheet = document.querySelector("#view-map .list-pane");
    const handle = document.getElementById("sheet-handle");
    if (!sheet || !handle) return;
    const mq = window.matchMedia("(max-width: 767px)");

    let stops = [0, 0, 0]; // translateY(px): [작게(큰값)·중간·최대(0)]
    let idx = 0; // 현재 단계 (0=작게)
    let live = 0; // 현재 적용된 translateY

    function computeStops() {
      const h = sheet.offsetHeight; // 시트 높이(컨테이너의 52%)
      const handleH = handle.offsetHeight || 54;
      const peek = Math.max(0, h - handleH); // 손잡이만 보이게
      const mid = Math.round(peek * 0.45); // 중간 정착점
      stops = [peek, mid, 0];
    }
    function place(px) {
      live = px;
      sheet.style.transform = "translateY(" + px + "px)";
    }
    function snapTo(i) {
      idx = Math.max(0, Math.min(2, i));
      sheet.style.transition = ""; // CSS 전환으로 부드럽게
      place(stops[idx]);
    }
    function enable(reset) {
      if (!mq.matches) { disable(); return; } // 데스크톱에선 서랍 비활성(레이아웃 원복)
      computeStops();
      sheet.style.willChange = "transform";
      if (reset) idx = 0; // 처음엔 작게(peek)
      idx = Math.max(0, Math.min(2, idx));
      sheet.style.transition = "none"; // 초기 배치는 애니메이션 없이
      place(stops[idx]);
      void sheet.offsetHeight; // 강제 리플로우
      sheet.style.transition = "";
    }
    function disable() {
      sheet.style.transform = ""; // 데스크톱: 인라인 스타일 제거
      sheet.style.transition = "";
      sheet.style.willChange = "";
    }
    function sync(reset) {
      if (mq.matches) enable(reset);
      else disable();
    }

    // 드래그 (포인터 = 터치·마우스 공용)
    let dragging = false, startY = 0, startShift = 0, moved = false;
    handle.addEventListener("pointerdown", (e) => {
      if (!mq.matches) return;
      dragging = true; moved = false;
      startY = e.clientY; startShift = live;
      sheet.style.transition = "none";
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      let px = startShift + dy;
      px = Math.max(stops[2], Math.min(stops[0], px)); // 최대(0)~작게(peek) 사이
      place(px);
      e.preventDefault();
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        // 놓은 위치에서 가장 가까운 단계로 스냅
        let best = 0, bd = Infinity;
        stops.forEach((s, i) => { const d = Math.abs(s - live); if (d < bd) { bd = d; best = i; } });
        snapTo(best);
      } else {
        snapTo(idx >= 2 ? 0 : idx + 1); // 탭 = 다음 단계(순환)
      }
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("keydown", (e) => {
      if (!mq.matches) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); snapTo(idx >= 2 ? 0 : idx + 1); }
    });

    if (mq.addEventListener) mq.addEventListener("change", () => sync(true));
    else mq.addListener(() => sync(true));
    window.addEventListener("resize", () => { if (mq.matches && !dragging) enable(false); });

    state.listSheet = { sync, enable };
    sync(true);
  }

  // ---------- 시작 ----------
  async function init() {
    bindEvents();
    try {
      await loadFolders();
      state.places = await PlaceDB.getAll();
      // 구버전(단일 photo) → photos 배열 정규화
      state.places.forEach((p) => {
        if (!p.photos) p.photos = p.photo ? [p.photo] : [];
      });
    } catch (e) {
      toast("저장소를 여는 데 실패했어요");
      state.places = [];
    }
    renderList(); // 지도 뷰에 통합된 목록 초기 렌더
    renderBackupStat();
    initListSheet(); // 모바일 목록 서랍
    // 모바일은 레이아웃 확정이 늦어 초기 시트 높이 오측정 가능 → 재배치
    [200, 700].forEach((t) => setTimeout(() => state.listSheet && state.listSheet.enable(false), t));

    // 지난번 선택한 지도 엔진 복원 (기본: 카카오 국내)
    try {
      if (localStorage.getItem("pindiary.mapEngine") === "leaflet") state.engine = "leaflet";
    } catch (_) {}
    updateEngineToggle();

    // 메인 지도 시작 (엔진에 맞춰 부트스트랩 — 카카오 실패 시 Leaflet 폴백).
    // 카카오 SDK는 편집기 지도·국내 검색에도 쓰이므로 로드되면 계속 활용한다.
    bootstrapMap();
    window.addEventListener("resize", fixMapSize);
    window.addEventListener("orientationchange", () => setTimeout(fixMapSize, 300));

    // 서비스워커 등록 (PWA) — 새 버전이 올라오면 자동 반영(캐시 묵힘 방지)
    if ("serviceWorker" in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let refreshed = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshed || !hadController) return; // 첫 설치 땐 새로고침 안 함
        refreshed = true;
        location.reload();
      });
      navigator.serviceWorker.register("sw.js").then((reg) => { reg.update(); }).catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
