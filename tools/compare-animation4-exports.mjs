/* 新旧两版导出的对比(每版都在独立页面里渲染,避免同页多实例互相干扰):
 *   数据 A = 重新导出的 animations/animation_4/animation_data.json(Bodymovin 5.12.2)
 *   数据 B = 旧版备份 animation_data.pre-matte-fix.json(Bodymovin 5.6.10)
 * 输出每帧可见像素占比 + SVG 关键帧截图,用来确认「层级/遮罩」是否已经正常。
 * 用法:node tools/compare-animation4-exports.mjs   (需先 npm run dev 起站,本地 5173) */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const OUT = ROOT + '/tools/.mission-check';
fs.mkdirSync(OUT, { recursive: true });
const lottieSrc = fs.readFileSync(ROOT + '/node_modules/lottie-web/build/player/lottie.min.js', 'utf8');
const iconB64 = fs.readFileSync(ROOT + '/animations/animation_4/images/MallIcon_HafuCoins.png').toString('base64');
const versions = {
  '新版(5.12.2)': ROOT + '/animations/animation_4/animation_data.json',
  '旧版(5.6.10)': ROOT + '/animations/animation_4/animation_data.pre-reexport.json',
};
const FRAMES = [20, 40, 60, 100, 130, 150, 165, 180, 200];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox','--disable-gpu'] });
try {
  for (const [name, file] of Object.entries(versions)) {
    if (!fs.existsSync(file)) { console.log(name + ': 文件不存在,跳过'); continue; }
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of d.assets || []) if (typeof a.p === 'string' && a.p === 'MallIcon_HafuCoins.png') { a.p = 'ICON'; a.u = ''; a.e = 1; }
    d.layers = (d.layers || []).filter((l) => l.ty !== 9); // 新版带的视频图层:站点里同样会丢掉,这里保持一致
    for (const renderer of ['svg', 'canvas']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.addScriptTag({ content: lottieSrc });
      const res = await page.evaluate(async (animJson, r, icon, frames) => {
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;background:#202020';
        const host = document.createElement('div');
        host.style.cssText = 'width:1920px;height:1080px';
        document.body.appendChild(host);
        const anim = window.lottie.loadAnimation({ container: host, renderer: r, loop: false, autoplay: false, animationData: animJson });
        await new Promise((rr) => { anim.addEventListener('DOMLoaded', rr); setTimeout(rr, 8000); });
        const measure = async (f) => {
          anim.goToAndStop(f, true);
          await new Promise((rr) => setTimeout(rr, 150));
          if (r === 'canvas') {
            const cv = host.querySelector('canvas');
            const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 12) n++;
            return +(n / (cv.width * cv.height) * 100).toFixed(2);
          }
          const svg = host.querySelector('svg');
          const xml = new XMLSerializer().serializeToString(svg).replace(/href="[^"]*"/g, (m) => (m.includes('ICON') ? 'href="data:image/png;base64,' + icon + '"' : m));
          const img = new Image();
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
          try { await img.decode(); } catch { return -1; }
          const cv = document.createElement('canvas');
          cv.width = 1920; cv.height = 1080;
          cv.getContext('2d').drawImage(img, 0, 0, 1920, 1080);
          const px = cv.getContext('2d').getImageData(0, 0, 1920, 1080).data;
          let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 12) n++;
          return +(n / (1920 * 1080) * 100).toFixed(2);
        };
        const out = [];
        for (const f of frames) out.push(await measure(f));
        anim.destroy();
        return out;
      }, d, renderer, iconB64, FRAMES);
      console.log((name + ' / ' + renderer).padEnd(24) + FRAMES.map((f, i) => f + ':' + res[i] + '%').join('  '));
      await page.close();
    }
    // SVG 关键帧截图(独立页面)
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(URL + '_blank5.html', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.addScriptTag({ content: lottieSrc });
    for (const f of [60, 130, 180]) {
      await page.evaluate(async (animJson, fr) => {
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;background:#202020';
        const host = document.createElement('div');
        host.style.cssText = 'width:1920px;height:1080px';
        document.body.appendChild(host);
        const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: animJson });
        await new Promise((rr) => { anim.addEventListener('DOMLoaded', rr); setTimeout(rr, 8000); });
        anim.goToAndStop(fr, true);
        await new Promise((rr) => setTimeout(rr, 250));
      }, d, f);
      await page.screenshot({ path: OUT + '/4-' + (name.startsWith('新') ? 'new' : 'old') + '-' + f + '.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    }
    await page.close();
    console.log(name + ': 截图 → tools/.mission-check/4-' + (name.startsWith('新') ? 'new' : 'old') + '-{60,130,180}.png');
  }
} finally { await browser.close(); }
