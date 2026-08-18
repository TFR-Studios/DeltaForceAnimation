// 对比验证:SVG 与 Canvas 同帧画面、文字层是否单独有输出
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

const statsCanvas = () => page.evaluate(() => {
  const c = document.querySelector('#previewInner canvas');
  if (!c) return { mode: 'no-canvas' };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sr = 0, sg = 0, sb = 0;
  const w = c.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] > 0) {
      opaque++;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
    }
  }
  return opaque ? {
    mode: 'canvas',
    opaque,
    bbox: [minX, minY, maxX, maxY],
    avg: [Math.round(sr / opaque), Math.round(sg / opaque), Math.round(sb / opaque)],
  } : { mode: 'canvas', opaque: 0 };
});

// 1) SVG 模式,定帧 250,把 SVG 画到离屏 canvas 统计
const svgStats = await page.evaluate(async () => {
  const a = window.__anim;
  a.goToAndStop(250, true);
  await new Promise((r) => setTimeout(r, 1500));
  const svgEl = document.querySelector('#previewInner svg');
  if (!svgEl) return { mode: 'no-svg' };
  const xml = new XMLSerializer().serializeToString(svgEl);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const cv = document.createElement('canvas');
  cv.width = 1920; cv.height = 1080;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, 1920, 1080);
  const d = cx.getImageData(0, 0, 1920, 1080).data;
  let opaque = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sr = 0, sg = 0, sb = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] > 0) {
      opaque++;
      const x = p % 1920, y = (p / 1920) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
    }
  }
  return opaque ? { mode: 'svg', opaque, bbox: [minX, minY, maxX, maxY], avg: [Math.round(sr / opaque), Math.round(sg / opaque), Math.round(sb / opaque)] } : { mode: 'svg', opaque: 0 };
});
console.log('SVG @250:', JSON.stringify(svgStats));

// 2) 切 Canvas,定帧 250
await page.select('#selRenderer', 'canvas');
await sleep(2500);
await page.evaluate(async () => { window.__anim.goToAndStop(250, true); await new Promise((r) => setTimeout(r, 1500)); });
console.log('CANVAS @250:', JSON.stringify(await statsCanvas()));

// 3) 仅文字层 vs 仅非文字层(逐元素隐藏)
const isolate = async (keepText) => page.evaluate(async (kt) => {
  const a = window.__anim;
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  const isText = (e) => e.data.ty === 5;
  for (const e of all) { e.hidden = kt ? !isText(e) : isText(e); }
  a.goToAndStop(250, true);
  await new Promise((r) => setTimeout(r, 1000));
  const c = document.querySelector('#previewInner canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
  for (const e of all) { e.hidden = false; }
  return opaque;
}, keepText);

console.log('text-only pixels @250:', await isolate(true));
console.log('non-text-only pixels @250:', await isolate(false));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

