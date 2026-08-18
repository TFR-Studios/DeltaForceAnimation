// 最终验证:①SVG innerElem 切换 ②MP4 帧序列以合成色存在
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.final';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ② MP4 帧 304(已有文件):序列区域合成色匹配(直通色×alpha + 背景×(1-alpha))
const MP4 = 'I:/Delta Force custom animation/tools/.mp4test/animation.mp4';
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MP4, '-vf', "select='eq(n\\,304)'", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/mp4.raw']);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'I:/Delta Force custom animation/animation/ccreptile/ccreptitle_00304.png', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
const mp4 = fs.readFileSync(TMP + '/mp4.raw');
const seq = fs.readFileSync(TMP + '/seq.raw');
const bg = [0x16, 0x18, 0x1d];
let seqPx = 0, matched = 0;
for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
  const i = (y * 1920 + x) * 4;
  if (seq[i + 3] > 8) {
    seqPx++;
    const a = seq[i + 3] / 255;
    const er = Math.round(seq[i] * a + bg[0] * (1 - a));
    const eg = Math.round(seq[i + 1] * a + bg[1] * (1 - a));
    const eb = Math.round(seq[i + 2] * a + bg[2] * (1 - a));
    const diff = Math.abs(mp4[i] - er) + Math.abs(mp4[i + 1] - eg) + Math.abs(mp4[i + 2] - eb);
    if (diff < 60) matched++;
  }
}
console.log(`MP4 帧304 序列(合成色)匹配: ${matched}/${seqPx} (${((matched / seqPx) * 100).toFixed(1)}%) ${matched / seqPx > 0.8 ? '✓ MP4 序列正常' : '✗'}`);

// ① SVG 检查
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  const svg = await page.evaluate(async () => {
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
    const imgEl = seqEl ? seqEl.innerElem || seqEl.imageElem : null;
    const NS = 'http://www.w3.org/1999/xlink';
    const href = imgEl ? imgEl.getAttributeNS(NS, 'href') : 'no-img-el';
    return { found: !!seqEl, patched: seqEl ? !!seqEl.__seqElPatched : false, hrefHead: String(href).slice(0, 40), isSeq304: String(href).length > 40 };
  });
  console.log('SVG:', JSON.stringify(svg));
} finally {
  await browser.close();
}
