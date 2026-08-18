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
base.layers = base.layers.filter(l => l.ind !== 1); // 去音频

async function measure(jVal) {
  const data = JSON.parse(JSON.stringify(base));
  const l = data.layers.find(x => x.ind === 48);
  l.t.d.k[0].s.j = jVal;
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    await new Promise((r) => setTimeout(r, 2000));
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 400));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !(e.data.ind === 48);
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 300));
    const svg = c.querySelector('svg');
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const dd = cx.getImageData(0, 0, 1920, 1080).data;
    let minX = 1e9, maxX = -1;
    for (let i = 0, p = 0; i < dd.length; i += 4, p++) { if (dd[i+3] > 20) { const x = p % 1920; if (x < minX) minX = x; if (x > maxX) maxX = x; } }
    for (const e of all) e.data.hd = false;
    return minX === 1e9 ? null : { minX, maxX, width: maxX - minX + 1, center: Math.round((minX + maxX) / 2) };
  }, JSON.stringify(data));
}

const r0 = await measure(0);
const r1 = await measure(1);
const r2 = await measure(2);
console.log('j=0(左):', JSON.stringify(r0));
console.log('j=1:', JSON.stringify(r1));
console.log('j=2:', JSON.stringify(r2));
await browser.close();
