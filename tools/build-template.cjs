'use strict';
// 사용법: node tools/build-template.cjs <원본.xlsx>
// 원본 엑셀에서 사용자 입력값(출생일·체중·급여여부·메모)을 비우고 assets/template.js(base64)로 내장한다.
// 수식·서식·열폭·조건부서식·데이터유효성은 그대로 유지된다. 원본 xlsx 는 저장소에 커밋하지 않는다(.gitignore).
const fs = require('fs');
const path = require('path');
const ExcelJS = require('../vendor/exceljs.min.js');

async function main() {
  const src = process.argv[2];
  if (!src || !fs.existsSync(src)) {
    console.error('원본 xlsx 경로를 지정하세요.');
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(src));
  const ws = wb.getWorksheet('성장일지');
  if (!ws) throw new Error("시트 '성장일지' 를 찾을 수 없습니다.");
  if (ws.rowCount !== 370) throw new Error('예상(370행)과 다른 행 수: ' + ws.rowCount);
  ws.getCell('B2').value = null; // 출생일: 앱에서 기록
  ws.getCell('B3').value = 0.15; // 급여율 기본값
  for (let r = 5; r <= 370; r++) {
    ws.getCell(r, 3).value = null; // C 체중
    ws.getCell(r, 6).value = null; // F 급여 여부
    ws.getCell(r, 7).value = null; // G 메모
  }
  wb.creator = 'lizard-growth';
  wb.lastModifiedBy = 'lizard-growth';
  const buf = await wb.xlsx.writeBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  const out = path.join(__dirname, '..', 'assets', 'template.js');
  fs.writeFileSync(out, '// 자동 생성 파일 (tools/build-template.cjs). 직접 수정하지 마세요.\nexport const TEMPLATE_B64 = "' + b64 + '";\n');
  console.log('OK', out, Math.round(b64.length / 1024) + ' KB(base64)');
}
main().catch((e) => { console.error(e); process.exit(1); });
