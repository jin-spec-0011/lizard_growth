import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMeta, sanitizeMeta, markDirty, buildPush, mergeRemote, clearPushed, syncOnce, SV_TS } from '../js/sync.js';
import { emptyState } from '../js/calc.js';

function st(entries = {}, settings = {}) {
  const s = emptyState();
  s.settings = { ...s.settings, birth: '2026-07-25', intervalDays: 3, ...settings };
  s.entries = entries;
  return s;
}

test('첫 연결: 로컬에만 있는 기록과 설정은 올릴 대상으로 표시', () => {
  const r = mergeRemote(st({ '2026-11-10': { weight: 13.5, fed: 'O' } }), emptyMeta('U'), {});
  assert.deepEqual(Object.keys(r.meta.dirty), ['2026-11-10']);
  assert.equal(r.meta.settingsDirty, true);
  assert.equal(r.needPush, true);
  assert.equal(r.changed, false);
});

test('새 기기: 원격 기록·설정을 받아옴', () => {
  const remote = {
    settings: { birth: '2026-07-25', ratio: 0.15, intervalDays: 3, species: 'crested', updatedAt: 100 },
    entries: { '2026-11-10': { weight: 13.5, fed: 'O', updatedAt: 200 }, '2026-11-11': { memo: '탈피', updatedAt: 210 } },
  };
  const r = mergeRemote(emptyState(), emptyMeta('U'), remote);
  assert.equal(r.state.settings.birth, '2026-07-25');
  assert.equal(r.state.settings.intervalDays, 3);
  assert.deepEqual(r.state.entries['2026-11-10'], { weight: 13.5, fed: 'O' });
  assert.equal(r.meta.entryTs['2026-11-11'], 210);
  assert.equal(r.changed, true);
  assert.equal(r.needPush, false);
});

test('원격이 더 새로우면 적용, 오래됐으면 무시', () => {
  const meta = { ...emptyMeta('U'), entryTs: { '2026-11-10': 500 } };
  const local = st({ '2026-11-10': { weight: 14 } });
  const older = mergeRemote(local, meta, { entries: { '2026-11-10': { weight: 1, updatedAt: 400 } } });
  assert.equal(older.state.entries['2026-11-10'].weight, 14);
  const newer = mergeRemote(local, meta, { entries: { '2026-11-10': { weight: 14.4, updatedAt: 600 } } });
  assert.equal(newer.state.entries['2026-11-10'].weight, 14.4);
});

test('아직 못 올린 로컬 변경은 원격보다 우선', () => {
  const meta = markDirty(emptyMeta('U'), { dates: ['2026-11-10'] });
  const r = mergeRemote(st({ '2026-11-10': { weight: 15 } }), meta, { entries: { '2026-11-10': { weight: 9, updatedAt: 999 } } });
  assert.equal(r.state.entries['2026-11-10'].weight, 15);
  assert.equal(r.needPush, true);
});

test('삭제 표시는 다른 기기에서 삭제로 반영', () => {
  const meta = { ...emptyMeta('U'), entryTs: { '2026-11-10': 100 } };
  const r = mergeRemote(st({ '2026-11-10': { weight: 15 } }), meta, { entries: { '2026-11-10': { deleted: true, updatedAt: 200 } } });
  assert.equal(r.state.entries['2026-11-10'], undefined);
});

test('오염된 원격 값은 걸러냄', () => {
  const r = mergeRemote(emptyState(), emptyMeta('U'), {
    entries: {
      '2026-11-10': { weight: 9999, fed: 'Z', memo: '<b>x</b>', updatedAt: 5 },
      'bad-key': { weight: 1, updatedAt: 5 },
      '2026-11-12': { weight: 3 },
    },
    settings: { birth: 'nope', updatedAt: 9 },
  });
  assert.deepEqual(r.state.entries, { '2026-11-10': { memo: '<b>x</b>' } });
  assert.equal(r.state.settings.birth, '');
});

test('올릴 내용: 항목·삭제 표시·설정, 서버 타임스탬프 사용', () => {
  const meta = markDirty(emptyMeta('U'), { dates: ['2026-11-10', '2026-11-09'], settings: true });
  const p = buildPush(st({ '2026-11-10': { weight: 13.5, memo: '좋음' } }, { species: 'custom', thresholds: { tDL: 1, tCL: 2, tCH: 3, tDH: 4, hDL: 5, hCL: 6, hCH: 7, hDH: 8 } }), meta);
  assert.deepEqual(p.entries['2026-11-10'], { weight: 13.5, memo: '좋음', updatedAt: SV_TS });
  assert.deepEqual(p.entries['2026-11-09'], { deleted: true, updatedAt: SV_TS });
  assert.equal(p.settings.thresholds.hDH, 8);
  assert.deepEqual(p.settings.updatedAt, SV_TS);
  assert.deepEqual(clearPushed(meta, p.dates, true).dirty, {});
});

test('다른 계정의 메타는 버림', () => {
  assert.deepEqual(sanitizeMeta({ uid: 'A', dirty: { '2026-11-10': 1 } }, 'B').dirty, {});
  assert.deepEqual(sanitizeMeta({ uid: 'B', dirty: { '2026-11-10': 1, x: 1 } }, 'B').dirty, { '2026-11-10': 1 });
});

// 두 기기가 같은 원격 DB 를 공유하는 통합 시나리오 (메모리 RTDB 모의)
function fakeDb() {
  let t = 1000;
  const root = { users: {} };
  const resolve = (v) => (v && typeof v === 'object' && v['.sv'] === 'timestamp' ? ++t : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)])) : v);
  const at = (path, create) => {
    const parts = path.split('/').filter(Boolean);
    let o = root;
    for (const p of parts.slice(0, -1)) { if (!o[p]) { if (!create) return [null, null]; o[p] = {}; } o = o[p]; }
    return [o, parts[parts.length - 1]];
  };
  return {
    root,
    request: async (path, method, body) => {
      const [o, k] = at(path, method !== 'GET');
      if (method === 'GET') return o && k in o ? JSON.parse(JSON.stringify(o[k])) : null;
      if (method === 'PUT') { o[k] = resolve(body); return o[k]; }
      if (method === 'PATCH') { o[k] = o[k] || {}; for (const [kk, v] of Object.entries(body)) o[k][kk] = resolve(v); return o[k]; }
      throw new Error('method');
    },
  };
}
function device(db, state) {
  let s = state, m = emptyMeta('U');
  return {
    deps: { cloud: { uid: () => 'U', request: db.request }, getState: () => s, setState: async (x) => { s = x; }, getMeta: () => m, setMeta: async (x) => { m = x; } },
    get state() { return s; }, set state(x) { s = x; }, get meta() { return m; }, set meta(x) { m = x; },
  };
}

test('통합: 기기 A 입력 → 기기 B 조회 → B 수정·삭제 → A 반영', async () => {
  const db = fakeDb();
  const A = device(db, st({ '2026-11-10': { weight: 13.5, fed: 'O' } }));
  const B = device(db, emptyState());
  await syncOnce(A.deps);
  assert.equal(db.root.users.U.entries['2026-11-10'].weight, 13.5);
  assert.equal(db.root.users.U.settings.birth, '2026-07-25');

  await syncOnce(B.deps);
  assert.deepEqual(B.state.entries['2026-11-10'], { weight: 13.5, fed: 'O' });
  assert.equal(B.state.settings.birth, '2026-07-25');

  // B 에서 수정 + 새 날짜 추가 + A 의 날짜 삭제
  B.state = { ...B.state, entries: { '2026-11-11': { memo: '탈피' } } };
  B.meta = markDirty(B.meta, { dates: ['2026-11-10', '2026-11-11'] });
  await syncOnce(B.deps);
  assert.equal(db.root.users.U.entries['2026-11-10'].deleted, true);

  await syncOnce(A.deps);
  assert.equal(A.state.entries['2026-11-10'], undefined);
  assert.deepEqual(A.state.entries['2026-11-11'], { memo: '탈피' });
  assert.deepEqual(A.meta.dirty, {});
});
