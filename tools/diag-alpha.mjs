// 诊断:页面 canvas 渲染结果中 alpha 分布(半透明是否真实存在)
// 以及 DIB 导出转换后 alpha 是否保持。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('已载入'),
    { timeout: 30000 }
  );
  const report = await page.evaluate(async () => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') {
      sel.value = 'canvas';
      sel.dispatchEvent(new Event('change'));
    }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) {
          clearInterval(timer); resolve();
        } else if (Date.now() - t0 > 20000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const anim = window.__anim;
    const renderer = anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');
    const out = {};
    for (const f of [0, 304, 608]) {
      renderer.renderFrame(f, true);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      let a0 = 0, amid = 0, a255 = 0;
      const samples = [];
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) a0++;
        else if (a === 255) a255++;
        else {
          amid++;
          if (samples.length < 8) samples.push(`rgba(${d[i]},${d[i + 1]},${d[i + 2]},${a})`);
        }
      }
      const n = d.length / 4;
      out[f] = {
        alpha0: ((a0 / n) * 100).toFixed(2) + '%',
        alphaMid: ((amid / n) * 100).toFixed(4) + '% (' + amid + ' px)',
        alpha255: ((a255 / n) * 100).toFixed(2) + '%',
        samples,
      };
    }
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
