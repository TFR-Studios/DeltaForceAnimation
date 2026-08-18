// 按图层类型隔离:定位 Canvas 漏画的图层类型 + 字体加载确认
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

const result = await page.evaluate(async () => {
  const a = window.__anim;
  a.goToAndStop(250, true);
  await new Promise((r) => setTimeout(r, 1200));

  const fontsOK = {
    medium: document.fonts.check('16px "ProjectDType-Medium"'),
    mediumFam: document.fonts.check('16px "ProjectD Type"'),
    curve: document.fonts.check('16px "ProjectDTypeCurve-Bold"'),
    curveFam: document.fonts.check('16px "ProjectD Type Curve"'),
  };

  const collect = () => {
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(a.renderer.elements);
    return all;
  };
  const all = collect();
  const byType = {};
  for (const e of all) byType[e.data.ty] = (byType[e.data.ty] || 0) + 1;

  const countPixels = () => {
    const c = document.querySelector('#previewInner canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    return opaque;
  };
  const setHidden = (ty, hide) => { for (const e of all) if (e.data.ty === ty) e.data.hd = hide; };
  const sample = async (ty) => {
    setHidden(ty, true);
    a.goToAndStop(250, true);
    await new Promise((r) => setTimeout(r, 600));
    const hiddenCount = countPixels();
    setHidden(ty, false);
    a.goToAndStop(250, true);
    await new Promise((r) => setTimeout(r, 600));
    return hiddenCount;
  };

  const baseline = countPixels();
  const out = { byType, fontsOK, baseline };
  for (const ty of [0, 2, 4, 5]) {
    out['hide_ty' + ty] = await sample(ty);
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

