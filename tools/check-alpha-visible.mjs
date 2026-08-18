// 检查页面 canvas 渲染帧 304 序列区域的 alpha(应为 255,提升后)
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  const rep = await page.evaluate(async () => {
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
    const img = ctx.getImageData(227, 382, 66, 76);
    const d = img.data;
    let a255 = 0, aMid = 0, a0 = 0;
    const samples = [];
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 255) a255++;
      else if (a === 0) a0++;
      else { aMid++; if (samples.length < 3) samples.push(`a${a}`); }
    }
    const n = d.length / 4;
    return {
      seqRegion: `${66}x${76}`,
      alpha255: ((a255 / n) * 100).toFixed(1) + '%',
      alphaMid: ((aMid / n) * 100).toFixed(1) + '%',
      alpha0: ((a0 / n) * 100).toFixed(1) + '%',
      midSamples: samples,
    };
  });
  console.log(JSON.stringify(rep, null, 2));
} finally {
  await browser.close();
}
