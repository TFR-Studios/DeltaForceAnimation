// 验证镜像:隔离这6个图层,统计像素分布应在画面右侧
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

const stats = await page.evaluate(async () => {
  const a = window.__anim;
  const inds = [7,18,20,21,22,23];
  // 收集所有文字/形状层,把非目标层全部隐藏,只留目标6个
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  const isTarget = (e) => inds.includes(e.data.ind);
  for (const e of all) { e.data.hd = !isTarget(e); }
  a.goToAndStop(120, true);
  await new Promise((r) => setTimeout(r, 1200));
  const c = document.querySelector('#previewInner canvas');
  if (!c) {
    // svg: 改成直接量 svg 里这6个g的位置
    return { renderer: 'svg', error: 'no canvas (svg mode)' };
  }
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let left = 0, right = 0, opaque = 0, minX = 1e9, maxX = -1;
  const w = c.width, xMid = w / 2;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] > 0) {
      opaque++; const x = p % w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (x < xMid) left++; else right++;
    }
  }
  for (const e of all) e.data.hd = false;
  return { renderer: 'canvas', opaque, left, right, minX, maxX, mid: xMid };
});
console.log(JSON.stringify(stats, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

