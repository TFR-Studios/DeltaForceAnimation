// 对比:ind56 在 修改前(备份) vs 修改后,隔离渲染看像素
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
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

async function test(dataPath, label) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 3000));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    const t = all.find(e => e.data.ind === 56);
    for (const e of all) e.data.hd = !(e.data.ind === 56);
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 500));
    const cv = c.querySelector('canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i+3] > 0) { opaque++; const x = p % cv.width, y = (p / cv.width) | 0; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    const imgLoaded = t && t.img ? (t.img.complete && t.img.naturalWidth > 0) : 'no-img-prop';
    for (const e of all) e.data.hd = false;
    return { opaque, bbox: opaque?[minX,minY,maxX,maxY]:null, imgLoaded, elemExists: !!t };
  }, JSON.stringify(data));
}

console.log('修改前(备份):', JSON.stringify(await test('I:/Delta Force custom animation/animation/animation_data.pre-ccreptile-fix.json', 'before')));
console.log('修改后(当前):', JSON.stringify(await test('I:/Delta Force custom animation/animation/animation_data.json', 'after')));
await browser.close();

