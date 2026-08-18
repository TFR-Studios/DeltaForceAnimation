// 检查6个镜像图层在各帧的可见性和画面,并输出当前整体ASCII图
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);

const info = await page.evaluate(async () => {
  const a = window.__anim;
  const inds = [7,18,20,21,22,23];
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(a.renderer.elements);
  // 逐帧检查6个图层的 isInRange 和变换矩阵平移
  const frames = [0, 10, 20, 30, 60, 120, 300, 500];
  const result = {};
  const svg = document.querySelector('#previewInner svg');
  const groups = Array.from(svg.querySelectorAll('[data-name], [name], g'));
  // 找到6个图层的 svg 元素:按 transform 对应或层级
  const targetEls = {};
  inds.forEach((ind) => {
    const e = all.find(x => x.data.ind === ind);
    if (e && e.elements) { targetEls[ind] = e.elements; }
  });
  for (const fr of frames) {
    a.goToAndStop(fr, true);
    // 读每个目标层的 finalTransform 平移(实际屏幕位置近似:localOpacity及范围)
  }
  return { count: all.length, svgText: svg ? svg.outerHTML.slice(0, 200) : null, has6: inds.map(i => { const e = all.find(x=>x.data.ind===i); return e ? { ind:i, inRange: e.isInRange, op: e.finalTransform?e.finalTransform.localOpacity:null } : null; }) };
});
console.log(JSON.stringify(info, null, 2));

// 用 SVG 序列化输出整体 ASCII 当前帧(120)
const ascii = await page.evaluate(async () => {
  const a = window.__anim;
  a.goToAndStop(120, true);
  await new Promise(r => setTimeout(r, 1000));
  const svg = document.querySelector('#previewInner svg');
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 1920, 1080);
  const d = cx.getImageData(0, 0, 1920, 1080).data;
  const ch = ' .:-=+*#%@'; const CW = 100, CH = 30;
  const rows = [];
  for (let cy = 0; cy < CH; cy++) {
    let row = '';
    for (let cxc = 0; cxc < CW; cxc++) {
      const x0 = Math.floor(cxc * 1920 / CW), x1 = Math.floor((cxc + 1) * 1920 / CW);
      const y0 = Math.floor(cy * 1080 / CH), y1 = Math.floor((cy + 1) * 1080 / CH);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * 1920 + x) * 4;
        if (d[i + 3] > 30) { sum += (d[i] + d[i+1] + d[i+2]) / 3; cnt++; }
      }
      row += cnt === 0 ? ' ' : ch[Math.min(9, Math.floor(sum / cnt / 25.6))];
    }
    rows.push(row);
  }
  return rows.join('\n');
});
console.log('=== 整体画面 @120 ===');
console.log(ascii);
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

