// 精确验证:①img.src 是否逐帧切换 ②页面帧中序列内容区域是否与 PNG 匹配
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.ccr';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// 序列 PNG 帧 304 转 raw
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'I:/Delta Force custom animation/animation/ccreptile/ccreptitle_00304.png', '-f', 'rawvideo', '-pix_fmt', 'rgba', `${TMP}/seq304.raw`]);
const seq304 = fs.readFileSync(`${TMP}/seq304.raw`);

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  const seq304B64 = seq304.toString('base64');
  const report = await page.evaluate(async (seqB64) => {
    // 在页面内解码序列帧 304 的 RGBA
    const bin = atob(seqB64);
    const seqData = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) seqData[i] = bin.charCodeAt(i);

    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const anim = window.__anim;
    const renderer = anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');

    // 找序列层元素
    let seqEl = null;
    const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
    walk(renderer.elements);

    // 逐帧切换验证:渲染 0/1/2 帧,记录 img.src 变化
    const srcs = [];
    for (const f of [0, 1, 2, 304]) {
      renderer.renderFrame(f, true);
      srcs.push({ f, src: seqEl.img ? seqEl.img.src : 'none' });
    }
    const uniqueSrcs = new Set(srcs.map((s) => s.src)).size;

    // 渲染帧 304,提取序列内容区域像素
    renderer.renderFrame(304, true);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    // 序列 PNG 不透明像素坐标与页面帧对比(区域内逐像素匹配)
    let seqPx = 0, matched = 0, covered = 0;
    for (let y = 0; y < 1080; y++) {
      for (let x = 0; x < 1920; x++) {
        const i = (y * 1920 + x) * 4;
        if (seqData[i + 3] > 8) {
          seqPx++;
          const pr = d[i], pg = d[i + 1], pb = d[i + 2], pa = d[i + 3];
          if (pa > 8) {
            const diff = Math.abs(pr - seqData[i]) + Math.abs(pg - seqData[i + 1]) + Math.abs(pb - seqData[i + 2]);
            if (diff < 120) matched++;
          } else covered++;
        }
      }
    }
    return { uniqueSrcs, srcs, seqPx, matched, covered, matchRate: seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0 };
  }, seq304B64);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
