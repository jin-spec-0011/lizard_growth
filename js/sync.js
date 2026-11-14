// 클라우드 동기화 (Firebase RTDB, owner 계정).
// 원칙: 기기 저장(IndexedDB)이 먼저, 로그인돼 있으면 /users/{uid} 와 날짜별로 동기화.
//  - 충돌 해결: 날짜(항목)별 "마지막 저장 우선". 기준 시각은 서버 타임스탬프(updatedAt).
//  - 삭제: 삭제 표시(tombstone) {deleted:true, updatedAt} 로 다른 기기에 전파.
//  - 아직 올리지 못한 변경(dirty)은 기기에 남겨 두고 다음 동기화 때 다시 보낸다.
// 아래 순수 함수(mergeRemote, buildPush)는 DOM·네트워크 없이 테스트한다.
import { sanitizeState, normalizeEntry, isValidYmd, FED_VALUES, MEMO_MAX, WEIGHT_MIN, WEIGHT_MAX } from './calc.js';

export const SV_TS = { '.sv': 'timestamp' };

export function emptyMeta(uid = '') {
  return { uid, entryTs: {}, settingsTs: 0, dirty: {}, settingsDirty: false, lastSync: 0 };
}

export function sanitizeMeta(raw, uid) {
  const m = emptyMeta(uid);
  if (!raw || typeof raw !== 'object' || raw.uid !== uid) return m; // 다른 계정이면 새로 시작
  for (const [d, ts] of Object.entries(raw.entryTs || {})) if (isValidYmd(d) && Number.isFinite(ts)) m.entryTs[d] = ts;
  for (const d of Object.keys(raw.dirty || {})) if (isValidYmd(d)) m.dirty[d] = 1;
  if (Number.isFinite(raw.settingsTs)) m.settingsTs = raw.settingsTs;
  m.settingsDirty = raw.settingsDirty === true;
  if (Number.isFinite(raw.lastSync)) m.lastSync = raw.lastSync;
  return m;
}

/** 로컬 변경 표시 */
export function markDirty(meta, { dates = [], settings = false } = {}) {
  for (const d of dates) if (isValidYmd(d)) meta.dirty[d] = 1;
  if (settings) meta.settingsDirty = true;
  return meta;
}

function toRemoteEntry(e) {
  const out = {};
  if (typeof e.weight === 'number') out.weight = e.weight;
  if (FED_VALUES.includes(e.fed)) out.fed = e.fed;
  if (typeof e.memo === 'string' && e.memo) out.memo = e.memo.slice(0, MEMO_MAX);
  if (typeof e.temp === 'number') out.temp = e.temp;
  if (typeof e.hum === 'number') out.hum = e.hum;
  return out;
}

function toRemoteSettings(s) {
  const out = { birth: s.birth, ratio: s.ratio, intervalDays: s.intervalDays, species: s.species, updatedAt: SV_TS };
  if (s.species === 'custom' && s.thresholds) out.thresholds = { ...s.thresholds };
  return out;
}

/**
 * 올릴 내용 계산.
 * @returns {{entries: object|null, settings: object|null, dates: string[]}}
 *  entries 는 /users/{uid}/entries 에 PATCH 할 객체 (날짜 → 항목 또는 삭제 표시)
 */
export function buildPush(state, meta) {
  const dates = Object.keys(meta.dirty).sort();
  let entries = null;
  if (dates.length) {
    entries = {};
    for (const d of dates) {
      const e = state.entries[d];
      const body = e ? toRemoteEntry(e) : {};
      if (!Object.keys(body).length) body.deleted = true;
      body.updatedAt = SV_TS;
      entries[d] = body;
    }
  }
  const settings = meta.settingsDirty && isValidYmd(state.settings.birth) ? toRemoteSettings(state.settings) : null;
  return { entries, settings, dates };
}

/** 원격 항목 1개 검증 → 정상 항목 | {deleted:true} | null(무시) */
function parseRemoteEntry(r) {
  if (!r || typeof r !== 'object' || !Number.isFinite(r.updatedAt)) return null;
  if (r.deleted === true) return { deleted: true, updatedAt: r.updatedAt };
  const e = normalizeEntry({
    weight: typeof r.weight === 'number' && r.weight >= WEIGHT_MIN && r.weight <= WEIGHT_MAX ? r.weight : undefined,
    fed: FED_VALUES.includes(r.fed) ? r.fed : undefined,
    memo: typeof r.memo === 'string' ? r.memo : undefined,
    temp: typeof r.temp === 'number' && r.temp >= -10 && r.temp <= 60 ? r.temp : undefined,
    hum: typeof r.hum === 'number' && r.hum >= 0 && r.hum <= 100 ? r.hum : undefined,
  });
  return e ? { entry: e, updatedAt: r.updatedAt } : { deleted: true, updatedAt: r.updatedAt };
}

/**
 * 원격 데이터(/users/{uid} 전체)를 로컬에 병합.
 * - 아직 못 올린 로컬 변경(dirty)은 로컬 우선
 * - 그 외에는 원격 updatedAt 이 더 새로우면 원격 적용
 * - 한 번도 동기화되지 않은 로컬 항목(entryTs 없음)은 dirty 로 표시해 올리게 함(첫 연결 이관)
 * @returns {{state, meta, changed:boolean, needPush:boolean}}
 */
export function mergeRemote(state, meta, remote) {
  const next = { ...state, settings: { ...state.settings }, entries: { ...state.entries } };
  const m = { ...meta, entryTs: { ...meta.entryTs }, dirty: { ...meta.dirty } };
  let changed = false;
  const rEntries = remote && typeof remote.entries === 'object' && remote.entries ? remote.entries : {};

  for (const [d, raw] of Object.entries(rEntries)) {
    if (!isValidYmd(d) || m.dirty[d]) continue;
    const r = parseRemoteEntry(raw);
    if (!r || r.updatedAt <= (m.entryTs[d] || 0)) continue;
    if (r.deleted) {
      if (next.entries[d]) { delete next.entries[d]; changed = true; }
    } else if (JSON.stringify(next.entries[d]) !== JSON.stringify(r.entry)) {
      next.entries[d] = r.entry;
      changed = true;
    }
    m.entryTs[d] = r.updatedAt;
  }
  // 로컬에만 있고 한 번도 올리지 않은 항목 → 올리기
  for (const d of Object.keys(next.entries)) {
    if (!(d in rEntries) && !m.entryTs[d]) m.dirty[d] = 1;
  }

  // 설정
  const rs = remote && remote.settings;
  if (rs && Number.isFinite(rs.updatedAt) && !m.settingsDirty && rs.updatedAt > (m.settingsTs || 0)) {
    const cand = sanitizeState({ settings: { ...rs }, entries: {} }).settings;
    if (isValidYmd(cand.birth)) {
      if (JSON.stringify(cand) !== JSON.stringify(next.settings)) { next.settings = cand; changed = true; }
      m.settingsTs = rs.updatedAt;
    }
  } else if (!rs && isValidYmd(next.settings.birth) && !m.settingsTs) {
    m.settingsDirty = true;
  }

  const needPush = Object.keys(m.dirty).length > 0 || m.settingsDirty;
  return { state: next, meta: m, changed, needPush };
}

/** 올리기 성공 후 dirty 해제 (그 사이 다시 바뀐 항목은 유지하지 않도록 호출 측에서 스냅샷 기준으로 처리) */
export function clearPushed(meta, dates, settingsPushed) {
  const m = { ...meta, dirty: { ...meta.dirty } };
  for (const d of dates) delete m.dirty[d];
  if (settingsPushed) m.settingsDirty = false;
  return m;
}

/**
 * 동기화 1회 실행 (네트워크).
 * deps: { cloud, getState, setState, getMeta, setMeta }
 * 순서: 올리기 → 받기·병합 → (첫 이관 등으로 새로 생긴 변경) 다시 올리기 → 받기
 */
export async function syncOnce(deps) {
  const { cloud } = deps;
  const uid = cloud.uid();
  if (!uid) throw new Error('로그인이 필요합니다.');
  const base = '/users/' + uid;

  async function push() {
    const st = deps.getState();
    const mt = deps.getMeta();
    const { entries, settings, dates } = buildPush(st, mt);
    if (entries) await cloud.request(base + '/entries', 'PATCH', entries);
    if (settings) await cloud.request(base + '/settings', 'PUT', settings);
    // 올리는 동안 같은 날짜가 또 바뀌었을 수 있으므로, 보낸 내용과 현재 값이 같을 때만 해제
    const now = deps.getState();
    const still = dates.filter((d) => JSON.stringify(now.entries[d] || null) !== JSON.stringify(st.entries[d] || null));
    const done = dates.filter((d) => !still.includes(d));
    const settingsSame = JSON.stringify(now.settings) === JSON.stringify(st.settings);
    await deps.setMeta(clearPushed(deps.getMeta(), done, !!settings && settingsSame));
  }

  async function pull() {
    const remote = await cloud.request(base, 'GET');
    const r = mergeRemote(deps.getState(), deps.getMeta(), remote || {});
    if (r.changed) await deps.setState(r.state);
    await deps.setMeta({ ...r.meta, lastSync: Date.now() });
    return r;
  }

  await push();
  let r = await pull();
  for (let i = 0; i < 2 && r.needPush; i++) {
    await push();
    r = await pull();
  }
  return { changed: r.changed };
}
