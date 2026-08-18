// 在 SVG 模式下验证6个图层是否翻转到右侧(按 data-name 匹配)且无异常
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);

const res = await page.evaluate(() => {
  const svg = document.querySelector('#previewInner svg');
  const result = {};
  const names = ['绿色 2','长白线 2','最短线左 2','短线左 2','方框左 2','点左 2'];
  const groups = Array.from(svg.querySelectorAll('g[data-name]'));
  for (const nm of names) {
    const g = groups.find(gg => gg.getAttribute('data-name') === nm);
    if (!g) { result[nm] = '未找到'; continue; }
    const ct = g.getAttribute('transform');
    const ctm = g.getCTM();
    result[nm] = { transform: ct, ctmX: ctm ? Math.round(ctm.e) : null, ctmY: ctm ? Math.round(ctm.f) : null };
  }
  return result;
});
console.log(JSON.stringify(res, null, 2));
// 用 ASCII 看整体画面(确认镜像没破):把 svg 画到位图
const ascii = await page.evaluate(async () => {
  const svg = document.querySelector('#previewInner svg');
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  await new Promise((rre, rrj) => { img.onload = rre; img.onerror = rrj; });
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 1920, 1080);
  const d = cx.getImageData(0, 0, 1920, 1080).data;
  const ch = ' .:-=+*#%@'; const CW = 100, CH = 30;
  const rows = [];
  for (let cy = 0; cy < CH; cy++) {
    let row = '';
    for (let cx0 = 0; cx0 < CW; cx0++) {
      const x0 = Math.floor(cx0 * 1920 / CW), x1 = Math.floor((cx0 + 1) * 1920 / CW);
      const y0 = Math.floor(cy * 1080 / CH), y1 = Math.floor((cy + 1) * 1080 / CH);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * 1920 + x) * 4;
        if (d[i + 3] > 30) { sum += (d[i] + d[i+1] + d[i+2]) / 3; cnt++; }
      }
      row += cnt === 0 ? ' ' : ch[Math.min(9, Math.floor(sum / cnt / 25.6))];
    }
    rows.push(row);
  }
  return rows.join('\n');
});
console.log('\n=== 整体画面(120帧) ===');
console.log(ascii);
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

