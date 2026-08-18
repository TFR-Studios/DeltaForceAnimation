// 逐文字层诊断:singleShape/letters/renderedLetters/单独绘制像素
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
await page.select('#selRenderer', 'canvas');
await sleep(2500);

const diag = await page.evaluate(async () => {
  const a = window.__anim;
  a.renderer.renderFrame(250, true);
  await new Promise((r) => setTimeout(r, 800));
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  const texts = all.filter((e) => e.data.ty === 5);
  const count = () => {
    const c = document.querySelector('#previewInner canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    return opaque;
  };
  const out = [];
  for (const t of texts) {
    const doc = t.textProperty.currentData;
    // 隐藏其它所有元素,只画当前文字层
    for (const e of all) if (e !== t) e.data.hd = true;
    t.data.hd = false;
    a.renderer.renderFrame(250, true);
    await new Promise((r) => setTimeout(r, 250));
    const px = count();
    for (const e of all) e.data.hd = false;
    out.push({
      nm: t.data.nm,
      singleShape: !!t.data.singleShape,
      hasL: Array.isArray(doc.l),
      lLen: Array.isArray(doc.l) ? doc.l.length : null,
      renderedLen: (t.textAnimator.renderedLetters || []).length,
      font: doc.f,
      text: String(doc.t || '').slice(0, 12),
      fc: doc.fc ? doc.fc.map((v) => Math.round(v * 255)) : null,
      sc: doc.sc ? doc.sc.map((v) => Math.round(v * 255)) : null,
      sw: doc.sw,
      soloPixels: px,
    });
  }
  a.renderer.renderFrame(250, true);
  return out;
});
for (const d of diag) console.log(JSON.stringify(d));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

