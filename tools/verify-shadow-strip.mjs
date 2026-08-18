// 验证:移除投影后,撤离成功在 SVG 下不再是糊块,Canvas 也正常
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
await sleep(1200);

const before = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.preshadow.json','utf8'));
const after = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

async function isolate48(data, renderer) {
  return await page.evaluate(async ({ dStr, renderer }) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer, loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 2000));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !(e.data.ind === 48);
    if (renderer === 'canvas') anim.renderer.renderFrame(200, true);
    else anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 600));
    let opaque = 0;
    if (renderer === 'canvas') {
      const cv = c.querySelector('canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i+3] > 0) opaque++;
    } else {
      const svg = c.querySelector('svg');
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
      const cv2 = document.createElement('canvas'); cv2.width = 1920; cv2.height = 1080;
      const cx = cv2.getContext('2d'); cx.drawImage(img, 0, 0, 1920, 1080);
      const d2 = cx.getImageData(0, 0, 1920, 1080).data;
      for (let i = 3; i < d2.length; i += 4) if (d2[i+3] > 0) opaque++;
    }
    for (const e of all) e.data.hd = false;
    return opaque;
  }, { dStr: JSON.stringify(data), renderer });
}

console.log('撤离成功(仅此层)像素量, 帧200:');
console.log('  SVG  移除前:', await isolate48(before, 'svg'));
console.log('  SVG  移除后:', await isolate48(after, 'svg'));
console.log('  Canvas 移除前:', await isolate48(before, 'canvas'));
console.log('  Canvas 移除后:', await isolate48(after, 'canvas'));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

