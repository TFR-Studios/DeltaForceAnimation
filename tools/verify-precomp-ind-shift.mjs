/* 验证「预合成 ind 平移」不影响渲染:同一份数据,一版原样、一版把被引用预合成的 ind 整体 +100000
 * (与站点里的 normalizePrecompInds 同一套逻辑),两版逐帧逐像素对比,应当完全一致。
 * 另外顺带验证:改预合成内图层的颜色后,画面确实变化(编辑真的生效)。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const lottieSrc = fs.readFileSync(ROOT + '/node_modules/lottie-web/build/player/lottie.min.js', 'utf8');
const iconB64 = fs.readFileSync(ROOT + '/animation_4/images/MallIcon_HafuCoins.png').toString('base64');
const BASE = 100000;
const raw = JSON.parse(fs.readFileSync(ROOT + '/animation_4/animation_data.json', 'utf8'));
const prep = (d) => { const c = JSON.parse(JSON.stringify(d)); for (const a of c.assets || []) if (typeof a.p === 'string' && a.p === 'MallIcon_HafuCoins.png') { a.p = 'ICON'; a.u = ''; a.e = 1; } c.layers = c.layers.filter((l) => l.ty !== 9); return c; };
const plain = prep(raw);
const shifted = prep(raw);
// 与站点同逻辑:被引用的预合成 ind/parent/tp 整体平移
for (const a of shifted.assets || []) {
  if (!Array.isArray(a.layers)) continue;
  const referenced = (shifted.layers || []).some((l) => l.refId === a.id);
  if (!referenced) continue;
  const map = new Map(a.layers.map((l) => [l.ind, l.ind + BASE]));
  for (const l of a.layers) {
    if (map.has(l.ind)) l.ind = map.get(l.ind);
    if (map.has(l.parent)) l.parent = map.get(l.parent);
    if (map.has(l.tp)) l.tp = map.get(l.tp);
  }
}
// 再准备一份「改了预合成内图层颜色」的版本
const recolored = JSON.parse(JSON.stringify(shifted));
const box = (recolored.assets || []).find((a) => a.id === '框');
const target = box.layers.find((l) => l.nm === '形状图层 6');
const w = (it) => { for (const x of it || []) { if (x.ty === 'fl') x.c = { ...x.c, k: [1, 0, 1, x.c.k[3] ?? 1] }; if (Array.isArray(x.it)) w(x.it); } };
w(target.shapes);
const FRAMES = [30, 60, 100, 130, 170, 200];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox','--disable-gpu'] });
try {
  const sigs = {};
  for (const [name, data] of [['原样', plain], ['ind平移', shifted], ['平移+改色', recolored]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.addScriptTag({ content: lottieSrc });
    sigs[name] = await page.evaluate(async (animJson, icon, frames) => {
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#202020';
      const host = document.createElement('div');
      host.style.cssText = 'width:1920px;height:1080px';
      document.body.appendChild(host);
      const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: animJson });
      await new Promise((r) => { anim.addEventListener('DOMLoaded', r); setTimeout(r, 8000); });
      const res = {};
      for (const f of frames) {
        anim.goToAndStop(f, true);
        await new Promise((r) => setTimeout(r, 250));
        const svg = host.querySelector('svg');
        const xml = new XMLSerializer().serializeToString(svg).replace(/href="[^"]*"/g, (m) => (m.includes('ICON') ? 'href="data:image/png;base64,' + icon + '"' : m));
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        try { await img.decode(); } catch { res[f] = null; continue; }
        const cv = document.createElement('canvas');
        cv.width = 1920; cv.height = 1080;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 1920, 1080);
        const px = ctx.getImageData(0, 0, 1920, 1080).data;
        res[f] = Array.from({ length: 1920 * 1080 }, (_, i) => px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2] * (px[i * 4 + 3] > 12 ? 1 : 0));
      }
      anim.destroy();
      return res;
    }, data, iconB64, FRAMES);
    await page.close();
  }
  const cmp = (a, b) => {
    const rows = [];
    for (const f of FRAMES) {
      const A = a[f], B = b[f];
      if (!A || !B) { rows.push(f + ':渲染失败'); continue; }
      let diff = 0;
      for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diff++;
      rows.push(f + ':' + (diff / A.length * 100).toFixed(3) + '%');
    }
    return rows.join('  ');
  };
  console.log('原样 vs ind平移(应全 0): ' + cmp(sigs['原样'], sigs['ind平移']));
  console.log('ind平移 vs 改预合成色(应 >0): ' + cmp(sigs['ind平移'], sigs['平移+改色']));
} finally { await browser.close(); }
