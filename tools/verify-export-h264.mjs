// 导出回归验证(真实浏览器跑一遍导出,把成品落盘到 tools/.verify/)
//   用法: node tools/verify-export-h264.mjs <exposed|extraction> <mp4|avi>
//   前置: npm run dev (dev server 需跑在 5173)
// 背景:「位置暴露动画」画布 3840×1080,而 WebCodecs 里写死的 AVC Level 4.2 只支持到
//   ~1920×1080,Chrome 会静默关闭编码器,下一次 encode() 抛 closed codec。
//   本脚本正是用于回归这条路径(MVP4 / AVI-H.264 两种容器),并检查页面无报错。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'I:/Delta Force custom animation/tools/.verify';
fs.mkdirSync(OUT, { recursive: true });

const target = process.argv[2] || 'exposed';
const format = process.argv[3] || 'mp4';
const label = target + '-' + format + '-' + Date.now();

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 180000 });

if (target === 'exposed') {
  await page.evaluate(() => { const s = document.getElementById('selAnim'); s.value = 'exposed'; s.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入') && document.getElementById('selAnim').value === 'exposed', { timeout: 180000 });
  await sleep(3000);
}

// 捕获导出 blob
await page.evaluate(() => {
  window.__captured = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = function (blob) { if (blob && blob.size > 1000) window.__captured = blob; return orig.call(this, blob); };
});

// 设定导出选项并点击导出
const meta = await page.evaluate((fmt) => {
  const trans = document.getElementById('chkTransparent');
  if (trans.checked) trans.click();
  const f = document.getElementById('selFormat');
  f.value = fmt;
  f.dispatchEvent(new Event('change'));
  const r = document.getElementById('selRenderer');
  if (r.value !== 'canvas') { r.value = 'canvas'; r.dispatchEvent(new Event('change')); }
  const c = document.querySelector('#previewInner canvas');
  document.getElementById('btnExport').click();
  return { anim: document.getElementById('selAnim').value, format: f.value, transparent: trans.checked,
           renderer: r.value, canvas: c ? c.width + 'x' + c.height : null };
}, format);
console.log('页面状态:', JSON.stringify(meta));

const t0 = Date.now();
await page.waitForFunction(() => {
  const t = document.getElementById('statusbar').textContent;
  return t.includes('导出完成') || t.includes('导出失败') || t.includes('已取消');
}, { timeout: 1800000, polling: 2000 });
const st = await page.evaluate(() => ({
  status: document.getElementById('statusbar').textContent,
  size: window.__captured ? window.__captured.size : -1,
  type: window.__captured ? window.__captured.type : null,
}));
console.log('导出耗时(秒):', ((Date.now() - t0) / 1000).toFixed(1));
console.log('结果:', JSON.stringify(st));
if (st.size > 0) {
  const CHUNK = 8 * 1024 * 1024;
  const file = OUT + '/' + label + '.' + (format === 'mp4' ? 'mp4' : 'avi');
  const fd = fs.openSync(file, 'w');
  for (let off = 0; off < st.size; off += CHUNK) {
    const b64 = await page.evaluate(async ({ off, len }) => {
      const r = new FileReader();
      return new Promise((res) => { r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(window.__captured.slice(off, off + len)); });
    }, { off, len: Math.min(CHUNK, st.size - off) });
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  console.log('已写入:', file, fs.statSync(file).size);
}
console.log('页面错误:', errs.length ? JSON.stringify(errs.slice(0, 10)) : '无');
await browser.close();
