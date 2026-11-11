// UI 진입점. 모든 텍스트는 textContent 로만 렌더링한다 (innerHTML 미사용 → XSS 차단).
import {
  buildRows, summary, nextFeeding, recommendedNow, previewRow, validateEntry, normalizeEntry,
  addDays, diffDays, dowOf, localTodayYmd, isValidYmd, ROWS, DOW, MEMO_MAX, WEIGHT_MAX, emptyState,
} from './calc.js';
import { judgeEnv, thresholdsFor, validateThresholds, PRESETS, THRESHOLD_KEYS } from './env.js';
import { loadState, saveState, wipeAll, requestPersist, persistent } from './store.js';
import { exportXlsx, exportFileName, importXlsx, XLSX_MIME } from './export.js';

const $view = document.getElementById('view');
const $sheetRoot = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');
const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const PAGE = 60;

let state = emptyState();
let tab = 'home';
let journalLimit = PAGE;
let journalOnlyFilled = false;
let lastFocus = null;

// ---------- DOM 헬퍼 ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 2600);
}

// ---------- 포맷 ----------
const trim = (n, d = 2) => String(+n.toFixed(d));
const signed = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);
const md = (ymd) => ymd.slice(5) + '(' + DOW[dowOf(ymd)] + ')';
const today = () => localTodayYmd();

function relDay(ymd, t) {
  const d = diffDays(t, ymd);
  return d === 0 ? '오늘' : d > 0 ? d + '일 전' : -d + '일 후';
}

// ---------- 상태 ----------
async function commit(mutator) {
  mutator(state);
  const ok = await saveState(state);
  if (!ok) toast('⚠️ 이 브라우저에서는 저장되지 않습니다. 엑셀로 백업하세요.');
  render();
}

function hasBirth() {
  return isValidYmd(state.settings.birth);
}

// ---------- 시트(모달) ----------
function closeSheet() {
  $sheetRoot.replaceChildren();
  document.body.classList.remove('lock');
  document.removeEventListener('keydown', onSheetKey);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function onSheetKey(e) {
  if (e.key === 'Escape') closeSheet();
}

function openSheet(title, body) {
  lastFocus = document.activeElement;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'grab' }), h('h3', { text: title }), body);
  const dim = h('div', { class: 'dim', onclick: (e) => { if (e.target === dim) closeSheet(); } }, sheet);
  $sheetRoot.replaceChildren(dim);
  document.body.classList.add('lock');
  document.addEventListener('keydown', onSheetKey);
  const first = sheet.querySelector('input,select,textarea,button');
  if (first) first.focus({ preventScroll: true });
}

// ---------- 입력 시트 ----------
function openEntry(dateIn, preset = {}) {
  if (!hasBirth()) { setTab('settings'); toast('먼저 출생일을 설정하세요.'); return; }
  const birth = state.settings.birth;
  const minD = birth;
  const maxD = addDays(birth, ROWS - 1);
  let date = dateIn < minD ? minD : dateIn > maxD ? maxD : dateIn;
  let fed = '';

  const fDate = h('input', { type: 'date', id: 'f-date', min: minD, max: maxD, value: date, required: true });
  const fWeight = h('input', { type: 'number', id: 'f-weight', inputmode: 'decimal', step: '0.01', min: '0.01', max: String(WEIGHT_MAX), placeholder: '예: 14.2' });
  const fTemp = h('input', { type: 'number', id: 'f-temp', inputmode: 'decimal', step: '0.1', min: '-10', max: '60', placeholder: '24.5' });
  const fHum = h('input', { type: 'number', id: 'f-hum', inputmode: 'decimal', step: '1', min: '0', max: '100', placeholder: '65' });
  const fMemo = h('textarea', { id: 'f-memo', maxlength: String(MEMO_MAX), placeholder: '특이사항' });
  const segBtns = ['O', 'X', '예정'].map((v) =>
    h('button', { type: 'button', 'aria-pressed': 'false', text: v, onclick: () => { fed = fed === v ? '' : v; paintSeg(); refresh(); } })
  );
  const paintSeg = () => segBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === fed)));
  const err = h('div', { class: 'err', role: 'alert' });
  const aAge = h('b'), aChg = h('b'), aRec = h('b');
  const delBtn = h('button', { type: 'button', class: 'btn danger', text: '삭제', onclick: onDelete });

  function load() {
    const e = state.entries[date] || {};
    fWeight.value = e.weight !== undefined ? String(e.weight) : '';
    fTemp.value = e.temp !== undefined ? String(e.temp) : '';
    fHum.value = e.hum !== undefined ? String(e.hum) : '';
    fMemo.value = e.memo || '';
    fed = e.fed || '';
    if (preset.fed && !state.entries[date]) fed = preset.fed;
    delBtn.hidden = !state.entries[date];
    paintSeg();
    refresh();
  }

  const num = (el) => (el.value.trim() === '' ? null : Number(el.value));
  function draft() {
    return { weight: num(fWeight), fed, memo: fMemo.value, temp: num(fTemp), hum: num(fHum) };
  }

  function refresh() {
    const d = draft();
    const safe = { ...d, weight: Number.isFinite(d.weight) ? d.weight : null };
    const p = isValidYmd(date) ? previewRow(state, date, safe) : null;
    aAge.textContent = p ? p.age + '일' : '—';
    aChg.textContent = p && p.change !== null ? signed(p.change) + ' g' : '—';
    aRec.textContent = p && p.rec !== null ? p.rec.toFixed(2) + ' g' : '—';
  }

  async function onSave() {
    err.textContent = '';
    const d = draft();
    if ((d.weight !== null && !Number.isFinite(d.weight)) || (d.temp !== null && !Number.isFinite(d.temp)) || (d.hum !== null && !Number.isFinite(d.hum))) {
      err.textContent = '숫자 형식이 올바르지 않습니다.';
      return;
    }
    const errs = validateEntry(state, date, d);
    if (errs.length) { err.textContent = errs[0]; return; }
    const n = normalizeEntry(d);
    const p = previewRow(state, date, d);
    await commit((s) => { if (n) s.entries[date] = n; else delete s.entries[date]; });
    closeSheet();
    toast(p && p.rec !== null ? '저장됨 · 권장 급여량 ' + p.rec.toFixed(2) + ' g' : '저장됨');
    requestPersist();
  }

  async function onDelete() {
    if (!confirm(date + ' 기록을 삭제할까요?')) return;
    await commit((s) => { delete s.entries[date]; });
    closeSheet();
    toast('삭제됨');
  }

  fDate.addEventListener('change', () => {
    if (isValidYmd(fDate.value) && fDate.value >= minD && fDate.value <= maxD) { date = fDate.value; err.textContent = ''; load(); }
  });
  for (const el of [fWeight, fTemp, fHum, fMemo]) el.addEventListener('input', refresh);

  const body = h('div', {},
    h('label', { for: 'f-date', text: '날짜' }), fDate,
    h('label', { for: 'f-weight', text: '체중 (g)' }), fWeight,
    h('div', { class: 'lbl', text: '급여 여부 (한 번 더 누르면 해제)' }), h('div', { class: 'seg', role: 'group', 'aria-label': '급여 여부' }, segBtns),
    h('div', { class: 'two' },
      h('div', {}, h('label', { for: 'f-temp', text: '온도 (°C)' }), fTemp),
      h('div', {}, h('label', { for: 'f-hum', text: '습도 (%)' }), fHum)),
    h('label', { for: 'f-memo', text: '메모' }), fMemo,
    h('div', { class: 'auto', 'aria-live': 'polite' },
      h('div', {}, h('small', { text: '일령' }), aAge),
      h('div', {}, h('small', { text: '변화량(직전 대비)' }), aChg),
      h('div', {}, h('small', { text: '권장 급여량' }), aRec)),
    err,
    h('div', { class: 'btns' },
      delBtn,
      h('button', { type: 'button', class: 'btn', text: '취소', onclick: closeSheet }),
      h('button', { type: 'button', class: 'btn main', text: '저장', onclick: onSave }))
  );
  openSheet('기록', body);
  load();
}

// ---------- 홈 ----------
function renderHome() {
  const t = today();
  if (!hasBirth()) {
    return h('div', {},
      h('div', { class: 'hdr' }, h('h1', { text: '🦎 도마뱀 일지' })),
      h('div', { class: 'card hello' },
        h('div', { class: 'big-em', 'aria-hidden': 'true', text: '🦎' }),
        h('h2', { text: '처음 오셨네요' }),
        h('p', { text: '출생일을 입력하면 일령·급여량·다음 급여일이 자동으로 계산됩니다. 모든 데이터는 이 기기에만 저장됩니다.' }),
        h('button', { type: 'button', class: 'btn main', text: '시작하기', onclick: () => setTab('settings') })));
  }
  const rows = buildRows(state);
  const sum = summary(state, t, rows);
  const nf = nextFeeding(state, t);
  const rec = recommendedNow(state, t, rows);
  const th = thresholdsFor(state.settings);
  const parts = [];

  parts.push(h('div', { class: 'hdr' },
    h('div', {}, h('h1', { text: '🦎 ' + (sum.age >= 0 ? 'D+' + sum.age + '일' : 'D' + sum.age + '일') }), h('small', { text: t + ' (' + DOW[dowOf(t)] + ') · 출생 ' + state.settings.birth })),
    h('button', { type: 'button', class: 'avatar', 'aria-label': '설정 열기', text: '🦎', onclick: () => setTab('settings') })));

  if (!persistent) parts.push(h('div', { class: 'notice', role: 'alert', text: '⚠️ 이 브라우저는 저장소를 허용하지 않아 앱을 닫으면 기록이 사라집니다. 엑셀로 백업하세요.' }));
  const filled = Object.keys(state.entries).length;
  const bk = state.lastBackup ? diffDays(t, state.lastBackup) : null;
  if (filled > 0 && (bk === null || bk >= 14)) {
    parts.push(h('div', { class: 'notice' },
      h('div', { text: '💾 ' + (bk === null ? '아직 백업한 적이 없습니다.' : '마지막 백업 ' + bk + '일 전') + ' 기기를 바꾸거나 브라우저 데이터를 지우면 기록이 사라집니다.' }),
      h('button', { type: 'button', text: '엑셀로 백업', onclick: doExport })));
  }

  // 주간 스트립 (월~일)
  const mon = addDays(t, -((dowOf(t) + 6) % 7));
  const maxD = addDays(state.settings.birth, ROWS - 1);
  const week = h('div', { class: 'week', role: 'group', 'aria-label': '이번 주' });
  ['월', '화', '수', '목', '금', '토', '일'].forEach((lab, i) => {
    const d = addDays(mon, i);
    const e = state.entries[d];
    const cls = ['day', d === t ? 'today' : '', nf && d === nf.date && nf.status !== 'done' ? 'next' : ''].join(' ').trim();
    week.append(h('button', {
      type: 'button', class: cls, disabled: d < state.settings.birth || d > maxD,
      'aria-label': d + (e && e.fed === 'O' ? ' 급여함' : ''), onclick: () => openEntry(d),
    }, lab, h('b', {}, String(+d.slice(8)), e && e.fed === 'O' ? h('i') : null)));
  });
  parts.push(week);

  // 급여 카드
  let big = '', sub = '';
  if (nf.status === 'done') { big = '오늘 급여 완료 ✅'; sub = '다음 급여일 ' + md(nf.date) + ' · D-' + nf.daysUntil; }
  else if (nf.status === 'due') big = '오늘 · ' + md(nf.date);
  else if (nf.status === 'overdue') { big = '오늘 (지연 ' + nf.overdueDays + '일)'; sub = '원래 급여일 ' + md(nf.date); }
  else if (nf.status === 'planned') { big = md(nf.date); sub = '예정 · D-' + nf.daysUntil; }
  else { big = md(nf.date); sub = 'D-' + nf.daysUntil; }
  parts.push(h('section', { class: 'card feed', 'aria-label': '다음 급여' },
    h('div', { class: 'em', 'aria-hidden': 'true', text: '🍽️' }),
    h('div', { class: 'k', text: nf.status === 'done' ? '오늘 급여' : '다음 급여일' }),
    h('div', { class: 'big', text: big }),
    sub ? h('div', { class: 'sub', text: sub }) : null,
    h('div', { class: 'meta' },
      h('div', { class: 'pill' }, '권장 급여량', h('b', { text: rec === null ? '체중 입력 필요' : rec.toFixed(2) + ' g' })),
      h('div', { class: 'pill' }, '직전 급여', h('b', { text: nf.lastFed ? md(nf.lastFed) + ' · ' + relDay(nf.lastFed, t) : '기록 없음' }))),
    h('button', { type: 'button', class: 'cta', text: nf.todayFed ? '오늘 기록 수정' : '급여 기록하기', onclick: () => openEntry(t, { fed: 'O' }) })));

  // 온습도 카드
  parts.push(envCard(rows, t, th));

  // 칩
  parts.push(h('div', { class: 'chips' },
    h('div', { class: 'chip' }, '현재 체중', h('b', { text: sum.weight === null ? '—' : trim(sum.weight) + ' g' })),
    h('div', { class: 'chip' }, '누적 증가', h('b', { text: sum.gain === null ? '—' : signed(sum.gain) + ' g' })),
    h('div', { class: 'chip' }, '일증체', h('b', { text: sum.avgDaily === null ? '—' : signed(sum.avgDaily, 3) }))));
  return h('div', {}, parts);
}

function latestReading(rows, t) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.date <= t && (r.temp !== null || r.hum !== null)) return r;
  }
  return null;
}

function envCard(rows, t, th) {
  const r = latestReading(rows, t);
  const j = r ? judgeEnv(r.temp, r.hum, th) : null;
  if (!j) {
    return h('button', { type: 'button', class: 'card env', onclick: () => openEntry(t) },
      h('div', { class: 'face', 'aria-hidden': 'true', text: '🌡️' }),
      h('div', {}, h('div', { class: 'k', text: '현재 온습도' }), h('div', { class: 'st', text: '기록 없음' }), h('div', { class: 'k', text: '눌러서 온도·습도를 입력하세요' })));
  }
  return h('button', { type: 'button', class: 'card env', onclick: () => setTab('env'), 'aria-label': '현재 온습도 ' + j.overall.label },
    h('div', { class: 'face', 'aria-hidden': 'true', text: j.overall.emoji }),
    h('div', {},
      h('div', { class: 'k', text: '현재 온습도 · ' + relDay(r.date, t) + ' 기록' }),
      h('div', { class: 'st', text: j.overall.label }),
      h('div', { class: 'vals' },
        h('div', {}, '온도', h('b', { text: r.temp === null ? '—' : trim(r.temp, 1) + '°C' })),
        h('div', {}, '습도', h('b', { text: r.hum === null ? '—' : trim(r.hum, 0) + '%' })))));
}

// ---------- 일지 ----------
function renderJournal() {
  if (!hasBirth()) return emptyHint('📒 일지', '설정에서 출생일을 먼저 입력하세요.');
  const t = today();
  const rows = buildRows(state);
  const lastIdx = Math.min(ROWS - 1, Math.max(0, diffDays(addDays(t, 3), state.settings.birth)));
  let list = [];
  for (let i = lastIdx; i >= 0; i--) {
    const r = rows[i];
    if (journalOnlyFilled && r.weight === null && r.fed === '' && r.memo === '' && r.temp === null && r.hum === null) continue;
    list.push(r);
  }
  const shown = list.slice(0, journalLimit);
  const fileIn = h('input', { type: 'file', accept: '.xlsx', hidden: true, 'aria-label': '엑셀 파일 선택', onchange: (e) => doImport(e.target) });
  const table = h('div', { class: 'tbl', role: 'table', 'aria-label': '성장 일지' },
    h('div', { class: 'h', role: 'row' }, ['날짜', '일령', '체중', '변화', '권장g', '급여', '메모'].map((x) => h('span', { role: 'columnheader', text: x }))),
    shown.map((r) =>
      h('button', { type: 'button', class: 'r' + (r.date === t ? ' t' : ''), role: 'row', 'aria-label': r.date + ' 기록 편집', onclick: () => openEntry(r.date) },
        h('span', { text: md(r.date) }),
        h('span', { text: String(r.age) }),
        h('span', { text: r.weight === null ? '—' : trim(r.weight) }),
        h('span', { class: r.change !== null && r.change < 0 ? 'neg' : '', text: r.change === null ? '' : signed(r.change) }),
        h('span', { text: r.rec === null ? '' : r.rec.toFixed(2) }),
        h('span', { class: r.fed === 'O' ? 'ok' : '', text: r.fed }),
        h('span', { text: r.memo }))));
  return h('div', {},
    h('div', { class: 'hdr' }, h('h2', { text: '📒 일지' })),
    h('div', { class: 'tools' },
      h('button', { type: 'button', class: 'btn sm dark', text: '⬇ 엑셀 내보내기', onclick: doExport }),
      h('button', { type: 'button', class: 'btn sm', text: '⬆ 가져오기', onclick: () => fileIn.click() }),
      fileIn,
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: journalOnlyFilled, onchange: (e) => { journalOnlyFilled = e.target.checked; journalLimit = PAGE; render(); } }), '입력된 날만')),
    table,
    list.length > shown.length ? h('button', { type: 'button', class: 'more', text: '더 보기 (' + (list.length - shown.length) + '일)', onclick: () => { journalLimit += PAGE; render(); } }) : null,
    h('p', { class: 'hint', text: '노란 행 = 오늘 · 빨간 변화량 = 체중 감소 · 행을 누르면 편집' }));
}

function emptyHint(title, msg) {
  return h('div', {}, h('div', { class: 'hdr' }, h('h2', { text: title })),
    h('div', { class: 'card hello' }, h('p', { text: msg }), h('button', { type: 'button', class: 'btn main', text: '설정으로', onclick: () => setTab('settings') })));
}

// ---------- 환경 ----------
function renderEnv() {
  const t = today();
  const th = thresholdsFor(state.settings);
  const rows = hasBirth() ? buildRows(state) : [];
  const r = latestReading(rows, t);
  const j = r ? judgeEnv(r.temp, r.hum, th) : null;
  const readings = rows.filter((x) => x.date <= t && (x.temp !== null || x.hum !== null)).slice(-14);

  const parts = [h('div', { class: 'hdr' }, h('h2', { text: '🌡️ 환경' }))];
  parts.push(h('div', { class: 'card env envbig' },
    h('div', { class: 'bigem', 'aria-hidden': 'true', text: j ? j.overall.emoji : '🌡️' }),
    h('div', { class: 'st', text: j ? j.overall.label : '기록 없음' }),
    j ? h('div', { class: 'vals' },
      h('div', {}, '온도 ' + (j.temp ? j.temp.emoji : ''), h('b', { text: r.temp === null ? '—' : trim(r.temp, 1) + '°C' })),
      h('div', {}, '습도 ' + (j.hum ? j.hum.emoji : ''), h('b', { text: r.hum === null ? '—' : trim(r.hum, 0) + '%' }))) : null,
    j ? h('div', { class: 'k', text: relDay(r.date, t) + ' 기록 (' + r.date + ')' + (j.overall.level > 0 ? ' · ' + [j.temp, j.hum].filter((x) => x && x.level > 0).map((x) => x.label).join(', ') : '') }) : null,
    h('button', { type: 'button', class: 'btn main', text: '온습도 기록', onclick: () => openEntry(t) })));

  if (readings.length >= 2) parts.push(h('div', { class: 'card' }, h('div', { class: 'lbl', text: '최근 ' + readings.length + '건 추이' }), chart(readings),
    h('div', { class: 'key' }, h('i'), '온도', h('i', { class: 'd' }), '습도')));

  parts.push(h('div', { class: 'legend', role: 'table', 'aria-label': '이모지 판정 기준' },
    ...legendRows(th)));
  parts.push(h('p', { class: 'hint', text: '기준: ' + (state.settings.species === 'custom' ? '직접 입력' : (PRESETS[state.settings.species] || PRESETS.crested).name) + ' · 설정에서 변경 · 센서 자동 연동은 다음 단계에서 추가됩니다.' }));
  return h('div', {}, parts);
}

function legendRows(t) {
  const row = (a, b) => h('div', { role: 'row' }, h('span', { text: a }), h('span', { text: b }));
  return [
    row('🥶 / 🥵 온도', '< ' + t.tDL + ' / > ' + t.tDH + ' °C'),
    row('😐 / 😓 온도', t.tDL + '~' + t.tCL + ' / ' + t.tCH + '~' + t.tDH + ' °C'),
    row('😊 온도', t.tCL + '~' + t.tCH + ' °C'),
    row('🏜️ / 🌊 습도', '< ' + t.hDL + ' / > ' + t.hDH + ' %'),
    row('😕 / 💦 습도', t.hDL + '~' + t.hCL + ' / ' + t.hCH + '~' + t.hDH + ' %'),
    row('😊 습도', t.hCL + '~' + t.hCH + ' %'),
  ];
}

function chart(readings) {
  const W = 300, H = 90, P = 8;
  const el = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': '온도와 습도 추이 그래프' });
  const n = readings.length;
  const x = (i) => P + (i * (W - 2 * P)) / (n - 1);
  const line = (key, color, dash) => {
    const pts = readings.map((r, i) => ({ i, v: r[key] })).filter((p) => p.v !== null);
    if (!pts.length) return;
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    el.append(svg('polyline', { points: pts.map((p) => x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-dasharray': dash || '' }));
    pts.forEach((p) => el.append(svg('circle', { cx: x(p.i).toFixed(1), cy: y(p.v).toFixed(1), r: 3, fill: color })));
  };
  line('temp', '#E0662C', '');
  line('hum', '#6D5BD0', '6 4');
  return el;
}

// ---------- 설정 ----------
function renderSettings() {
  const s = state.settings;
  const th = thresholdsFor(s);
  const fBirth = h('input', { type: 'date', id: 's-birth', value: s.birth, max: addDays(today(), 0) });
  const fRatio = h('input', { type: 'number', id: 's-ratio', inputmode: 'decimal', step: '0.5', min: '1', max: '100', value: String(+(s.ratio * 100).toFixed(2)) });
  const fInt = h('input', { type: 'number', id: 's-int', inputmode: 'numeric', step: '1', min: '1', max: '30', value: String(s.intervalDays) });
  const fSp = h('select', { id: 's-sp' },
    h('option', { value: 'crested', text: PRESETS.crested.name }),
    h('option', { value: 'leopard', text: PRESETS.leopard.name }),
    h('option', { value: 'custom', text: '직접 입력' }));
  fSp.value = s.species;
  const thInputs = {};
  const thBox = h('div', { class: 'th' });
  const labels = { tDL: '온도 위험↓', tCL: '온도 주의↓', tCH: '온도 주의↑', tDH: '온도 위험↑', hDL: '습도 위험↓', hCL: '습도 주의↓', hCH: '습도 주의↑', hDH: '습도 위험↑' };
  for (const k of THRESHOLD_KEYS) {
    thInputs[k] = h('input', { type: 'number', id: 's-' + k, inputmode: 'decimal', step: '0.5', value: String(th[k]) });
    thBox.append(h('div', {}, h('label', { for: 's-' + k, text: labels[k] }), thInputs[k]));
  }
  const thWrap = h('div', {}, h('div', { class: 'lbl', text: '판정 임계값 (위험↓ < 주의↓ < 주의↑ < 위험↑)' }), thBox);
  const syncTh = () => { thWrap.hidden = fSp.value !== 'custom'; };
  fSp.addEventListener('change', () => {
    if (fSp.value !== 'custom') {
      const p = PRESETS[fSp.value];
      for (const k of THRESHOLD_KEYS) thInputs[k].value = String(p[k]);
    }
    syncTh();
  });
  syncTh();
  const err = h('div', { class: 'err', role: 'alert' });

  async function onSave() {
    err.textContent = '';
    const birth = fBirth.value;
    if (!isValidYmd(birth)) { err.textContent = '출생일을 입력하세요.'; return; }
    const pct = Number(fRatio.value);
    if (!(pct >= 1 && pct <= 100)) { err.textContent = '급여율은 1~100% 입니다.'; return; }
    const iv = Number(fInt.value);
    if (!(Number.isInteger(iv) && iv >= 1 && iv <= 30)) { err.textContent = '급여주기는 1~30일 정수입니다.'; return; }
    let thresholds = null;
    if (fSp.value === 'custom') {
      thresholds = {};
      for (const k of THRESHOLD_KEYS) thresholds[k] = Number(thInputs[k].value);
      const te = validateThresholds(thresholds);
      if (te.length) { err.textContent = te[0]; return; }
    }
    const orphan = Object.keys(state.entries).filter((d) => d < birth || diffDays(d, birth) >= ROWS).length;
    if (orphan > 0 && !confirm('새 출생일 범위(365일) 밖의 기록 ' + orphan + '건은 화면·엑셀에 표시되지 않습니다. 계속할까요?')) return;
    await commit((st) => {
      st.settings.birth = birth;
      st.settings.ratio = pct / 100;
      st.settings.intervalDays = iv;
      st.settings.species = fSp.value;
      st.settings.thresholds = thresholds;
    });
    toast('설정 저장됨');
    requestPersist();
  }

  const fileIn = h('input', { type: 'file', accept: '.xlsx', hidden: true, 'aria-label': '엑셀 파일 선택', onchange: (e) => doImport(e.target) });
  const bk = state.lastBackup ? diffDays(today(), state.lastBackup) : null;

  return h('div', {},
    h('div', { class: 'hdr' }, h('h2', { text: '⚙️ 설정' })),
    h('section', { class: 'sect' },
      h('h3', { text: '개체 · 계산' }),
      h('label', { for: 's-birth', text: '출생일' }), fBirth,
      h('div', { class: 'two' },
        h('div', {}, h('label', { for: 's-ratio', text: '급여율 (체중 대비 %)' }), fRatio),
        h('div', {}, h('label', { for: 's-int', text: '급여주기 (일)' }), fInt)),
      h('label', { for: 's-sp', text: '온습도 판정 기준' }), fSp,
      thWrap, err,
      h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn main', text: '저장', onclick: onSave }))),
    h('section', { class: 'sect' },
      h('h3', { text: '백업 · 엑셀' }),
      h('p', { class: 'hint', text: bk === null ? '마지막 백업: 없음' : '마지막 백업: ' + state.lastBackup + ' (' + (bk === 0 ? '오늘' : bk + '일 전') + ')' }),
      h('div', { class: 'btns' },
        h('button', { type: 'button', class: 'btn dark', text: '⬇ 엑셀 내보내기', onclick: doExport }),
        h('button', { type: 'button', class: 'btn', text: '⬆ 가져오기', onclick: () => fileIn.click() }),
        fileIn),
      h('p', { class: 'hint', text: '내보낸 파일은 원본 템플릿과 같은 구조(성장일지 시트)이며 온습도는 두 번째 시트에 저장됩니다. 같은 파일을 가져오면 기록이 복원됩니다.' })),
    h('section', { class: 'sect' },
      h('h3', { text: '개인정보' }),
      h('p', { class: 'priv', text: '이 앱은 서버·계정·분석 도구가 없고 외부로 요청을 보내지 않습니다. 기록은 이 기기의 브라우저 저장소(IndexedDB)에만 저장됩니다.' }),
      h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn danger', text: '모든 데이터 삭제', onclick: onWipe }))));
}

async function onWipe() {
  if (!confirm('이 기기의 모든 기록과 설정을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  if (!confirm('정말 삭제할까요? (엑셀 백업을 먼저 권장합니다)')) return;
  await wipeAll();
  state = emptyState();
  toast('삭제됨');
  render();
}

// ---------- 엑셀 ----------
let excelPromise = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/exceljs.min.js';
      s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS 로드 실패')));
      s.onerror = () => { excelPromise = null; reject(new Error('엑셀 라이브러리를 불러오지 못했습니다.')); };
      document.head.append(s);
    });
  }
  return excelPromise;
}

async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: XLSX_MIME });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

async function doExport() {
  if (!hasBirth()) { toast('먼저 출생일을 설정하세요.'); setTab('settings'); return; }
  try {
    toast('엑셀 생성 중…');
    const [ExcelJS, tpl] = await Promise.all([loadExcelJS(), import('../assets/template.js')]);
    const t = today();
    const blob = await exportXlsx(ExcelJS, tpl.TEMPLATE_B64, state, t);
    const ok = await saveBlob(blob, exportFileName(t));
    if (ok) { await commit((s) => { s.lastBackup = t; }); toast('엑셀 저장됨'); }
  } catch (e) {
    toast('내보내기 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
  }
}

async function doImport(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) { toast('.xlsx 파일만 가져올 수 있습니다.'); return; }
  if (file.size > MAX_IMPORT_BYTES) { toast('파일이 너무 큽니다 (5MB 이하).'); return; }
  try {
    const ExcelJS = await loadExcelJS();
    const res = await importXlsx(ExcelJS, await file.arrayBuffer(), state);
    const cur = Object.keys(state.entries).length;
    if (!confirm('파일에서 ' + res.count + '일치 기록을 읽었습니다.\n현재 기록 ' + cur + '일치와 출생일/급여율이 파일 내용으로 교체됩니다. 계속할까요?')) return;
    await commit((s) => { s.settings = res.state.settings; s.entries = res.state.entries; });
    toast('가져오기 완료 · ' + res.count + '일');
  } catch (e) {
    toast('가져오기 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
  }
}

// ---------- 라우팅/렌더 ----------
function setTab(next) {
  tab = next;
  closeSheet();
  render();
  window.scrollTo(0, 0);
}

function render() {
  const views = { home: renderHome, journal: renderJournal, env: renderEnv, settings: renderSettings };
  $view.replaceChildren((views[tab] || renderHome)());
  document.querySelectorAll('.nav button[data-tab]').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

async function init() {
  state = await loadState();
  document.querySelectorAll('.nav button[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.getElementById('fab').addEventListener('click', () => openEntry(today()));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$sheetRoot.firstChild) render(); });
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
