// 多帧段严格验证:导出实例序列区域 vs 素材(straight 对比),检测任何帧段的残影
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.strict2';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
// 目标帧段:动画各阶段
const TARGETS = [5, 60, 120, 200, 300, 324, 420, 500, 580, 605];

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
    document.getElementById('btnExport').click();
  });

  // 采集所有目标帧
  const captured = [];
  for (let k = 0; k < 900 && captured.length < TARGETS.length; k++) {
    await new Promise((r) => setTimeout(r, 150));
    const s = await page.evaluate((targets) => {
      const exp = window.__exportAnim;
      if (!exp) return null;
      const frame = exp.renderer ? exp.renderer.renderedFrame : -1;
      if (typeof frame !== 'number' || !targets.includes(Math.round(frame))) return null;
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
      return { frame: Math.round(frame), b64: btoa(bin) };
    }, TARGETS);
    if (!s) continue;
    captured.push(s);
  }
  console.log('采集帧:', captured.map((c) => c.frame).join(', '));

  // straight 严格对比(素材直通值 vs lottie canvas 反预乘值,阈值 25)
  for (const s of captured) {
    const n = String(s.frame).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-vf', 'crop=90:100:220:375', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    const buf = Buffer.from(s.b64, 'base64');
    let seqPx = 0, matched = 0;
    let sumDiff = 0;
    for (let i = 0; i < seq.length; i += 4) {
      if (seq[i + 3] > 8) {
        seqPx++;
        const diff = Math.abs(buf[i] - seq[i]) + Math.abs(buf[i + 1] - seq[i + 1]) + Math.abs(buf[i + 2] - seq[i + 2]);
        sumDiff += diff;
        if (diff < 25) matched++;
      }
    }
    console.log(`导出实例帧 ${s.frame}: 序列像素 ${seqPx}, 匹配 ${matched} (${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}%) ${seqPx && matched / seqPx > 0.95 ? '✓ 无残影' : '✗ 疑似残影!'}`);
  }
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('状态:', st);
} finally {
  await browser.close();
}
