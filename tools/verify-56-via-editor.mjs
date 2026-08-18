// 用编辑器已加载的动画(带audioFactory)验证 ind56 渲染位置
import puppeteer from 'puppeteer-core';

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
await page.select('#selRenderer', 'canvas');
await sleep(2500);

const res = await page.evaluate(async () => {
  const anim = window.__anim;
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  for (const e of all) e.data.hd = !(e.data.ind === 56);
  anim.renderer.renderFrame(200, true);
  await new Promise((r) => setTimeout(r, 600));
  const cv = document.querySelector('#previewInner canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  const w = cv.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i+3] > 0) { opaque++; const x = p % w, y = (p / w) | 0; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  for (const e of all) e.data.hd = false;
  return { opaque, bbox: opaque?[minX,minY,maxX,maxY]:null };
});
console.log(JSON.stringify(res, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

