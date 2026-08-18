// 终极定位:导出过程中,同步采样 lottie canvas + outCanvas 序列区域,
// 读取导出实例 renderedFrame,与序列帧精确对比
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.dual3';
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

  const captured = await page.evaluate(() => {
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
    document.getElementById('btnExport').click();
    return true;
  });
  console.log('导出启动:', captured);

  let samples = [];
  for (let k = 0; k < 300 && samples.length < 3; k++) {
    await new Promise((r) => setTimeout(r, 400));
    const s = await page.evaluate(() => {
      const exp = window.__exportAnim;
      const status = document.getElementById('statusbar').textContent;
      if (!exp) return { state: 'no-exp', status };
      const frame = exp.renderer ? exp.renderer.renderedFrame : -1;
      if (typeof frame !== 'number' || frame < 250 || frame > 360) return { state: 'skip', frame, status };
      const divs = Array.from(document.querySelectorAll('div'));
      const expDiv = divs.find((d) => d.style && d.style.cssText && d.style.cssText.includes('-10000px'));
      if (!expDiv) return { state: 'no-div', frame, status };
      const lottieCanvas = expDiv.querySelector('canvas');
      const allCanvas = Array.from(document.querySelectorAll('canvas'));
      const outCanvas = allCanvas.find((c) => c !== lottieCanvas && c.width === 1920 && c.height === 1080);
      const grab = (c) => {
        if (!c) return null;
        const img = c.getContext('2d').getImageData(220, 375, 90, 100);
        let bin = '';
        const arr = new Uint8ClampedArray(img.data.buffer);
        const STEP = 0x8000;
        for (let i = 0; i < arr.length; i += STEP) bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
        return btoa(bin);
      };
      return { state: 'ok', frame: Math.round(frame), lottie: grab(lottieCanvas), out: grab(outCanvas), status };
    });
    if (!s || s.state !== 'ok') continue;
    samples.push(s);
  }
  console.log('采样数:', samples.length);
  for (const s of samples) {
    const n = String(s.frame).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-vf', 'crop=90:100:220:375', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    for (const [which, b64] of [['lottie', s.lottie], ['out', s.out]]) {
      if (!b64) { console.log(`帧 ${s.frame} ${which}: 无 canvas`); continue; }
      const buf = Buffer.from(b64, 'base64');
      let seqPx = 0, matched = 0;
      for (let i = 0; i < seq.length; i += 4) {
        if (seq[i + 3] > 8) {
          seqPx++;
          const diff = Math.abs(buf[i] - seq[i]) + Math.abs(buf[i + 1] - seq[i + 1]) + Math.abs(buf[i + 2] - seq[i + 2]);
          if (diff < 120) matched++;
        }
      }
      console.log(`帧 ${s.frame} ${which}: ${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}% 匹配 (${matched}/${seqPx}) ${seqPx && matched / seqPx > 0.8 ? '✓' : '✗'}`);
    }
  }
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('最终状态:', st);
} finally {
  await browser.close();
}
