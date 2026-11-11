import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, isValidDbUrl, sensorAgeMs, CloudError } from '../js/cloud.js';
import { FIREBASE } from '../js/config.js';

const DB = 'https://lizard-growth-default-rtdb.asia-southeast1.firebasedatabase.app';

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mk(handler, opts = {}) {
  const calls = [];
  let t = opts.t || 1_000_000;
  const store = { v: null };
  const cloud = createCloud({
    apiKey: 'KEY', databaseURL: DB,
    fetchFn: async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); },
    now: () => t,
    load: async () => store.v, save: async (s) => { store.v = JSON.parse(JSON.stringify(s)); }, clear: async () => { store.v = null; },
  });
  return { cloud, calls, store, tick: (ms) => { t += ms; } };
}

test('설정값 형식', () => {
  assert.ok(isValidDbUrl(DB));
  assert.ok(isValidDbUrl('https://x.firebaseio.com'));
  assert.ok(!isValidDbUrl(DB + '/'));
  assert.ok(!isValidDbUrl('http://x.firebaseio.com'));
  assert.ok(!isValidDbUrl('https://evil.example.com'));
  assert.ok(isValidDbUrl(FIREBASE.databaseURL));
  assert.match(FIREBASE.apiKey, /^AIza/);
});

test('로그인 → 토큰 저장(비밀번호는 저장 안 함) → 최신값 읽기', async () => {
  const h = (url) => {
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return res(200, { idToken: 'ID1', refreshToken: 'RF1', expiresIn: '3600', localId: 'UID', email: 'o@x.invalid' });
    if (url.includes('/sensor/latest.json')) return res(200, { ts: 999000, temp: 24.5, hum: 65, vib: 2, reed: true, rssi: -60, evil: '<b>' });
    throw new Error('unexpected ' + url);
  };
  const { cloud, calls, store } = mk(h);
  await cloud.signIn('o@x.invalid', 'pw');
  assert.deepEqual(store.v, { email: 'o@x.invalid', uid: 'UID', refreshToken: 'RF1' });
  assert.ok(!JSON.stringify(store.v).includes('pw'));
  const v = await cloud.fetchLatest();
  assert.deepEqual(v, { ts: 999000, temp: 24.5, hum: 65, vib: 2, reed: true, rssi: -60 }); // 알 수 없는 필드 제거
  assert.equal(calls[1].url, DB + '/sensor/latest.json?auth=ID1');
  assert.equal(JSON.parse(calls[0].init.body).returnSecureToken, true);
});

test('토큰 만료 전 자동 갱신 + refreshToken 교체 저장', async () => {
  const h = (url) => {
    if (url.startsWith('https://identitytoolkit')) return res(200, { idToken: 'ID1', refreshToken: 'RF1', expiresIn: '3600', localId: 'U', email: 'e' });
    if (url.startsWith('https://securetoken')) return res(200, { id_token: 'ID2', refresh_token: 'RF2', expires_in: '3600' });
    return res(200, { ts: 1, temp: 20, hum: 50 });
  };
  const { cloud, calls, store, tick } = mk(h);
  await cloud.signIn('e', 'p');
  await cloud.fetchLatest();
  assert.ok(calls.at(-1).url.includes('auth=ID1'));
  tick(3600 * 1000 - 30 * 1000); // 만료 30초 전 → 1분 여유 규칙에 의해 갱신
  await cloud.fetchLatest();
  assert.ok(calls.at(-1).url.includes('auth=ID2'));
  assert.equal(store.v.refreshToken, 'RF2');
  const refreshCall = calls.find((c) => c.url.startsWith('https://securetoken'));
  assert.equal(refreshCall.init.body, 'grant_type=refresh_token&refresh_token=RF1');
});

test('앱 재시작: restore 후 refreshToken 으로 복구', async () => {
  const h = (url) => (url.startsWith('https://securetoken') ? res(200, { id_token: 'IDX', expires_in: '3600' }) : res(200, { ts: 5, temp: 22, hum: 55 }));
  const a = mk(h);
  a.store.v = { email: 'e', uid: 'U', refreshToken: 'RFX' };
  const s = await a.cloud.restore();
  assert.equal(s.email, 'e');
  const v = await a.cloud.fetchLatest();
  assert.equal(v.temp, 22);
});

test('로그인 오류 메시지 매핑', async () => {
  const { cloud } = mk(() => res(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }));
  await assert.rejects(() => cloud.signIn('e', 'bad'), (e) => e instanceof CloudError && e.code === 'AUTH' && /올바르지/.test(e.message));
});

test('권한 거부(401) / 빈 데이터(null) / 네트워크 오류', async () => {
  const login = { idToken: 'I', refreshToken: 'R', expiresIn: '3600', localId: 'U', email: 'e' };
  let mode = 'deny';
  const h = (url) => {
    if (url.startsWith('https://identitytoolkit')) return res(200, login);
    if (mode === 'deny') return res(401, { error: 'Permission denied' });
    if (mode === 'null') return res(200, null);
    throw new TypeError('offline');
  };
  const { cloud } = mk(h);
  await cloud.signIn('e', 'p');
  await assert.rejects(() => cloud.fetchLatest(), (e) => e.code === 'DENIED');
  mode = 'null';
  assert.equal(await cloud.fetchLatest(), null);
  mode = 'net';
  await assert.rejects(() => cloud.fetchLatest(), (e) => e.code === 'NETWORK');
});

test('refreshToken 폐기(4xx) → 로그아웃, 일시 오류(5xx) → 세션 유지', async () => {
  let st = 400;
  const h = (url) => (url.startsWith('https://securetoken') ? res(st, { error: { message: 'TOKEN_EXPIRED' } }) : res(200, {}));
  const a = mk(h);
  a.store.v = { email: 'e', uid: 'U', refreshToken: 'R' };
  await a.cloud.restore();
  await assert.rejects(() => a.cloud.fetchLatest(), (e) => e.code === 'AUTH_EXPIRED');
  assert.equal(a.cloud.session(), null);
  assert.equal(a.store.v, null);

  st = 503;
  const b = mk(h);
  b.store.v = { email: 'e', uid: 'U', refreshToken: 'R' };
  await b.cloud.restore();
  await assert.rejects(() => b.cloud.fetchLatest(), (e) => e.code === 'NETWORK');
  assert.ok(b.cloud.session());
});

test('센서 경과 시간', () => {
  assert.equal(sensorAgeMs({ ts: 1000 }, 61000), 60000);
  assert.equal(sensorAgeMs({ ts: 5000 }, 1000), 0); // 시계 오차
  assert.equal(sensorAgeMs(null, 1000), null);
});
