/* 新旧数据逐像素对比(每个变体独立页面渲染):
 * 记录「颜色变化是否只出现在预期位置」—— 便于确认归一化没有误伤其它画面内容。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const OUT = ROOT + '/tools/.mission-check';
fs.mkdirSync(OUT, { recursive: true });
const lottieSrc = fs.readFileSync(ROOT + '/node_modules/lottie-web/build/player/lottie.min.js', 'utf8');
const iconB64 = fs.readFileSync(ROOT + '/animations/animation_4/images/MallIcon_HafuCoins.png').toString('base64');
const versions = {
  '改后': ROOT + '/animations/animation_4/animation_data.json',
  '改前': ROOT + '/animations/animation_4/animation_data.pre-color-normalize.json',
};
const FRAMES = [40, 80, 120, 150, 180];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox','--disable-gpu'] });
try {
  const sigs = {};
  for (const [name, file] of Object.entries(versions)) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of d.assets || []) if (typeof a.p === 'string' && a.p === 'MallIcon_HafuCoins.png') { a.p = 'ICON'; a.u = ''; a.e = 1; }
    d.layers = (d.layers || []).filter((l) => l.ty !== 9);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.addScriptTag({ content: lottieSrc });
    const out = await page.evaluate(async (animJson, icon, frames) => {
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#202020';
      const host = document.createElement('div');
      host.style.cssText = 'width:1920px;height:1080px';
      document.body.appendChild(host);
      const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: animJson });
      await new Promise((rr) => { anim.addEventListener('DOMLoaded', rr); setTimeout(rr, 8000); });
      const res = {};
      for (const f of frames) {
        anim.goToAndStop(f, true);
        await new Promise((rr) => setTimeout(rr, 250));
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
        const arr = new Uint8Array(1920 * 1080);
        let n = 0;
        for (let i = 0, p = 0; i < px.length; i += 4, p++) { arr[p] = px[i + 3]; if (px[i + 3] > 12) n++; }
        res[f] = { a: Array.from(arr), pct: +(n / (1920 * 1080) * 100).toFixed(2) };
      }
      anim.destroy();
      return res;
    }, d, iconB64, FRAMES);
    sigs[name] = out;
    await page.close();
  }
  for (const f of FRAMES) {
    const a = sigs['改前'][f], b = sigs['改后'][f];
    if (!a || !b) { console.log('帧 ' + f + ': 渲染失败'); continue; }
    let diff = 0;
    for (let i = 0; i < a.a.length; i++) if (Math.abs(a.a[i] - b.a[i]) > 16) diff++;
    console.log('帧 ' + String(f).padStart(3) + '  变化格点 ' + (diff / a.a.length * 100).toFixed(2) + '%   可见像素 ' + a.pct + '% → ' + b.pct + '%');
  }
  // 存一张改后的图,便于人眼看新的描边配色
  const d2 = JSON.parse(fs.readFileSync(versions['改后'], 'utf8'));
  for (const a of d2.assets || []) if (a.p === 'MallIcon_HafuCoins.png') { a.p = 'ICON'; a.u = ''; a.e = 1; }
  d2.layers = d2.layers.filter((l) => l.ty !== 9);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.addScriptTag({ content: lottieSrc });
  for (const f of [130, 180]) {
    await page.evaluate(async (animJson, icon, fr) => {
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#202020';
      const host = document.createElement('div');
      host.style.cssText = 'width:1920px;height:1080px';
      document.body.appendChild(host);
      const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: animJson });
      await new Promise((rr) => { anim.addEventListener('DOMLoaded', rr); setTimeout(rr, 8000); });
      anim.goToAndStop(fr, true);
      await new Promise((rr) => setTimeout(rr, 300));
      const svg = host.querySelector('svg');
      const xml = new XMLSerializer().serializeToString(svg).replace(/href="[^"]*"/g, (m) => (m.includes('ICON') ? 'href="data:image/png;base64,' + icon + '"' : m));
      const img2 = new Image();
      img2.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img2.decode();
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#202020';
      const host2 = document.createElement('div');
      host2.style.cssText = 'width:1920px;height:1080px';
      document.body.appendChild(host2);
      host2.appendChild(img2);
    }, d2, iconB64, f);
    await page.screenshot({ path: OUT + '/color-' + f + '.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  }
  console.log('截图 → tools/.mission-check/color-{130,180}.png');
} finally { await browser.close(); }
