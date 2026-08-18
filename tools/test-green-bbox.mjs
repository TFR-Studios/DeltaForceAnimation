import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

const base = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
base.layers = base.layers.filter(l => l.ind !== 1);

async function measure(jVal) {
  const data = JSON.parse(JSON.stringify(base));
  const l = data.layers.find(x => x.ind === 48);
  l.t.d.k[0].s.j = jVal;
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    await new Promise((r) => setTimeout(r, 2500));
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 500));
    const svg = c.querySelector('svg');
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const dd = cx.getImageData(0, 0, 1920, 1080).data;
    // 找绿色像素(撤离成功 fc=[22,255,153])
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
    for (let i = 0, p = 0; i < dd.length; i += 4, p++) {
      const r = dd[i], g = dd[i+1], b = dd[i+2], a = dd[i+3];
      if (a > 20 && g > 200 && r < 120 && b > 90 && b < 200) {
        cnt++; const x = p % 1920, y = (p / 1920) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return cnt === 0 ? { cnt: 0 } : { cnt, minX, maxX, minY, maxY, centerX: Math.round((minX+maxX)/2), width: maxX-minX+1 };
  }, JSON.stringify(data));
}

console.log('j=0(左) 撤离成功绿色bbox:', JSON.stringify(await measure(0)));
console.log('j=1(右) 撤离成功绿色bbox:', JSON.stringify(await measure(1)));
console.log('j=2(中) 撤离成功绿色bbox:', JSON.stringify(await measure(2)));
await browser.close();
