// 全帧对比:MP4 帧 304 vs 页面帧 304(带序列),定位差异
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.fullcmp';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const MP4 = 'I:/Delta Force custom animation/tools/.mp4test/animation.mp4';

// MP4 帧 304
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MP4, '-vf', "select='eq(n\\,304)'", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/mp4.raw']);

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  const b64 = await page.evaluate(async () => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const renderer = window.__anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');
    renderer.renderFrame(304, true);
    const img = ctx.getImageData(0, 0, 1920, 1080);
    let bin = '';
    const arr = new Uint8ClampedArray(img.data.buffer);
    const STEP = 0x8000;
    for (let i = 0; i < arr.length; i += STEP) bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
    return btoa(bin);
  });
  fs.writeFileSync(TMP + '/page.raw', Buffer.from(b64, 'base64'));

  const mp4 = fs.readFileSync(TMP + '/mp4.raw');
  const pageF = fs.readFileSync(TMP + '/page.raw');
  // 页面帧合成背景
  const bg = [0x16, 0x18, 0x1d];
  const pageComp = Buffer.alloc(pageF.length);
  for (let i = 0; i < pageF.length; i += 4) {
    const a = pageF[i + 3] / 255;
    pageComp[i] = pageF[i] * a + bg[0] * (1 - a);
    pageComp[i + 1] = pageF[i + 1] * a + bg[1] * (1 - a);
    pageComp[i + 2] = pageF[i + 2] * a + bg[2] * (1 - a);
    pageComp[i + 3] = 255;
  }
  // 差异统计(阈值 60),并输出差异区域分布
  let diff = 0;
  const diffRows = {};
  for (let y = 0; y < 1080; y++) {
    let rowDiff = 0;
    for (let x = 0; x < 1920; x++) {
      const i = (y * 1920 + x) * 4;
      const d = Math.abs(mp4[i] - pageComp[i]) + Math.abs(mp4[i + 1] - pageComp[i + 1]) + Math.abs(mp4[i + 2] - pageComp[i + 2]);
      if (d > 60) { diff++; rowDiff++; }
    }
    if (rowDiff > 0) diffRows[y] = rowDiff;
  }
  console.log(`差异像素(阈值60): ${diff} (${((diff / (1920 * 1080)) * 100).toFixed(3)}%)`);
  const ys = Object.keys(diffRows).map(Number);
  if (ys.length) {
    console.log(`差异行范围: y[${Math.min(...ys)}..${Math.max(...ys)}]`);
    // 找出差异集中区域
    const bands = [];
    let start = ys[0], prev = ys[0];
    for (const y of ys.slice(1)) {
      if (y - prev > 20) { bands.push([start, prev]); start = y; }
      prev = y;
    }
    bands.push([start, prev]);
    console.log('差异带:', JSON.stringify(bands.map(([a, b]) => `y[${a}..${b}]`)));
  }
} finally {
  await browser.close();
}
