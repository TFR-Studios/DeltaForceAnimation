// 验证 batch2:隔离 ind13/14/17,统计像素应全在右侧
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
  const inds = [13, 14, 17];
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  for (const e of all) e.data.hd = !inds.includes(e.data.ind);
  anim.renderer.renderFrame(30, true);
  await new Promise((r) => setTimeout(r, 800));
  const cv = c.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, left = 0, right = 0, minX = 1e9, maxX = -1;
  const w = cv.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i+3] > 0) {
      opaque++; const x = p % w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (x < w/2) left++; else right++;
    }
  }
  for (const e of all) e.data.hd = false;
  return { opaque, left, right, minX: minX===1e9?null:minX, maxX: maxX===-1?null:maxX };
}, JSON.stringify(data));
console.log(JSON.stringify(res, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

