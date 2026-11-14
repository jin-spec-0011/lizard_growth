// 로컬 저장소 (IndexedDB). 데이터는 이 기기 밖으로 나가지 않는다.
// IndexedDB 를 쓸 수 없는 환경(일부 사생활 보호 모드)에서는 메모리로 폴백하고 persistent=false 를 알린다.
import { emptyState, sanitizeState } from './calc.js';

const DB_NAME = 'lizard-growth';
const STORE = 'kv';
const KEY = 'state';

let mem = null;
export let persistent = true;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('indexedDB 없음'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DB 차단됨'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('트랜잭션 중단'));
  });
}

export async function loadState() {
  try {
    const db = await openDb();
    const raw = await tx(db, 'readonly', (s) => s.get(KEY));
    db.close();
    return sanitizeState(raw);
  } catch (e) {
    persistent = false;
    return mem ? sanitizeState(mem) : emptyState();
  }
}

export async function saveState(state) {
  mem = JSON.parse(JSON.stringify(state));
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.put(mem, KEY));
    db.close();
    persistent = true;
    return true;
  } catch (e) {
    persistent = false;
    return false;
  }
}

export async function wipeAll() {
  mem = null;
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.clear());
    db.close();
  } catch (e) {
    /* 폴백 모드: 메모리만 비움 */
  }
}

/** 브라우저가 저장소를 임의로 비우지 않도록 요청 (실패해도 무방) */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {
    /* ignore */
  }
  return false;
}

// ---- 센서 연동 세션 (refreshToken 만 저장, 비밀번호는 저장하지 않음) ----
const CLOUD_KEY = 'cloud';

export async function loadCloud() {
  try {
    const db = await openDb();
    const v = await tx(db, 'readonly', (s) => s.get(CLOUD_KEY));
    db.close();
    return v || null;
  } catch (e) {
    return null;
  }
}

export async function saveCloud(session) {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.put(session, CLOUD_KEY));
    db.close();
  } catch (e) {
    /* 저장 불가 환경: 이번 세션 동안만 유지 */
  }
}

export async function clearCloud() {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.delete(CLOUD_KEY));
    db.close();
  } catch (e) {
    /* ignore */
  }
}

// ---- 클라우드 동기화 메타(항목별 서버 시각, 아직 못 올린 변경 목록) ----
const SYNC_KEY = 'sync';

export async function loadSyncMeta() {
  try {
    const db = await openDb();
    const v = await tx(db, 'readonly', (s) => s.get(SYNC_KEY));
    db.close();
    return v || null;
  } catch (e) {
    return null;
  }
}

export async function saveSyncMeta(meta) {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(meta)), SYNC_KEY));
    db.close();
  } catch (e) {
    /* 저장 불가 환경: 메모리에서만 유지 */
  }
}
