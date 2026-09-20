import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const lottieSrc = fs.readFileSync(ROOT + '/node_modules/lottie-web/build/player/lottie.min.js', 'utf8');
const iconB64 = fs.readFileSync(ROOT + '/animation_4/images/MallIcon_HafuCoins.png').toString('base64');
const versions = { '改前': 'animation_data.pre-color-normalize.json', '改后': 'animation_data.json' };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox','--disable-gpu'] });
try {
  for (const [name, file] of Object.entries(versions)) {
    const d = JSON.parse(fs.readFileSync(ROOT + '/animation_4/' + file, 'utf8'));
    for (const a of d.assets || []) if (a.p === 'MallIcon_HafuCoins.png') { a.p = 'ICON'; a.u = ''; a.e = 1; }
    d.layers = d.layers.filter((l) => l.ty !== 9);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.addScriptTag({ content: lottieSrc });
    const res = await page.evaluate(async (animJson, icon, frames) => {
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#202020';
      const host = document.createElement('div');
      host.style.cssText = 'width:1920px;height:1080px';
      document.body.appendChild(host);
      const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: animJson });
      await new Promise((rr) => { anim.addEventListener('DOMLoaded', rr); setTimeout(rr, 8000); });
      const out = [];
      for (const f of frames) {
        anim.goToAndStop(f, true);
        await new Promise((rr) => setTimeout(rr, 250));
        const svg = host.querySelector('svg');
        const xml = new XMLSerializer().serializeToString(svg).replace(/href="[^"]*"/g, (m) => (m.includes('ICON') ? 'href="data:image/png;base64,' + icon + '"' : m));
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        try { await img.decode(); } catch { out.push({ f, error: 'decode' }); continue; }
        const cv = document.createElement('canvas');
        cv.width = 1920; cv.height = 1080;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 1920, 1080);
        const px = ctx.getImageData(0, 0, 1920, 1080).data;
        // 统计「接近参考蓝」的不透明像素数(容差 12),用于判断颜色确实变了
        let nearA = 0, nearB = 0, opaque = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] <= 12) continue;
          opaque++;
          const dr = px[i] - 0x77, dg = px[i + 1] - 0xb0, db = px[i + 2] - 0xf0;
          if (dr * dr + dg * dg + db * db < 12 * 12) nearA++;
          const er = px[i] - 0x78, eg = px[i + 1] - 0xc5, eb = px[i + 2] - 0xf3;
          if (er * er + eg * eg + eb * eb < 12 * 12) nearB++;
        }
        out.push({ f, opaque, near77B0F0: nearA, near78C5F3: nearB });
      }
      anim.destroy();
      return out;
    }, d, iconB64, [60, 130, 190]);
    console.log('=== ' + name + ' ===');
    for (const r of res) console.log('  帧 ' + r.f + ': 不透明 ' + r.opaque + '  近 #77B0F0 ' + r.near77B0F0 + '  近 #78C5F3 ' + r.near78C5F3);
    await page.close();
  }
} finally { await browser.close(); }
