// 修正版:强制重绘 + ASCII 亮度图对比 SVG/Canvas + 按类型隔离
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
await sleep(1000);

const asciiOf = (data, w, h) => {
  const chars = ' .:-=+*#%@';
  const CW = 110, CH = 34;
  const cellW = w / CW, cellH = h / CH;
  const rows = [];
  for (let cy = 0; cy < CH; cy++) {
    let row = '';
    for (let cx = 0; cx < CW; cx++) {
      let sum = 0, cnt = 0, alphaSum = 0;
      const x0 = Math.floor(cx * cellW), x1 = Math.floor((cx + 1) * cellW);
      const y0 = Math.floor(cy * cellH), y1 = Math.floor((cy + 1) * cellH);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          alphaSum += data[i + 3];
          if (data[i + 3] > 30) { sum += (data[i] + data[i + 1] + data[i + 2]) / 3; cnt++; }
        }
      }
      if (cnt === 0) row += alphaSum > 0 ? '·' : ' ';
      else row += chars[Math.min(9, Math.floor(sum / cnt / 25.6))];
    }
    rows.push(row);
  }
  return rows.join('\n');
};

// SVG @250 位图
const svgData = await page.evaluate(async () => {
  const a = window.__anim;
  a.goToAndStop(250, true);
  await new Promise((r) => setTimeout(r, 1500));
  const svgEl = document.querySelector('#previewInner svg');
  const xml = new XMLSerializer().serializeToString(svgEl);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const cv = document.createElement('canvas');
  cv.width = 1920; cv.height = 1080;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, 1920, 1080);
  return Array.from(cx.getImageData(0, 0, 1920, 1080).data);
});
console.log('=== SVG @250 ===');
console.log(asciiOf(svgData, 1920, 1080));

// Canvas @250
await page.select('#selRenderer', 'canvas');
await sleep(2500);
const canvasData = await page.evaluate(async () => {
  const a = window.__anim;
  a.renderer.renderFrame(250, true);
  await new Promise((r) => setTimeout(r, 800));
  const c = document.querySelector('#previewInner canvas');
  return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
});
console.log('=== CANVAS @250 ===');
console.log(asciiOf(canvasData, 1920, 1080));

// 按类型隔离(强制重绘,避免同帧短路)
const iso = await page.evaluate(async () => {
  const a = window.__anim;
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  const count = () => {
    const c = document.querySelector('#previewInner canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    return opaque;
  };
  const sample = async (ty) => {
    for (const e of all) if (e.data.ty === ty) e.data.hd = true;
    a.renderer.renderFrame(250, true);
    await new Promise((r) => setTimeout(r, 400));
    const n = count();
    for (const e of all) if (e.data.ty === ty) e.data.hd = false;
    a.renderer.renderFrame(250, true);
    await new Promise((r) => setTimeout(r, 400));
    return n;
  };
  const baseline = count();
  const out = { baseline };
  for (const ty of [2, 4, 5]) out['hide_ty' + ty] = await sample(ty);
  return out;
});
console.log('isolation:', JSON.stringify(iso));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

