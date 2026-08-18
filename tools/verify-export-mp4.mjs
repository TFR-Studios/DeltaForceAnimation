// 验证:①SVG 渲染器序列切换 ②MP4 导出后序列内容在视频中正确出现
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.mp4test';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const OUT = TMP + '/animation.mp4';

// 序列帧 304 的 raw(参考)
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'I:/Delta Force custom animation/animation/ccreptile/ccreptitle_00304.png', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq304.raw']);
const seq304 = fs.readFileSync(TMP + '/seq304.raw');

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  // ① SVG 渲染器验证
  const svgReport = await page.evaluate(async () => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'svg') { sel.value = 'svg'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner svg') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const renderer = window.__anim.renderer;
    let seqEl = null;
    const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
    walk(renderer.elements);
    renderer.renderFrame(304, true);
    const NS = 'http://www.w3.org/1999/xlink';
    return {
      found: !!seqEl,
      hrefSwitched: seqEl && seqEl.imageElem ? seqEl.imageElem.getAttributeNS(NS, 'href').slice(0, 30) : 'none',
      patched: seqEl ? typeof seqEl.renderFrame === 'function' && seqEl.__seqElPatched === true : false,
    };
  });
  console.log('SVG:', JSON.stringify(svgReport));

  // ② MP4 导出(切回 canvas)
  await page.evaluate(() => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'mp4';
    f.dispatchEvent(new Event('change'));
    window.__capturedBlob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type && blob.type.indexOf('mp4') !== -1) window.__capturedBlob = blob;
      return orig.call(this, blob);
    };
  });
  await page.evaluate(() => document.getElementById('btnExport').click());
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 900000 });
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('MP4 导出完成, size =', size);
  if (size <= 0) throw new Error('未捕获 MP4');

  const CHUNK = 6 * 1024 * 1024;
  const fd = fs.openSync(OUT, 'w');
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = await page.evaluate(async ({ off, len }) => {
      const blob = window.__capturedBlob;
      const r = new FileReader();
      return new Promise((res) => { r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob.slice(off, off + len)); });
    }, { off, len: Math.min(CHUNK, size - off) });
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  console.log('MP4 已写入:', OUT, fs.statSync(OUT).size, 'bytes');

  // ffmpeg 提取第 304 帧
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', OUT, '-vf', "select='eq(n\\,304)'", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/mp4-304.raw']);
  const mp4f = fs.readFileSync(TMP + '/mp4-304.raw');
  // 与序列 PNG 对比(MP4 有损,阈值放宽到 150)
  let seqPx = 0, matched = 0;
  for (let y = 0; y < 1080; y++) {
    for (let x = 0; x < 1920; x++) {
      const i = (y * 1920 + x) * 4;
      if (seq304[i + 3] > 8) {
        seqPx++;
        const diff = Math.abs(mp4f[i] - seq304[i]) + Math.abs(mp4f[i + 1] - seq304[i + 1]) + Math.abs(mp4f[i + 2] - seq304[i + 2]);
        if (diff < 150) matched++;
      }
    }
  }
  console.log(`MP4 帧304 与序列PNG匹配: ${matched}/${seqPx} (${((matched / seqPx) * 100).toFixed(1)}%) ${matched / seqPx > 0.8 ? '✓ 序列已正确导出到视频' : '✗'}`);
} finally {
  await browser.close();
}
