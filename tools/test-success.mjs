// 定位「撤离成功」在 canvas 下 250 帧被错误绘制的原因
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
await sleep(1200);

// CANVAS 模式:查看该层的逐字母透明度与绘制区域
await page.select('#selRenderer', 'canvas');
await sleep(2500);
const canvasInfo = await page.evaluate(async () => {
  const a = window.__anim;
  a.renderer.renderFrame(250, true);
  await new Promise((r) => setTimeout(r, 500));
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  const t = all.find((e) => e.data.nm === '撤离成功');
  const d = t.textProperty.currentData;
  const rendered = (t.textAnimator.renderedLetters || []).map(function (r) {
    return { o: r.o, fc: r.fc, p: Array.from(r.p || []) };
  });
  for (const e of all) { if (e !== t) e.data.hd = true; }
  t.data.hd = false;
  a.renderer.renderFrame(250, true);
  await new Promise((r) => setTimeout(r, 400));
  const c = document.querySelector('#previewInner canvas');
  const dd = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let i = 0, p = 0; i < dd.length; i += 4, p++) {
    if (dd[i + 3] > 0) { opaque++; const x = p % c.width, y = (p / c.width) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const e of all) e.data.hd = false;
  return {
    ip: t.data.ip, op: t.data.op, st: t.data.st,
    layerOpacityAnim: JSON.stringify(t.data.ks && t.data.ks.o ? t.data.ks.o : null).slice(0, 220),
    finalOpacity: t.finalTransform ? t.finalTransform.localOpacity : null,
    isInRange: t.isInRange, hidden: t.hidden,
    renderedLetters: rendered.slice(0, 6),
    soloPixels: opaque,
    bbox: opaque ? [minX, minY, maxX, maxY] : null,
    finalSize: d.finalSize,
  };
});
console.log('CANVAS:', JSON.stringify(canvasInfo, null, 2));
await browser.close();

