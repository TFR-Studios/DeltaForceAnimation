// 验证调试版:只显示6个镜像图层,统计像素位置(应全在右侧)
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
await sleep(1500);

const res = await page.evaluate(async () => {
  const a = window.__anim;
  // 用 canvas 渲染器验证像素
  document.getElementById('selRenderer').value = 'canvas';
  document.getElementById('selRenderer').dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 2500));
  const anim = window.__anim;
  anim.renderer.renderFrame(30, true);
  await new Promise((r) => setTimeout(r, 800));
  const c = document.querySelector('#previewInner canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, left = 0, right = 0, minX = 1e9, maxX = -1, minY=1e9, maxY=-1;
  const w = c.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i+3] > 0) {
      opaque++; const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x < w/2) left++; else right++;
    }
  }
  return { opaque, left, right, minX: minX===1e9?null:minX, maxX: maxX===-1?null:maxX, minY:minY===1e9?null:minY, maxY:maxY===-1?null:maxY };
});
console.log(JSON.stringify(res, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

