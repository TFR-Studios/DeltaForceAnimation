// 严格验证:捕获真实导出实例,连续帧序列区域严格匹配(检测残影/叠加)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.strict';
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
    f.value = 'mp4'; // 用 mp4 快速导出,验证渲染帧内容(与透明AVI同渲染管线)
    f.dispatchEvent(new Event('change'));
    document.getElementById('btnExport').click();
  });

  let captured = [];
  for (let k = 0; k < 600 && captured.length < 5; k++) {
    await new Promise((r) => setTimeout(r, 200));
    const s = await page.evaluate(() => {
      const exp = window.__exportAnim;
      if (!exp) return null;
      const frame = exp.renderer ? exp.renderer.renderedFrame : -1;
      if (typeof frame !== 'number' || frame < 290 || frame > 340) return null;
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
    });
    if (!s) continue;
    captured.push(s);
  }
  console.log('采样帧:', captured.map((c) => c.frame).join(', '));

  // 严格对比:每个采样帧的序列区域 vs 对应 ccreptitle 帧(premultiplied 期望,阈值 20)
  for (const s of captured) {
    const n = String(s.frame).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-vf', 'crop=90:100:220:375', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    const buf = Buffer.from(s.b64, 'base64');
    let seqPx = 0, matched10 = 0, matched20 = 0, matched40 = 0;
    for (let i = 0; i < seq.length; i += 4) {
      if (seq[i + 3] > 8) {
        seqPx++;
        const a = seq[i + 3];
        const er = Math.round((seq[i] * a) / 255), eg = Math.round((seq[i + 1] * a) / 255), eb = Math.round((seq[i + 2] * a) / 255);
        const diff = Math.abs(buf[i] - er) + Math.abs(buf[i + 1] - eg) + Math.abs(buf[i + 2] - eb);
        if (diff < 10) matched10++;
        if (diff < 20) matched20++;
        if (diff < 40) matched40++;
      }
    }
    console.log(`导出实例帧 ${s.frame}: 严格匹配<10: ${((matched10 / seqPx) * 100).toFixed(1)}% | <20: ${((matched20 / seqPx) * 100).toFixed(1)}% | <40: ${((matched40 / seqPx) * 100).toFixed(1)}%`);
  }
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('状态:', st);
} finally {
  await browser.close();
}
