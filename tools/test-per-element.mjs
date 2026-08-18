// 逐元素异常捕获:定位打断 Canvas 绘制循环的元素
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'canvas');
await sleep(2000);

const result = await page.evaluate(async () => {
  const a = window.__anim;
  const r = a.renderer;
  const errs = [];
  const hook = (fn, name, el) => function () {
    try { return fn.apply(this, arguments); } catch (err) {
      const nm = el.data && (el.data.nm || el.data.ind);
      errs.push(name + ' ty=' + el.data.ty + ' [' + nm + ']: ' + err.message);
      throw err;
    }
  };
  for (const e of r.elements) {
    if (!e) continue;
    e.prepareFrame = hook(e.prepareFrame, 'prepareFrame', e);
    e.renderFrame = hook(e.renderFrame, 'renderFrame', e);
  }
  await new Promise((res) => setTimeout(res, 1500));
  const c = document.querySelector('#previewInner canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
  return {
    frameInfo: document.getElementById('frameInfo').textContent,
    opaquePixels: opaque,
    errors: errs.slice(0, 10),
    errorCount: errs.length,
  };
});
console.log(JSON.stringify(result, null, 2));
console.log('pageerrors:', JSON.stringify(pageErrors));
await browser.close();

