import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);
const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
data.layers = data.layers.filter(l => l.ind !== 1);
const res = await page.evaluate(async (dStr) => {
  if (window.__anim) window.__anim.destroy();
  const c = document.getElementById('previewInner'); c.innerHTML = '';
  const anim = window.__lottie.loadAnimation({ container: c, renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
  await new Promise((r) => setTimeout(r, 2500));
  anim.renderer.renderFrame(200, true); // 先渲染建元素
  await new Promise((r) => setTimeout(r, 300));
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  const t = all.find(e => e.data.ind === 56);
  if (!t) return { found: false, count: all.length };
  const ft = t.finalTransform;
  let tx = null, ty = null;
  if (ft && ft.localMat && ft.localMat.props) { tx = ft.localMat.props[12]; ty = ft.localMat.props[13]; }
  for (const e of all) e.data.hd = !(e.data.ind === 56);
  anim.renderer.renderFrame(200, true);
  await new Promise((r) => setTimeout(r, 500));
  const cv = c.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i+3] > 0) { opaque++; const x = p % cv.width, y = (p / cv.width) | 0; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  for (const e of all) e.data.hd = false;
  return { found: true, count: all.length, localMat_tx: tx, localMat_ty: ty, opaque, bbox: opaque?[minX,minY,maxX,maxY]:null };
}, JSON.stringify(data));
console.log(JSON.stringify(res, null, 2));
await browser.close();
