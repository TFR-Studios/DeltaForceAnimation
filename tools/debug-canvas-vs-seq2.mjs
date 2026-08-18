// 用导出实例 renderedFrame 精确采样:导出画布序列区域 vs 对应序列帧
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.dual2';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  await page.evaluate(() => {
    const lottie = window.__lottie;
    const orig = lottie.loadAnimation.bind(lottie);
    lottie.loadAnimation = function (params) {
      const anim = orig(params);
      const c = params.container;
      if (c && c.style && c.style.cssText && c.style.cssText.includes('-10000px')) window.__exportAnim = anim;
      return anim;
    };
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'mp4';
    f.dispatchEvent(new Event('change'));
  });
  await page.evaluate(() => document.getElementById('btnExport').click());

  let samples = [];
  for (let k = 0; k < 300 && samples.length < 4; k++) {
    await new Promise((r) => setTimeout(r, 400));
    const s = await page.evaluate(() => {
      const exp = window.__exportAnim;
      const status = document.getElementById('statusbar').textContent;
      if (!exp) return null;
      const frame = exp.renderer.renderedFrame;
      if (typeof frame !== 'number' || frame < 250 || frame > 360) {
        return { skip: true, status };
      }
      const divs = Array.from(document.querySelectorAll('div'));
      const expDiv = divs.find((d) => d.style && d.style.cssText && d.style.cssText.includes('-10000px'));
      if (!expDiv) return null;
      const canvas = expDiv.querySelector('canvas');
      if (!canvas) return null;
      const img = canvas.getContext('2d').getImageData(220, 375, 90, 100);
      let bin = '';
      const arr = new Uint8ClampedArray(img.data.buffer);
      const STEP = 0x8000;
      for (let i = 0; i < arr.length; i += STEP) bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
      return { frame: Math.round(frame), b64: btoa(bin), status };
    });
    if (!s) continue;
    if (s.skip) { if (s.status && (s.status.includes('导出完成') || s.status.includes('失败'))) break; continue; }
    samples.push(s);
  }
  console.log('采样数:', samples.length);
  for (const s of samples) {
    const n = String(s.frame).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-vf', 'crop=90:100:220:375', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    const buf = Buffer.from(s.b64, 'base64');
    let seqPx = 0, matched = 0;
    for (let i = 0; i < seq.length; i += 4) {
      if (seq[i + 3] > 8) {
        seqPx++;
        const diff = Math.abs(buf[i] - seq[i]) + Math.abs(buf[i + 1] - seq[i + 1]) + Math.abs(buf[i + 2] - seq[i + 2]);
        if (diff < 120) matched++;
      }
    }
    console.log(`导出画布帧 ${s.frame}: 序列像素 ${seqPx}, 匹配 ${matched} (${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}%) ${seqPx && matched / seqPx > 0.8 ? '✓' : '✗'}`);
  }
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('最终状态:', st);
} finally {
  await browser.close();
}
