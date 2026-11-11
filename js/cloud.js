// Firebase REST 클라이언트 (SDK 미사용, 읽기 전용).
//  - 로그인: Identity Toolkit signInWithPassword → idToken(1시간) + refreshToken
//  - 갱신:   securetoken.googleapis.com (refreshToken)
//  - 읽기:   GET {databaseURL}/sensor/latest.json?auth={idToken}
// 비밀번호는 저장하지 않는다. refreshToken 만 IndexedDB 에 보관한다. 의존성은 주입(fetch/저장소/시계).

const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';
const DB_RE = /^https:\/\/[a-z0-9-]+\.(?:[a-z0-9-]+\.firebasedatabase\.app|firebaseio\.com)$/;
export const STALE_MS = 10 * 60 * 1000; // 센서가 10분 넘게 갱신이 없으면 '응답 없음'
const SKEW_MS = 60 * 1000; // 만료 1분 전에 미리 갱신

export class CloudError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const AUTH_MESSAGES = {
  EMAIL_NOT_FOUND: '등록되지 않은 이메일입니다.',
  INVALID_PASSWORD: '이메일 또는 비밀번호가 올바르지 않습니다.',
  INVALID_LOGIN_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않습니다.',
  INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
  MISSING_PASSWORD: '비밀번호를 입력하세요.',
  USER_DISABLED: '비활성화된 계정입니다.',
  TOO_MANY_ATTEMPTS_TRY_LATER: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
  OPERATION_NOT_ALLOWED: '이메일/비밀번호 로그인이 꺼져 있습니다 (Firebase 콘솔).',
};

function authMessage(body) {
  const raw = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
  const key = raw.split(' ')[0];
  return AUTH_MESSAGES[key] || '로그인에 실패했습니다.' + (key ? ' (' + key + ')' : '');
}

export function isValidDbUrl(u) {
  return typeof u === 'string' && DB_RE.test(u);
}

/** 센서 데이터 경과 시간(ms). 서버 시각(ts) 기준이며 시계 오차로 음수가 되면 0. */
export function sensorAgeMs(latest, nowMs) {
  if (!latest || typeof latest.ts !== 'number') return null;
  return Math.max(0, nowMs - latest.ts);
}

export function createCloud({ apiKey, databaseURL, fetchFn, now = Date.now, load, save, clear }) {
  if (!apiKey || !isValidDbUrl(databaseURL)) throw new Error('Firebase 설정이 올바르지 않습니다.');
  const doFetch = fetchFn || ((...a) => fetch(...a));
  let session = null; // { email, uid, refreshToken }
  let idToken = null;
  let expiresAt = 0;

  async function json(res) {
    try {
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function persist() {
    if (save) await save(session);
  }

  async function restore() {
    const s = load ? await load() : null;
    if (s && typeof s.refreshToken === 'string' && typeof s.email === 'string') {
      session = { email: s.email, uid: typeof s.uid === 'string' ? s.uid : '', refreshToken: s.refreshToken };
    }
    return session;
  }

  async function signOut() {
    session = null;
    idToken = null;
    expiresAt = 0;
    if (clear) await clear();
  }

  async function signIn(email, password) {
    let res;
    try {
      res = await doFetch(AUTH_URL + '?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
    } catch (e) {
      throw new CloudError('NETWORK', '네트워크에 연결할 수 없습니다.');
    }
    const body = await json(res);
    if (!res.ok || !body || !body.idToken || !body.refreshToken) throw new CloudError('AUTH', authMessage(body));
    session = { email: String(body.email || email), uid: String(body.localId || ''), refreshToken: body.refreshToken };
    idToken = body.idToken;
    expiresAt = now() + Number(body.expiresIn || 3600) * 1000;
    await persist();
    return session;
  }

  async function refresh() {
    if (!session) throw new CloudError('AUTH_EXPIRED', '로그인이 필요합니다.');
    let res;
    try {
      res = await doFetch(REFRESH_URL + '?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken),
      });
    } catch (e) {
      throw new CloudError('NETWORK', '네트워크에 연결할 수 없습니다.');
    }
    const body = await json(res);
    if (!res.ok || !body || !body.id_token) {
      // 토큰이 폐기/만료됨 → 로그아웃 처리. 일시 오류(5xx)는 세션 유지.
      if (res.status >= 400 && res.status < 500) {
        await signOut();
        throw new CloudError('AUTH_EXPIRED', '로그인이 만료되었습니다. 다시 로그인하세요.');
      }
      throw new CloudError('NETWORK', '토큰 갱신에 실패했습니다. 잠시 후 다시 시도합니다.');
    }
    idToken = body.id_token;
    expiresAt = now() + Number(body.expires_in || 3600) * 1000;
    if (body.refresh_token && body.refresh_token !== session.refreshToken) {
      session.refreshToken = body.refresh_token;
      await persist();
    }
    return idToken;
  }

  async function getIdToken() {
    if (idToken && expiresAt - SKEW_MS > now()) return idToken;
    return refresh();
  }

  async function readPath(path) {
    const token = await getIdToken();
    let res;
    try {
      res = await doFetch(databaseURL + path + '.json?auth=' + encodeURIComponent(token), { method: 'GET', cache: 'no-store' });
    } catch (e) {
      throw new CloudError('NETWORK', '네트워크에 연결할 수 없습니다.');
    }
    if (res.status === 401 || res.status === 403) throw new CloudError('DENIED', '권한이 없습니다. owner 계정으로 로그인했는지 확인하세요.');
    if (!res.ok) throw new CloudError('HTTP', '서버 오류 (' + res.status + ')');
    return json(res);
  }

  /** @returns {Promise<null|{ts:number,temp:number,hum:number,vib?:number,reed?:boolean,rssi?:number}>} */
  async function fetchLatest() {
    const v = await readPath('/sensor/latest');
    if (v === null || typeof v !== 'object') return null;
    // 서버 규칙이 검증하지만 클라이언트도 신뢰하지 않고 타입을 거른다.
    const out = {};
    if (typeof v.ts === 'number') out.ts = v.ts;
    if (typeof v.temp === 'number') out.temp = v.temp;
    if (typeof v.hum === 'number') out.hum = v.hum;
    if (typeof v.vib === 'number') out.vib = v.vib;
    if (typeof v.reed === 'boolean') out.reed = v.reed;
    if (typeof v.rssi === 'number') out.rssi = v.rssi;
    return typeof out.ts === 'number' ? out : null;
  }

  return { restore, signIn, signOut, getIdToken, fetchLatest, session: () => session };
}
