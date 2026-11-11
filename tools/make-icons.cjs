'use strict';
// 사용법: node tools/make-icons.cjs  (Playwright + 이모지 폰트 필요) → assets/icon-*.png 생성
const { chromium } = require('playwright');
const path = require('path');
const out = path.join(__dirname, '..', 'assets');
const html = (size, scale, radius) => `<!doctype html><meta charset=utf-8><body style="margin:0"><div style="width:${size}px;height:${size}px;background:linear-gradient(160deg,#FFE08F,#FBC24A);border-radius:${radius}px;display:grid;place-items:center;font-size:${Math.round(size * scale)}px;line-height:1;font-family:'Noto Color Emoji','Apple Color Emoji',sans-serif">🦎</div>`;
(async () => {
  const b = await chromium.launch();
  const jobs = [
    ['icon-192.png', 192, 0.6, 0], ['icon-512.png', 512, 0.6, 0],
    ['icon-maskable-512.png', 512, 0.5, 0], ['apple-touch-icon.png', 180, 0.6, 0],
  ];
  for (const [name, size, scale, radius] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(html(size, scale, radius));
    await p.screenshot({ path: path.join(out, name), omitBackground: false });
    await p.close();
  }
  await b.close();
})();
