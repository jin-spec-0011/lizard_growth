import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildWorkbook, importXlsx, MAIN_SHEET, ENV_SHEET } from '../js/export.js';
import { TEMPLATE_B64 } from '../assets/template.js';
import { emptyState, buildRows } from '../js/calc.js';

const ExcelJS = createRequire(import.meta.url)('../vendor/exceljs.min.js');

function sample() {
  const s = emptyState();
  s.settings.birth = '2026-07-20';
  s.entries = {
    '2026-07-20': { weight: 2.6, fed: 'O', memo: '출생 및 첫 체중' },
    '2026-11-09': { weight: 13.8, fed: 'O', temp: 24.6, hum: 68 },
    '2026-11-10': { weight: 13.5, fed: 'X', memo: '=1+1' },
    '2026-11-11': { weight: 14.2, fed: 'O', temp: 24.1, hum: 66, memo: '식욕 좋음' },
  };
  return s;
}

async function roundtrip(state, today) {
  const wb = await buildWorkbook(ExcelJS, TEMPLATE_B64, state, today);
  const buf = await wb.xlsx.writeBuffer();
  return { buf, wb2: await new ExcelJS.Workbook().xlsx.load(buf) };
}

test('내보내기: 입력 셀 기록 + 수식/서식/유효성/조건부서식 보존', async () => {
  const { buf } = await roundtrip(sample(), '2026-11-11');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet(MAIN_SHEET);
  assert.equal(ws.getCell('A1').value, '🦎 도마뱀 성장 및 급여 일지');
  assert.equal(ws.getCell('B3').value, 0.15);
  assert.equal(ws.getCell('C5').value, 2.6);
  assert.equal(ws.getCell('F5').value, 'O');
  assert.equal(ws.getCell('G5').value, '출생 및 첫 체중');
  const rows = buildRows(sample());
  const i = rows.findIndex((r) => r.date === '2026-11-11');
  assert.equal(ws.getCell(5 + i, 3).value, 14.2);
  // 문자열 '=1+1' 은 수식이 아니라 문자열로 저장되어야 함
  const j = rows.findIndex((r) => r.date === '2026-11-10');
  assert.equal(ws.getCell(5 + j, 7).value, '=1+1');
  // 수식 유지
  assert.match(ws.getCell('E6').value.formula, /ROUND\(INDEX/);
  assert.match(ws.getCell('D6').value.formula, /COUNT\(C\$5:C5\)/);
  assert.equal(ws.getCell('D2').value.formula, 'TODAY()-$B$2');
  assert.equal(ws.getCell('D2').value.result, 114);
  assert.equal(ws.getCell('E2').value.result, 14.2);
  assert.equal(ws.getCell('F2').value.result, 11.6);
  // 서식
  assert.equal(ws.getColumn(5).width, 41);
  assert.equal(ws.getCell('B2').numFmt, 'yyyy-mm-dd');
  assert.equal(ws.views[0].ySplit, 4);
  assert.deepEqual(ws.conditionalFormattings.map((c) => c.ref), ['A5:G370', 'D5:D370']);
  assert.ok(Object.keys(ws.dataValidations.model).length >= 366);
  assert.equal(ws.dataValidations.model['F5'].formulae[0], '"O,X,예정"');
  // 환경 시트
  const es = wb.getWorksheet(ENV_SHEET);
  assert.equal(es.rowCount, 3);
  assert.equal(es.getCell('E2').value, '😊 쾌적해요');
});

test('가져오기: 내보낸 파일 → 동일 상태 복원', async () => {
  const st = sample();
  const { buf } = await roundtrip(st, '2026-11-11');
  const base = emptyState();
  base.settings.intervalDays = 3;
  const { state } = await importXlsx(ExcelJS, buf, base);
  assert.equal(state.settings.birth, '2026-07-20');
  assert.equal(state.settings.intervalDays, 3); // 앱 설정 유지
  assert.deepEqual(state.entries, st.entries);
});

test('가져오기: 출생일 없는 파일은 거부', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('성장일지').getCell('B2').value = '모름';
  const buf = await wb.xlsx.writeBuffer();
  await assert.rejects(() => importXlsx(ExcelJS, buf, emptyState()), /B2/);
});
