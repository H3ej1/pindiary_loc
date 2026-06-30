/* app.js — 여기여기 장소 다이어리 메인 로직 */
(function () {
  "use strict";

  // ---------- 상태 ----------
  const state = {
    places: [],
    map: null,
    markers: new Map(), // id -> marker
    editorMap: null,
    editorMarker: null,
    draft: null, // 편집 중인 레코드
    calCursor: null, // 달력 기준 월 (Date)
    selectedDay: null, // 'YYYY-MM-DD'
    catFilter: "all", // 목록 폴더 필터
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

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function starStr(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }

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
      if (state.map) setTimeout(fixMapSize, 60);
    }
    if (name === "folders") renderFoldersHome();
    if (name === "calendar") renderCalendar();
    if (name === "backup") renderBackupStat();
  }

  // ---------- 지도 (메인) — 카카오맵 ----------
  // 카카오 level: 숫자가 작을수록 확대(가까움). 3~4 = 거리/건물 보이는 줌.
  function initMap() {
    const container = document.getElementById("map");
    state.map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(37.5665, 126.978),
      level: 4,
    });
    // 줌 컨트롤만 (스카이뷰 토글은 사용 안 함)
    state.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    // 지도 빈 곳 클릭 → "여기에 북마크 추가" 핀 버튼
    kakao.maps.event.addListener(state.map, "click", (mouseEvent) => onMapClickAdd(mouseEvent.latLng));

    // 현재 위치로 이동 시도
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (state.places.length === 0)
            state.map.setCenter(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
        },
        () => {},
        { timeout: 5000 }
      );
    }
  }

  // 모바일 등에서 컨테이너 크기 확정이 늦어 지도가 빈칸으로 뜨는 것 방지 (relayout)
  function fixMapSize() {
    if (!state.map) return;
    const c = state.map.getCenter();
    state.map.relayout();
    state.map.setCenter(c);
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

  function closeOpenIw() {
    if (state.openIw) { state.openIw.close(); state.openIw = null; }
  }

  function refreshMarkers() {
    if (!state.map) return;
    // 기존 오버레이/말풍선 제거
    (state.overlays || []).forEach((o) => o.setMap(null));
    state.overlays = [];
    state.markers.clear();
    closeOpenIw();

    // 같은 위치 북마크 그룹핑
    const groups = new Map();
    state.places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const k = coordKey(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });

    const bounds = new kakao.maps.LatLngBounds();
    let any = false;

    groups.forEach((places) => {
      const lat = places[0].lat, lng = places[0].lng;
      const pos = new kakao.maps.LatLng(lat, lng);

      // 폴더색 핀 + 이름 라벨을 커스텀 오버레이로
      const fc = folderById(places[0].category);
      const color = fc ? fc.color : "#ff6b6b";
      const label = places.length > 1 ? `${places[0].name} +${places.length - 1}` : places[0].name;
      const el = document.createElement("div");
      el.className = "kk-pin-wrap";
      el.innerHTML =
        `<div class="kk-label">${escapeHtml(label)}</div>` +
        `<div class="cat-marker" style="background:${color}"><span class="cat-marker-dot"></span></div>`;

      const overlay = new kakao.maps.CustomOverlay({
        position: pos, content: el, xAnchor: 0.5, yAnchor: 1, zIndex: 3, clickable: true,
      });
      overlay.setMap(state.map);

      // 그룹 말풍선(간략 목록) — 클릭 시 열림
      const iw = new kakao.maps.InfoWindow({ position: pos, content: groupPopupHtml(places), removable: true });
      el.addEventListener("click", () => {
        closeOpenIw();
        iw.open(state.map);
        state.openIw = iw;
        setTimeout(() => {
          document.querySelectorAll(".popup-item").forEach((it) => {
            it.onclick = () => openViewer(it.dataset.id);
          });
        }, 0);
        focusListItem(places[0].id);
      });

      // 그룹 내 모든 id가 같은 오버레이/말풍선을 가리키도록(focus/이동용)
      places.forEach((p) => state.markers.set(p.id, { overlay, iw, pos }));
      bounds.extend(pos);
      any = true;
    });

    if (any && !state._fitted) {
      state.map.setBounds(bounds);
      state._fitted = true;
    }
  }

  // 지도 클릭 → 임시 핀 + "여기에 북마크 추가" 버튼 (흰 말풍선 박스 없이 버튼만)
  function onMapClickAdd(latLng) {
    const lat = latLng.getLat(), lng = latLng.getLng();
    clearTempMarker();
    const el = document.createElement("div");
    el.className = "kk-add-wrap";
    el.innerHTML =
      `<button class="popup-add-btn" type="button">📍 여기에 북마크 추가</button>` +
      `<div class="cat-marker add-pin"><span class="add-plus">＋</span></div>`;
    el.querySelector(".popup-add-btn").addEventListener("click", () => startAddAt(lat, lng));
    state.tempOverlay = new kakao.maps.CustomOverlay({
      position: latLng, content: el, xAnchor: 0.5, yAnchor: 1, zIndex: 6, clickable: true,
    });
    state.tempOverlay.setMap(state.map);
  }

  function clearTempMarker() {
    if (state.tempOverlay) { state.tempOverlay.setMap(null); state.tempOverlay = null; }
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
    if (state.map) { state.map.setCenter(new kakao.maps.LatLng(lat, lng)); state.map.setLevel(3); }
    openEditor(null);
    state.draft.lat = lat;
    state.draft.lng = lng;
    state.draft.name = name;
    state.draft.address = addr;
    $("#place-name").value = name;
    $("#place-address").value = addr;
  }

  // 지도 탭 검색창: 장소 검색 → 결과 클릭 시 바로 추가
  function mapSearch(query) {
    const box = $("#map-search-results");
    if (!box) return;
    if (!(window.kakao && kakao.maps && kakao.maps.services)) { box.innerHTML = "<li>검색 모듈 로드 실패</li>"; return; }
    box.innerHTML = "<li>검색 중…</li>";
    const ps = new kakao.maps.services.Places();
    const opts = {};
    if (state.map) { opts.location = state.map.getCenter(); opts.radius = 20000; }
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length) {
        box.innerHTML = "";
        data.slice(0, 12).forEach((place) => {
          const lat = parseFloat(place.y), lng = parseFloat(place.x);
          const name = place.place_name || "이름 미상";
          const addr = place.road_address_name || place.address_name || "";
          const li = document.createElement("li");
          li.innerHTML = `<div class="r-name">${escapeHtml(name)}</div><div class="r-addr">${escapeHtml(addr)}</div>`;
          li.addEventListener("click", () => {
            box.innerHTML = "";
            $("#map-search-input").value = "";
            startAddAtPlace(name, addr, lat, lng);
          });
          box.appendChild(li);
        });
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        box.innerHTML = "<li>검색 결과가 없어요.</li>";
      } else {
        box.innerHTML = "<li>검색 실패 (네트워크 확인).</li>";
      }
    }, opts);
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
      if (!state.map) return;
      state.map.setLevel(3);
      state.map.setCenter(new kakao.maps.LatLng(p.lat, p.lng));
      const mk = state.markers.get(id);
      if (mk) {
        closeOpenIw();
        mk.iw.open(state.map);
        state.openIw = mk.iw;
        setTimeout(() => {
          document.querySelectorAll(".popup-item").forEach((it) => { it.onclick = () => openViewer(it.dataset.id); });
        }, 0);
      }
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

  function initEditorMap() {
    const d = state.draft;
    const center = d.lat != null ? new kakao.maps.LatLng(d.lat, d.lng) : new kakao.maps.LatLng(37.5665, 126.978);
    const container = document.getElementById("editor-map");
    if (!state.editorMap) {
      state.editorMap = new kakao.maps.Map(container, { center, level: d.lat != null ? 3 : 7 });
      state.editorMap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
      kakao.maps.event.addListener(state.editorMap, "click", (me) => {
        setEditorPin(me.latLng.getLat(), me.latLng.getLng(), true);
      });
    } else {
      state.editorMap.setCenter(center);
      state.editorMap.setLevel(d.lat != null ? 3 : 7);
    }
    setTimeout(() => state.editorMap.relayout(), 60);
    if (d.lat != null) setEditorPin(d.lat, d.lng, false);
    else if (state.editorMarker) {
      state.editorMarker.setMap(null);
      state.editorMarker = null;
    }
  }

  function setEditorPin(lat, lng, reverse) {
    state.draft.lat = lat;
    state.draft.lng = lng;
    const pos = new kakao.maps.LatLng(lat, lng);
    if (state.editorMarker) state.editorMarker.setPosition(pos);
    else state.editorMarker = new kakao.maps.Marker({ position: pos, map: state.editorMap });
    state.editorMap.panTo(pos);
    if (reverse) reverseGeocode(lat, lng);
  }

  // ---------- 지오코딩 (Nominatim, 무료) ----------
  function searchPlace(query) {
    const results = $("#search-results");
    // 먼저 링크 붙여넣기 좌표 추출 시도
    const coords = extractCoords(query);
    if (coords) {
      results.innerHTML = "";
      setEditorPin(coords.lat, coords.lng, true);
      if (state.editorMap) { state.editorMap.setCenter(new kakao.maps.LatLng(coords.lat, coords.lng)); state.editorMap.setLevel(3); }
      toast("링크에서 좌표를 찾았어요");
      return;
    }
    if (!(window.kakao && kakao.maps && kakao.maps.services)) {
      results.innerHTML = `<li>검색 모듈 로드 실패 (인터넷 확인)</li>`;
      return;
    }
    results.innerHTML = `<li>검색 중…</li>`;
    const ps = new kakao.maps.services.Places();
    const opts = {};
    if (state.editorMap) { opts.location = state.editorMap.getCenter(); opts.radius = 20000; }
    // 카카오 키워드 검색 — 한국 상호·주소에 강하고 띄어쓰기 차이도 잘 처리
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        results.innerHTML = "";
        data.slice(0, 12).forEach((place) => {
          const lat = parseFloat(place.y), lng = parseFloat(place.x);
          const name = place.place_name || "이름 미상";
          const addr = place.road_address_name || place.address_name || "";
          const li = document.createElement("li");
          li.innerHTML = `<div class="r-name">${escapeHtml(name)}</div><div class="r-addr">${escapeHtml(addr)}</div>`;
          li.addEventListener("click", () => {
            if (!$("#place-name").value) $("#place-name").value = name;
            $("#place-address").value = addr;
            state.draft.name = $("#place-name").value;
            state.draft.address = addr;
            setEditorPin(lat, lng, false);
            if (state.editorMap) { state.editorMap.setCenter(new kakao.maps.LatLng(lat, lng)); state.editorMap.setLevel(3); }
            results.innerHTML = "";
          });
          results.appendChild(li);
        });
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        results.innerHTML = `<li>검색 결과가 없어요. 지도를 직접 눌러 위치를 찍어보세요.</li>`;
      } else {
        results.innerHTML = `<li>검색 실패 (네트워크 확인). 지도를 직접 눌러도 됩니다.</li>`;
      }
    }, opts);
  }

  function reverseGeocode(lat, lng) {
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
    ctx.fillText("여기여기 · 장소 다이어리", W - padding, H - 40);
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
      ? "저장 위치(폴더)를 직접 고를 수 있어요. 처음 한 번 고르면 '여기여기 내보내기' 폴더에 모읍니다."
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
          state.exportDir = await root.getDirectoryHandle("여기여기 내보내기", { create: true });
        }
        const fh = await state.exportDir.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        toast(`'여기여기 내보내기' 폴더에 저장했어요`);
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
  }

  function exportJSON() {
    const data = { app: "yeogi-yeogi", version: 2, exportedAt: new Date().toISOString(), folders: state.folders, places: state.places };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `yeogiyeogi-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("백업 파일을 내보냈어요 📦");
  }

  async function importJSON(file) {
    try {
      const text = await file.text();
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
    } catch (e) {
      toast("불러오기 실패: 올바른 백업 파일이 아니에요");
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
          if (state.editorMap) { state.editorMap.setCenter(new kakao.maps.LatLng(coords.lat, coords.lng)); state.editorMap.setLevel(3); }
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

    // 모달 배경 클릭으로 닫기
    $$(".modal").forEach((m) =>
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m.id);
      })
    );
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

    // 카카오맵 로드 후 지도/마커 초기화 (autoload=false 사용)
    if (window.kakao && kakao.maps && kakao.maps.load) {
      kakao.maps.load(() => {
        initMap();
        refreshMarkers();
        // 모바일: 레이아웃 확정이 늦어 지도가 빈칸으로 뜨는 것 방지 (여러 번 relayout)
        [150, 500, 1200].forEach((t) => setTimeout(fixMapSize, t));
      });
    }
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
