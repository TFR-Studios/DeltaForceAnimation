// 验证 ind56 左中上:隔离渲染,确认像素位置和无报错
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1200);

const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

const res = await page.evaluate(async (dStr) => {
  if (window.__anim) window.__anim.destroy();
  const c = document.getElementById('previewInner'); c.innerHTML = '';
  const anim = window.__lottie.loadAnimation({ container: c, renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
  window.__anim = anim;
  await new Promise((r) => setTimeout(r, 2000));
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  for (const e of all) e.data.hd = !(e.data.ind === 56);
  anim.renderer.renderFrame(60, true);
  await new Promise((r) => setTimeout(r, 800));
  const cv = c.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  const w = cv.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i+3] > 0) {
      opaque++; const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  for (const e of all) e.data.hd = false;
  return { opaque, minX: minX===1e9?null:minX, maxX: maxX===-1?null:maxX, minY: minY===1e9?null:minY, maxY: maxY===-1?null:maxY };
}, JSON.stringify(data));
console.log(JSON.stringify(res, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

