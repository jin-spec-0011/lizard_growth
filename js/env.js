// 온습도 → 상태/이모지 판정 (순수 함수).
// 임계값: DL/DH = 위험 하한/상한, CL/CH = 주의 하한/상한. DL < CL < CH < DH 이어야 한다.
// 프리셋은 일반적인 사육 가이드 수치이며 개체·환경에 맞게 설정에서 조정하세요.

export const PRESETS = {
  crested: {
    name: '크레스티드 게코',
    tDL: 20, tCL: 22, tCH: 26, tDH: 28,
    hDL: 40, hCL: 50, hCH: 80, hDH: 85,
  },
  leopard: {
    name: '레오파드 게코',
    tDL: 22, tCL: 24, tCH: 29, tDH: 32,
    hDL: 20, hCL: 30, hCH: 50, hDH: 60,
  },
};

export const THRESHOLD_KEYS = ['tDL', 'tCL', 'tCH', 'tDH', 'hDL', 'hCL', 'hCH', 'hDH'];

export function thresholdsFor(settings) {
  if (settings.species === 'custom' && settings.thresholds) return settings.thresholds;
  const p = PRESETS[settings.species] || PRESETS.crested;
  const t = {};
  for (const k of THRESHOLD_KEYS) t[k] = p[k];
  return t;
}

export function validateThresholds(t) {
  const errs = [];
  for (const k of THRESHOLD_KEYS) if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) errs.push('임계값은 숫자여야 합니다.');
  if (errs.length) return errs;
  if (!(t.tDL < t.tCL && t.tCL < t.tCH && t.tCH < t.tDH)) errs.push('온도: 위험하한 < 주의하한 < 주의상한 < 위험상한 순이어야 합니다.');
  if (!(t.hDL < t.hCL && t.hCL < t.hCH && t.hCH < t.hDH)) errs.push('습도: 위험하한 < 주의하한 < 주의상한 < 위험상한 순이어야 합니다.');
  return errs;
}

// level: 0 정상, 1 주의, 2 위험
function judge(v, DL, CL, CH, DH, face) {
  if (v < DL) return { level: 2, emoji: face.dl, label: face.ldl };
  if (v < CL) return { level: 1, emoji: face.cl, label: face.lcl };
  if (v <= CH) return { level: 0, emoji: '😊', label: face.lok };
  if (v <= DH) return { level: 1, emoji: face.ch, label: face.lch };
  return { level: 2, emoji: face.dh, label: face.ldh };
}

const T_FACE = {
  dl: '🥶', ldl: '너무 추워요', cl: '😐', lcl: '조금 쌀쌀해요', lok: '온도 적정',
  ch: '😓', lch: '조금 더워요', dh: '🥵', ldh: '너무 더워요',
};
const H_FACE = {
  dl: '🏜️', ldl: '너무 건조해요', cl: '😕', lcl: '조금 건조해요', lok: '습도 적정',
  ch: '💦', lch: '조금 습해요', dh: '🌊', ldh: '너무 습해요',
};

/** @returns {null | {temp, hum, overall}} 값이 하나도 없으면 null */
export function judgeEnv(temp, hum, t) {
  const hasT = typeof temp === 'number' && Number.isFinite(temp);
  const hasH = typeof hum === 'number' && Number.isFinite(hum);
  if (!hasT && !hasH) return null;
  const jt = hasT ? judge(temp, t.tDL, t.tCL, t.tCH, t.tDH, T_FACE) : null;
  const jh = hasH ? judge(hum, t.hDL, t.hCL, t.hCH, t.hDH, H_FACE) : null;
  let worst = jt;
  if (jh && (!jt || jh.level > jt.level)) worst = jh;
  const overall =
    worst.level === 0
      ? { level: 0, emoji: '😊', label: '쾌적해요' }
      : { level: worst.level, emoji: worst.emoji, label: worst.label };
  return { temp: jt, hum: jh, overall };
}
