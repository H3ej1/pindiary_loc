/* db.js — IndexedDB 래퍼 (장소 기록 저장. 서버 없음, 전부 로컬) */
(function () {
  const DB_NAME = "yeogi-yeogi";
  const DB_VERSION = 2;
  const STORE = "places";
  const STORE_FOLDERS = "folders"; // 사용자 정의 폴더(이름·색)
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("date", "date", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, storeName) {
    return open().then((db) => db.transaction(storeName || STORE, mode).objectStore(storeName || STORE));
  }

  const DB = {
    async getAll() {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async get(id) {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },
    async put(record) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      });
    },
    async remove(id) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async bulkPut(records) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        let pending = records.length;
        if (!pending) return resolve();
        records.forEach((r) => {
          const req = store.put(r);
          req.onsuccess = () => { if (--pending === 0) resolve(); };
          req.onerror = () => reject(req.error);
        });
      });
    },

    // ----- 폴더 -----
    async getFolders() {
      const store = await tx("readonly", STORE_FOLDERS);
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async putFolder(folder) {
      const store = await tx("readwrite", STORE_FOLDERS);
      return new Promise((resolve, reject) => {
        const req = store.put(folder);
        req.onsuccess = () => resolve(folder);
        req.onerror = () => reject(req.error);
      });
    },
    async removeFolder(id) {
      const store = await tx("readwrite", STORE_FOLDERS);
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async bulkPutFolders(folders) {
      const store = await tx("readwrite", STORE_FOLDERS);
      return new Promise((resolve, reject) => {
        let pending = folders.length;
        if (!pending) return resolve();
        folders.forEach((f) => {
          const req = store.put(f);
          req.onsuccess = () => { if (--pending === 0) resolve(); };
          req.onerror = () => reject(req.error);
        });
      });
    },
  };

  window.PlaceDB = DB;
})();
