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
