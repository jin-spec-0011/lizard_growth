// 순수 계산 모듈 (DOM·저장소 의존 없음). 엑셀 템플릿 '성장일지' 시트의 수식과 동일한 결과를 내도록 구현.
// 날짜는 'YYYY-MM-DD' 문자열, 내부 연산은 UTC 기준 일(day) 정수로 처리해 시간대/DST 오차를 제거한다.

export const ROWS = 366; // 템플릿 A5:A370 (출생일 ~ +365일)
export const WEIGHT_MIN = 0.01;
export const WEIGHT_MAX = 200; // 템플릿 데이터 유효성(0~200g)과 동일
export const MEMO_MAX = 200;
export const FED_VALUES = ['O', 'X', '예정'];
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidYmd(s) {
  if (typeof s !== 'string') return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function ymdToDay(ymd) {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error('잘못된 날짜: ' + ymd);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

export function dayToYmd(day) {
  const d = new Date(day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

export function addDays(ymd, n) {
  return dayToYmd(ymdToDay(ymd) + n);
}

export function diffDays(a, b) {
  return ymdToDay(a) - ymdToDay(b);
}

export function dowOf(ymd) {
  return new Date(ymdToDay(ymd) * 86400000).getUTCDay();
}

export function localTodayYmd(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
}

/** 엑셀 ROUND(x, 2) 와 동일 (half away from zero, 부동소수 오차 보정) */
export function round2(x) {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  // 엑셀은 15자리 유효숫자로 정규화한 뒤 반올림한다 (예: 4.1*0.15 = 0.6149999… → 0.615 → 0.62)
  const s = String(Number(a.toPrecision(15)));
  const r = s.includes('e') ? Math.round(a * 100) / 100 : Number(Math.round(Number(s + 'e2')) + 'e-2');
  return sign * r;
}

/** 부동소수 노이즈 제거 (변화량 등 표시/내보내기용) */
export function clean(x) {
  return Math.round(x * 1e8) / 1e8;
}

export function defaultSettings() {
  return {
    birth: '',
    ratio: 0.15,
    intervalDays: 2,
    species: 'crested',
    thresholds: null, // species==='custom' 일 때만 사용
  };
}

export function emptyState() {
  return { version: 1, settings: defaultSettings(), entries: {}, lastBackup: '' };
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 366행 계산 (엑셀 D/E 열 수식과 동일).
 * D: C 가 있고 이전 측정이 있으면 C − 직전 측정
 * E: (C 또는 F 가 있고) 지금까지 측정이 한 번이라도 있으면 ROUND(최근 측정 × 급여율, 2)
 */
export function buildRows(state) {
  const { birth, ratio } = state.settings;
  if (!isValidYmd(birth)) return [];
  const b = ymdToDay(birth);
  const rows = [];
  let lastW = null;
  for (let i = 0; i < ROWS; i++) {
    const date = dayToYmd(b + i);
    const e = state.entries[date] || {};
    const w = numOrNull(e.weight);
    const fed = FED_VALUES.includes(e.fed) ? e.fed : '';
    const memo = typeof e.memo === 'string' ? e.memo : '';
    const change = w !== null && lastW !== null ? clean(w - lastW) : null;
    const hadAnyWeight = lastW !== null || w !== null;
    const latest = w !== null ? w : lastW;
    const rec = hadAnyWeight && !(w === null && fed === '') ? round2(latest * ratio) : null;
    rows.push({
      date, age: i, weight: w, change, rec, fed, memo,
      temp: numOrNull(e.temp), hum: numOrNull(e.hum),
    });
    if (w !== null) lastW = w;
  }
  return rows;
}

/** 엑셀 D2:G2 와 동일: 현재 일령 / 현재 체중 / 누적 증가량 / 평균 일증체 */
export function summary(state, today, rows = buildRows(state)) {
  const out = { age: null, weight: null, weightDate: null, gain: null, avgDaily: null };
  const { birth } = state.settings;
  if (!isValidYmd(birth)) return out;
  out.age = diffDays(today, birth);
  let last = null;
  for (const r of rows) if (r.weight !== null) last = r;
  if (last) {
    out.weight = last.weight;
    out.weightDate = last.date;
    const first = rows[0] && rows[0].weight; // 엑셀 F2: E2 − C5 (출생일 행 체중)
    if (first !== null && first !== undefined) {
      out.gain = clean(last.weight - first);
      const span = last.age; // INDEX(A, 마지막측정) − A5
      if (span > 0) out.avgDaily = out.gain / span;
    }
  }
  return out;
}

/**
 * 다음 급여일.
 * 1) 오늘~미래의 '예정' 중 가장 빠른 날짜 우선
 * 2) 없으면 (마지막 'O' 날짜 + 급여주기). 급여 기록이 없으면 오늘.
 * status: done(오늘 급여 완료) | due(오늘) | overdue(지연) | upcoming(미래) | planned(예정일)
 */
export function nextFeeding(state, today) {
  const { birth, intervalDays } = state.settings;
  if (!isValidYmd(birth)) return null;
  const dates = Object.keys(state.entries).sort();
  let lastFed = null;
  let planned = null;
  for (const d of dates) {
    const f = state.entries[d].fed;
    if (f === 'O' && d <= today) lastFed = d;
    if (f === '예정' && d >= today && (planned === null || d < planned)) planned = d;
  }
  const todayFed = state.entries[today] && state.entries[today].fed === 'O';
  let date;
  let status;
  if (planned) {
    date = planned;
    status = planned === today ? 'due' : 'planned';
  } else if (lastFed) {
    date = addDays(lastFed, intervalDays);
    const gap = diffDays(date, today);
    status = gap === 0 ? 'due' : gap < 0 ? 'overdue' : 'upcoming';
  } else {
    date = today;
    status = 'due';
  }
  if (todayFed && status !== 'planned') status = 'done';
  const overdueDays = status === 'overdue' ? diffDays(today, date) : 0;
  const daysUntil = diffDays(date, today);
  return { status, date, daysUntil, overdueDays, lastFed, todayFed: !!todayFed };
}

/** 홈 카드용 권장 급여량: 오늘 이전 가장 최근 체중 × 급여율 (없으면 null) */
export function recommendedNow(state, today, rows = buildRows(state)) {
  let w = null;
  for (const r of rows) {
    if (r.date > today) break;
    if (r.weight !== null) w = r.weight;
  }
  return w === null ? null : round2(w * state.settings.ratio);
}

/** 입력 시트 미리보기용: 이 날짜의 일령/변화량/권장량 (저장 전 가정 값 반영) */
export function previewRow(state, date, draft) {
  const trial = {
    ...state,
    entries: { ...state.entries, [date]: { ...(state.entries[date] || {}), ...draft } },
  };
  const rows = buildRows(trial);
  return rows.find((r) => r.date === date) || null;
}

/** 입력 검증. 오류 메시지 배열 반환(빈 배열이면 통과). */
export function validateEntry(state, date, draft) {
  const errs = [];
  const { birth } = state.settings;
  if (!isValidYmd(date)) errs.push('날짜 형식이 올바르지 않습니다.');
  else if (isValidYmd(birth)) {
    const off = diffDays(date, birth);
    if (off < 0 || off >= ROWS) errs.push('날짜는 출생일부터 365일 이내여야 합니다.');
  }
  if (draft.weight !== null && draft.weight !== undefined) {
    if (!(typeof draft.weight === 'number' && draft.weight >= WEIGHT_MIN && draft.weight <= WEIGHT_MAX))
      errs.push('체중은 0.01~200 g 숫자만 입력할 수 있습니다.');
  }
  if (draft.fed && !FED_VALUES.includes(draft.fed)) errs.push('급여 여부는 O / X / 예정 중 하나입니다.');
  if (typeof draft.memo === 'string' && draft.memo.length > MEMO_MAX) errs.push('메모는 ' + MEMO_MAX + '자 이내입니다.');
  if (draft.temp !== null && draft.temp !== undefined && !(typeof draft.temp === 'number' && draft.temp >= -10 && draft.temp <= 60))
    errs.push('온도는 -10~60 °C 범위입니다.');
  if (draft.hum !== null && draft.hum !== undefined && !(typeof draft.hum === 'number' && draft.hum >= 0 && draft.hum <= 100))
    errs.push('습도는 0~100 % 범위입니다.');
  return errs;
}

/** 빈 값 정리: 모든 필드가 비면 항목 자체를 삭제 */
export function normalizeEntry(e) {
  const out = {};
  if (typeof e.weight === 'number') out.weight = e.weight;
  if (FED_VALUES.includes(e.fed)) out.fed = e.fed;
  if (typeof e.memo === 'string' && e.memo.trim() !== '') out.memo = e.memo.trim().slice(0, MEMO_MAX);
  if (typeof e.temp === 'number') out.temp = e.temp;
  if (typeof e.hum === 'number') out.hum = e.hum;
  return Object.keys(out).length ? out : null;
}

/** 상태 전체 검증/정화 (가져오기·IndexedDB 복원 시 신뢰하지 않고 재구성) */
export function sanitizeState(raw) {
  const st = emptyState();
  if (!raw || typeof raw !== 'object') return st;
  const s = raw.settings || {};
  if (isValidYmd(s.birth)) st.settings.birth = s.birth;
  if (typeof s.ratio === 'number' && s.ratio > 0 && s.ratio <= 1) st.settings.ratio = s.ratio;
  if (Number.isInteger(s.intervalDays) && s.intervalDays >= 1 && s.intervalDays <= 30) st.settings.intervalDays = s.intervalDays;
  if (['crested', 'leopard', 'custom'].includes(s.species)) st.settings.species = s.species;
  if (s.thresholds && typeof s.thresholds === 'object') {
    const t = {};
    for (const k of ['tDL', 'tCL', 'tCH', 'tDH', 'hDL', 'hCL', 'hCH', 'hDH']) {
      if (typeof s.thresholds[k] === 'number' && Number.isFinite(s.thresholds[k])) t[k] = s.thresholds[k];
    }
    if (Object.keys(t).length === 8) st.settings.thresholds = t;
  }
  if (st.settings.species === 'custom' && !st.settings.thresholds) st.settings.species = 'crested';
  if (isValidYmd(raw.lastBackup)) st.lastBackup = raw.lastBackup;
  const src = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
  for (const d of Object.keys(src)) {
    if (!isValidYmd(d)) continue;
    const e = src[d] || {};
    const clean1 = {
      weight: typeof e.weight === 'number' && e.weight >= WEIGHT_MIN && e.weight <= WEIGHT_MAX ? e.weight : undefined,
      fed: FED_VALUES.includes(e.fed) ? e.fed : undefined,
      memo: typeof e.memo === 'string' ? e.memo : undefined,
      temp: typeof e.temp === 'number' && e.temp >= -10 && e.temp <= 60 ? e.temp : undefined,
      hum: typeof e.hum === 'number' && e.hum >= 0 && e.hum <= 100 ? e.hum : undefined,
    };
    const n = normalizeEntry(clean1);
    if (n) st.entries[d] = n;
  }
  return st;
}
