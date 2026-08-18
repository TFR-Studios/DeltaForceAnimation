// 决定性实验:canvas 身份与直接绘制
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
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'canvas');
await sleep(2500);

const info = await page.evaluate(async () => {
  const a = window.__anim;
  const r = a.renderer;
  const domCanvas = document.querySelector('#previewInner canvas');
  const raw = r.canvasContext;
  const sameCanvas = domCanvas === raw.canvas;
  const ctx2 = domCanvas.getContext('2d');
  const sameCtx = ctx2 === raw;
  // 1) 用 renderer 自己的 raw ctx 画色块
  raw.save(); raw.fillStyle = '#ff0000'; raw.fillRect(10, 10, 200, 200); raw.restore();
  await new Promise((res) => setTimeout(res, 300));
  const px = ctx2.getImageData(10, 10, 1, 1).data;
  const afterDraw = Array.from(px);
  ctx2.clearRect(0, 0, domCanvas.width, domCanvas.height);
  // 2) 统计元素构建情况
  const built = r.elements.filter(Boolean).length;
  const total = r.layers.length;
  // 3) 元素类型分布
  const types = {};
  for (let i = 0; i < r.elements.length; i++) {
    const e = r.elements[i];
    if (!e) { types['null'] = (types['null'] || 0) + 1; continue; }
    const t = e.data ? e.data.ty : '?';
    types[t] = (types[t] || 0) + 1;
  }
  return {
    sameCanvas, sameCtx,
    pxAfterManualDraw: afterDraw,
    builtElements: built + ' / ' + total,
    elementTypes: types,
    canvasAttrs: { w: domCanvas.width, h: domCanvas.height },
    rendererKey: { renderedFrame: r.renderedFrame, transformCanvas: r.transformCanvas },
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();

