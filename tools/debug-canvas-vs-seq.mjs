// 关键验证:导出过程中,lottie canvas 的序列区域像素 vs 对应 ccreptitle 帧
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.dual';
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
  for (let k = 0; k < 240; k++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const expDiv = divs.find((d) => d.style && d.style.cssText && d.style.cssText.includes('-10000px'));
      if (!expDiv) return null;
      const canvas = expDiv.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(220, 375, 90, 100); // 序列内容区域
      let bin = '';
      const arr = new Uint8ClampedArray(img.data.buffer);
      const STEP = 0x8000;
      for (let i = 0; i < arr.length; i += STEP) bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
      return { b64: btoa(bin), frame: window.__anim ? window.__anim.currentFrame : -1, status: document.getElementById('statusbar').textContent };
    });
    if (!s) continue;
    const f = Math.round(s.frame);
    if (f < 250 || f > 360) { if (s.status.includes('导出完成') || s.status.includes('失败')) break; continue; } // 只采样序列内容出现的帧段
    samples.push(s);
    if (samples.length >= 3) break;
  }
  console.log('采样数:', samples.length);
  for (const s of samples) {
    const f = Math.round(s.frame);
    const n = String(f).padStart(5, '0');
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
    console.log(`导出画布帧 ${f}: 序列像素 ${seqPx}, 匹配 ${matched} (${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}%) ${seqPx && matched / seqPx > 0.8 ? '✓ 画布有序列' : '✗ 画布无序列'}`);
  }
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('最终状态:', st);
} finally {
  await browser.close();
}
