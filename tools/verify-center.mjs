import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1200);

async function bboxOf(dataPath, renderer, ind) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  data.layers = data.layers.filter(l => l.ind !== 1); // 去音频
  return await page.evaluate(async ({ dStr, renderer, ind }) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer, loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    await new Promise((r) => setTimeout(r, 2000));
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 400));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !(e.data.ind === ind);
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 400));
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, opaque = 0;
    if (renderer === 'canvas') {
      const cv = c.querySelector('canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) { if (d[i+3] > 0) { opaque++; const x = p % cv.width, y = (p / cv.width) | 0; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    } else {
      const svg = c.querySelector('svg');
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
      const cv2 = document.createElement('canvas'); cv2.width = 1920; cv2.height = 1080;
      const cx = cv2.getContext('2d'); cx.drawImage(img, 0, 0);
      const d2 = cx.getImageData(0, 0, 1920, 1080).data;
      for (let i = 0, p = 0; i < d2.length; i += 4, p++) { if (d2[i+3] > 0) { opaque++; const x = p % 1920, y = (p / 1920) | 0; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    }
    for (const e of all) e.data.hd = false;
    return opaque ? { minX, maxX, centerX: Math.round((minX + maxX) / 2), width: maxX - minX + 1, opaque } : { opaque: 0 };
  }, { dStr: JSON.stringify(data), renderer, ind });
}

// 对比 ind40 对局时间 居中前后(canvas)
const beforeC = await bboxOf('I:/Delta Force custom animation/animation/animation_data.pre-center-text.json', 'canvas', 40);
const afterC = await bboxOf('I:/Delta Force custom animation/animation/animation_data.json', 'canvas', 40);
console.log('canvas 对局时间 居中前:', JSON.stringify(beforeC));
console.log('canvas 对局时间 居中后:', JSON.stringify(afterC));

// svg 也验证一下
const beforeS = await bboxOf('I:/Delta Force custom animation/animation/animation_data.pre-center-text.json', 'svg', 40);
const afterS = await bboxOf('I:/Delta Force custom animation/animation/animation_data.json', 'svg', 40);
console.log('svg 对局时间 居中前:', JSON.stringify(beforeS));
console.log('svg 对局时间 居中后:', JSON.stringify(afterS));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
