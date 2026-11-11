// 엑셀 내보내기/가져오기. ExcelJS 와 템플릿은 주입받는다(브라우저 전역 ExcelJS 또는 Node 테스트).
// 원칙: 템플릿 '성장일지' 시트의 입력 셀(B2, B3, C·F·G 열)만 기록하고 수식/서식/유효성/조건부서식은 건드리지 않는다.
import { buildRows, summary, ymdToDay, dayToYmd, isValidYmd, sanitizeState, ROWS, FED_VALUES, MEMO_MAX, clean, WEIGHT_MIN, WEIGHT_MAX } from './calc.js';
import { judgeEnv, thresholdsFor } from './env.js';

export const MAIN_SHEET = '성장일지';
export const ENV_SHEET = '환경기록';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FIRST = 5; // 첫 데이터 행
const EXCEL_EPOCH_DAY = -25569; // 1899-12-30 → 1970-01-01 offset (일)

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const serial = (ymd) => ymdToDay(ymd) - EXCEL_EPOCH_DAY;
const utcDate = (ymd) => new Date(ymdToDay(ymd) * 86400000);

function setResult(cell, result) {
  const v = cell.value;
  if (v && typeof v === 'object' && typeof v.formula === 'string') {
    cell.value = { formula: v.formula, result };
  }
}

export async function buildWorkbook(ExcelJS, templateB64, state, today) {
  const { birth, ratio } = state.settings;
  if (!isValidYmd(birth)) throw new Error('출생일이 설정되지 않았습니다.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b64ToBytes(templateB64));
  const ws = wb.getWorksheet(MAIN_SHEET);
  if (!ws) throw new Error('템플릿 시트를 찾을 수 없습니다.');

  // 입력 셀
  ws.getCell('B2').value = utcDate(birth);
  ws.getCell('B3').value = ratio;

  const rows = buildRows(state);
  if (rows.length !== ROWS) throw new Error('행 계산 오류');
  for (let i = 0; i < ROWS; i++) {
    const r = FIRST + i;
    const row = rows[i];
    ws.getCell(r, 3).value = row.weight; // C
    ws.getCell(r, 6).value = row.fed === '' ? null : row.fed; // F
    ws.getCell(r, 7).value = row.memo === '' ? null : row.memo; // G (문자열 그대로, 수식으로 해석되지 않음)
    // 수식 셀 캐시값 갱신 (미리보기/Numbers 등 재계산 없는 뷰어 대비)
    setResult(ws.getCell(r, 1), serial(row.date)); // A
    setResult(ws.getCell(r, 2), row.age); // B
    setResult(ws.getCell(r, 4), row.change === null ? '' : row.change); // D
    setResult(ws.getCell(r, 5), row.rec === null ? '' : row.rec); // E
  }
  const s = summary(state, today, rows);
  setResult(ws.getCell('D2'), s.age === null ? '' : s.age);
  setResult(ws.getCell('E2'), s.weight === null ? '' : s.weight);
  setResult(ws.getCell('F2'), s.gain === null ? '' : s.gain);
  setResult(ws.getCell('G2'), s.avgDaily === null ? '' : clean(s.avgDaily));

  // 환경 시트 (첫 시트는 원본 그대로 유지)
  const th = thresholdsFor(state.settings);
  const es = wb.addWorksheet(ENV_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  es.columns = [
    { header: '날짜', key: 'd', width: 16 },
    { header: '일령 (일)', key: 'a', width: 11 },
    { header: '온도 (°C)', key: 't', width: 11 },
    { header: '습도 (%)', key: 'h', width: 11 },
    { header: '상태', key: 's', width: 24 },
  ];
  const head = es.getRow(1);
  head.height = 24;
  head.eachCell((c) => {
    c.font = { name: '맑은 고딕', bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  for (const row of rows) {
    if (row.temp === null && row.hum === null) continue;
    const j = judgeEnv(row.temp, row.hum, th);
    const r = es.addRow({
      d: utcDate(row.date), a: row.age, t: row.temp, h: row.hum,
      s: j ? j.overall.emoji + ' ' + j.overall.label : '',
    });
    r.getCell('d').numFmt = 'yyyy-mm-dd';
    r.getCell('t').numFmt = '0.0';
    r.getCell('h').numFmt = '0';
    r.eachCell((c) => { c.alignment = { horizontal: 'center' }; });
  }

  wb.creator = 'lizard-growth';
  wb.lastModifiedBy = 'lizard-growth';
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return wb;
}

export async function exportXlsx(ExcelJS, templateB64, state, today) {
  const wb = await buildWorkbook(ExcelJS, templateB64, state, today);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

export function exportFileName(today) {
  return 'lizard_growth_log_' + today.replace(/-/g, '') + '.xlsx';
}

// ---------- 가져오기 ----------
function cellYmd(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return dayToYmd(Math.floor(v.getTime() / 86400000));
  if (typeof v === 'string' && isValidYmd(v.trim())) return v.trim();
  return null;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text || '').join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result !== undefined && v.result !== null && typeof v.result !== 'object') return String(v.result);
  }
  return '';
}

function cellNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  return null;
}

/** 엑셀(템플릿 구조) → 앱 상태. 입력 열만 읽고 서버/외부 호출 없음. */
export async function importXlsx(ExcelJS, arrayBuffer, currentState) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.getWorksheet(MAIN_SHEET) || wb.worksheets[0];
  if (!ws) throw new Error('시트가 없습니다.');
  const birth = cellYmd(ws.getCell('B2').value);
  if (!birth) throw new Error('B2(출생일)를 읽을 수 없습니다. 이 앱에서 내보낸 템플릿 파일인지 확인하세요.');
  const ratio = cellNum(ws.getCell('B3').value);
  const entries = {};
  const b = ymdToDay(birth);
  let imported = 0;
  for (let i = 0; i < ROWS; i++) {
    const r = FIRST + i;
    const date = dayToYmd(b + i);
    const e = {};
    const w = cellNum(ws.getCell(r, 3).value);
    if (w !== null && w >= WEIGHT_MIN && w <= WEIGHT_MAX) e.weight = w;
    const fedRaw = cellText(ws.getCell(r, 6).value).trim();
    const fed = fedRaw.toUpperCase() === 'O' ? 'O' : fedRaw.toUpperCase() === 'X' ? 'X' : fedRaw === '예정' ? '예정' : '';
    if (FED_VALUES.includes(fed)) e.fed = fed;
    const memo = cellText(ws.getCell(r, 7).value).trim().slice(0, MEMO_MAX);
    if (memo) e.memo = memo;
    if (Object.keys(e).length) { entries[date] = e; imported++; }
  }
  const es = wb.getWorksheet(ENV_SHEET);
  if (es) {
    es.eachRow((row, n) => {
      if (n === 1) return;
      const date = cellYmd(row.getCell(1).value);
      if (!date || date < birth) return;
      const t = cellNum(row.getCell(3).value);
      const h = cellNum(row.getCell(4).value);
      const e = entries[date] || (entries[date] = {});
      if (t !== null) e.temp = t;
      if (h !== null) e.hum = h;
    });
  }
  const base = currentState ? currentState.settings : {};
  const next = sanitizeState({
    settings: { ...base, birth, ratio: ratio !== null && ratio > 0 && ratio <= 1 ? ratio : base.ratio },
    entries,
    lastBackup: currentState ? currentState.lastBackup : '',
  });
  return { state: next, count: Object.keys(next.entries).length };
}
