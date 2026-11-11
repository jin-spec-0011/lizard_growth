import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRows, summary, nextFeeding, recommendedNow, previewRow, validateEntry,
  round2, emptyState, sanitizeState, addDays, diffDays, dowOf, isValidYmd, ROWS,
} from '../js/calc.js';
import { judgeEnv, thresholdsFor, PRESETS, validateThresholds } from '../js/env.js';

function mk(entries = {}, settings = {}) {
  const s = emptyState();
  s.settings = { ...s.settings, birth: '2026-07-20', ratio: 0.15, intervalDays: 2, ...settings };
  s.entries = entries;
  return s;
}

test('날짜 유틸', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(diffDays('2026-11-11', '2026-07-20'), 114);
  assert.equal(dowOf('2026-11-11'), 3); // 수요일
  assert.ok(!isValidYmd('2026-02-30'));
  assert.ok(isValidYmd('2028-02-29'));
});

test('round2: 엑셀 ROUND 와 동일 (half away from zero)', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(14.2 * 0.15), 2.13);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(4.1 * 0.15), 0.62); // LibreOffice/Excel 재계산과 일치 확인된 사례
});

test('366행 생성, 일령/날짜', () => {
  const rows = buildRows(mk());
  assert.equal(rows.length, ROWS);
  assert.equal(rows[0].date, '2026-07-20');
  assert.equal(rows[0].age, 0);
  assert.equal(rows[365].date, '2027-07-20');
});

test('D(변화량)·E(권장급여) 엑셀 수식 동일', () => {
  const st = mk({
    '2026-07-20': { weight: 2.6, fed: 'O' },
    '2026-07-22': { weight: 2.9 },
    '2026-07-23': { weight: 2.7, fed: 'X' },
    '2026-07-24': { fed: '예정' },
  });
  const r = buildRows(st);
  assert.equal(r[0].change, null); // D5 = ""
  assert.equal(r[0].rec, 0.39); // 2.6*0.15
  assert.equal(r[1].weight, null);
  assert.equal(r[1].change, null);
  assert.equal(r[1].rec, null); // C,F 공란 → 공란
  assert.equal(r[2].change, 0.3);
  assert.equal(r[2].rec, 0.44); // 2.9*0.15=0.435 → 0.44
  assert.equal(r[3].change, -0.2);
  assert.equal(r[4].weight, null);
  assert.equal(r[4].rec, 0.41); // F 만 있어도 최근 체중(2.7)×0.15=0.405 → 0.41
  assert.equal(r[5].rec, null);
});

test('체중이 전혀 없으면 E 공란', () => {
  const r = buildRows(mk({ '2026-07-21': { fed: 'O' } }));
  assert.equal(r[1].rec, null);
});

test('요약(D2:G2) = 엑셀 헤더 수식', () => {
  const st = mk({ '2026-07-20': { weight: 2.6 }, '2026-11-10': { weight: 14.2 } });
  const s = summary(st, '2026-11-11');
  assert.equal(s.age, 114);
  assert.equal(s.weight, 14.2);
  assert.equal(s.gain, 11.6);
  assert.ok(Math.abs(s.avgDaily - 11.6 / 113) < 1e-9); // 마지막 측정일 일령 113
});

test('요약: 출생일 행 체중이 없으면 증가량 공란 (엑셀 F2 동작)', () => {
  const s = summary(mk({ '2026-08-01': { weight: 5 } }), '2026-08-05');
  assert.equal(s.gain, null);
  assert.equal(s.avgDaily, null);
});

test('다음 급여일: 마지막 O + 주기', () => {
  const st = mk({ '2026-11-09': { fed: 'O' } });
  const n = nextFeeding(st, '2026-11-10');
  assert.equal(n.status, 'upcoming');
  assert.equal(n.date, '2026-11-11');
  assert.equal(nextFeeding(st, '2026-11-11').status, 'due');
  const o = nextFeeding(st, '2026-11-14');
  assert.equal(o.status, 'overdue');
  assert.equal(o.overdueDays, 3);
});

test('다음 급여일: 오늘 급여 완료 → done, 다음 날짜는 +주기', () => {
  const st = mk({ '2026-11-11': { fed: 'O' } }, { intervalDays: 3 });
  const n = nextFeeding(st, '2026-11-11');
  assert.equal(n.status, 'done');
  assert.equal(n.date, '2026-11-14');
});

test('다음 급여일: 예정 우선 / 기록 없으면 오늘', () => {
  const st = mk({ '2026-11-09': { fed: 'O' }, '2026-11-12': { fed: '예정' } });
  const n = nextFeeding(st, '2026-11-11');
  assert.equal(n.status, 'planned');
  assert.equal(n.date, '2026-11-12');
  assert.equal(nextFeeding(mk(), '2026-11-11').status, 'due');
  assert.equal(nextFeeding(emptyState(), '2026-11-11'), null);
});

test('권장 급여량(홈)과 입력 미리보기', () => {
  const st = mk({ '2026-11-10': { weight: 14.2 } });
  assert.equal(recommendedNow(st, '2026-11-11'), 2.13);
  const p = previewRow(st, '2026-11-11', { weight: 14.6, fed: 'O' });
  assert.equal(p.change, 0.4);
  assert.equal(p.rec, 2.19);
  assert.equal(p.age, 114);
});

test('입력 검증', () => {
  const st = mk();
  assert.equal(validateEntry(st, '2026-11-11', { weight: 14.2 }).length, 0);
  assert.ok(validateEntry(st, '2026-11-11', { weight: 0 }).length);
  assert.ok(validateEntry(st, '2026-11-11', { weight: 201 }).length);
  assert.ok(validateEntry(st, '2026-07-19', {}).length);
  assert.equal(validateEntry(st, '2027-07-20', {}).length, 0); // 366번째 행(마지막)
  assert.ok(validateEntry(st, '2027-07-21', {}).length);
  assert.ok(validateEntry(st, '2026-11-11', { memo: 'x'.repeat(201) }).length);
  assert.ok(validateEntry(st, '2026-11-11', { hum: 101 }).length);
});

test('sanitizeState: 오염된 입력을 걸러냄', () => {
  const s = sanitizeState({
    settings: { birth: '2026-13-01', ratio: 5, intervalDays: 'a', species: 'x' },
    entries: { '2026-08-01': { weight: 'abc', fed: 'Z', memo: '<img src=x onerror=1>' }, bad: { weight: 3 } },
  });
  assert.equal(s.settings.birth, '');
  assert.equal(s.settings.ratio, 0.15);
  assert.equal(s.settings.intervalDays, 2);
  assert.deepEqual(Object.keys(s.entries), ['2026-08-01']);
  assert.deepEqual(s.entries['2026-08-01'], { memo: '<img src=x onerror=1>' }); // 문자열로만 보관(렌더링은 textContent)
});

test('온습도 이모지 판정', () => {
  const t = thresholdsFor({ species: 'crested' });
  assert.equal(judgeEnv(24.6, 68, t).overall.emoji, '😊');
  assert.equal(judgeEnv(19, 68, t).overall.emoji, '🥶');
  assert.equal(judgeEnv(29, 68, t).overall.emoji, '🥵');
  assert.equal(judgeEnv(21, 68, t).temp.level, 1);
  assert.equal(judgeEnv(24, 35, t).hum.emoji, '🏜️');
  assert.equal(judgeEnv(24, 88, t).hum.emoji, '🌊');
  assert.equal(judgeEnv(27, 45, t).overall.level, 1);
  assert.equal(judgeEnv(24.6, null, t).hum, null);
  assert.equal(judgeEnv(null, null, t), null);
  // 경계값
  assert.equal(judgeEnv(22, 50, t).overall.level, 0);
  assert.equal(judgeEnv(26, 80, t).overall.level, 0);
  assert.equal(judgeEnv(28, 80, t).temp.level, 1);
  assert.equal(judgeEnv(28.1, 80, t).temp.level, 2);
});

test('임계값 검증', () => {
  assert.equal(validateThresholds({ ...PRESETS.crested }).length, 0);
  assert.ok(validateThresholds({ ...PRESETS.crested, tCL: 30 }).length);
});
