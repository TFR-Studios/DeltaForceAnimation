import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(import.meta.dirname, '.blast-check');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1920, height: 1080 } });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast' && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 150 });
  await sleep(1500);
  const mp4b64 = fs.readFileSync(path.join(OUT, 'exp/animation.mp4')).toString('base64');
  const res = await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const v = document.createElement('video'); v.src = url; v.muted = true;
    await new Promise((r) => { v.onloadeddata = r; setTimeout(r, 8000); });
    const W = 240, H = 135;
    // 导出帧的指纹
    const vids = [];
    for (const f of [10, 20, 30, 40, 60, 90]) {
      v.currentTime = f / 60;
      await new Promise((r) => { v.onseeked = r; setTimeout(r, 1800); });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(v, 0, 0, W, H);
      vids.push({ f, d: Array.from(cx.getImageData(0,0,W,H).data) });
    }
    URL.revokeObjectURL(url);
    // 预览帧的指纹(用真实舞台截图不可行,这里用 SVG 光栅化——与导出同一路径,便于比对偏移)
    const XL='http://www.w3.org/1999/xlink';
    const anim = window.__anim;
    const svg = document.querySelector('#previewInner svg');
    const cache = new Map();
    const rasters = [];
    for (const f of [0,5,10,15,20,25,30,35,40,45,50,55,60,70,80]) {
      anim.pause(); anim.goToAndStop(f, true);
      await new Promise((r) => setTimeout(r, 240));
      const c = svg.cloneNode(true);
      c.setAttribute('width','1920'); c.setAttribute('height','1080'); c.setAttribute('viewBox','0 0 1920 1080');
      for (const im of Array.from(c.querySelectorAll('image'))) {
        const href = im.getAttributeNS(XL,'href') || im.getAttribute('href') || '';
        if (!href || href.startsWith('data:')) continue;
        let d = cache.get(href);
        if (!d) { const b = await (await fetch(href)).blob(); d = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(b); }); cache.set(href, d); }
        im.setAttributeNS(XL,'href',d); im.setAttribute('href',d);
      }
      const xml = new XMLSerializer().serializeToString(c);
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      if (img) cx.drawImage(img, 0, 0, W, H);
      rasters.push({ f, d: Array.from(cx.getImageData(0,0,W,H).data) });
    }
    const score = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]); return s / (a.length / 4) / 3; };
    const table = [];
    for (const vv of vids) {
      const row = { videoF: vv.f, best: null };
      for (const rr of rasters) { const s = score(vv.d, rr.d); if (!row.best || s < row.best.score) row.best = { previewF: rr.f, score: +s.toFixed(2) }; }
      table.push(row);
    }
    return table;
  }, mp4b64);
  for (const r of res) console.log('导出帧 ' + r.videoF + ' → 最接近的预览帧 ' + r.best.previewF + ' (差异 ' + r.best.score + ')');
} finally { await browser.close(); }