// 分别渲染 原始/镜像 两份,隔离6个图层,输出ASCII图对比
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
await sleep(1200);

const orig = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirror-backup.json','utf8'));
const mirr = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

async function renderIsolated(data, label, frame) {
  const ascii = await page.evaluate(async ({ d, inds, drawframe }) => {
    if (window.__anim) window.__anim.destroy();
    const container = document.getElementById('previewInner');
    container.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container, renderer: 'svg', loop: false, autoplay: false, animationData: d });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 2000));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !inds.includes(e.data.ind);
    anim.renderer.renderFrame(drawframe, true);
    await new Promise((r) => setTimeout(r, 500));
    const svg = container.querySelector('svg');
    const xml = new XMLSerializer().serializeToString(svg);
    for (const e of all) e.data.hd = false;
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 1920, 1080);
    const dd = cx.getImageData(0, 0, 1920, 1080).data;
    const ch = ' .:-=+*#%@'; const CW = 100, CH = 28;
    const rows = [];
    for (let cy = 0; cy < CH; cy++) {
      let row = '';
      for (let cx0 = 0; cx0 < CW; cx0++) {
        const x0 = Math.floor(cx0 * 1920 / CW), x1 = Math.floor((cx0 + 1) * 1920 / CW);
        const y0 = Math.floor(cy * 1080 / CH), y1 = Math.floor((cy + 1) * 1080 / CH);
        let sum = 0, cnt = 0;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
          const i = (y * 1920 + x) * 4;
          if (dd[i+3] > 30) { sum += (dd[i]+dd[i+1]+dd[i+2])/3; cnt++; }
        }
        row += cnt === 0 ? ' ' : ch[Math.min(9, Math.floor(sum/cnt/25.6))];
      }
      rows.push(row);
    }
    return rows.join('\n');
  }, { d: data, inds: [7,18,20,21,22,23], drawframe: frame });
  console.log('\n===== ' + label + ' (仅6图层, 帧' + frame + ') =====');
  console.log(ascii);
}

await renderIsolated(orig, '原始(镜像前)', 120);
await renderIsolated(mirr, '镜像后', 120);
await browser.close();

