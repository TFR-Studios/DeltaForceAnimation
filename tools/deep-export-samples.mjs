// 导出实例深度采样:序列区域实际像素 + 元素状态
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

  let report = null;
  for (let k = 0; k < 600 && !report; k++) {
    await new Promise((r) => setTimeout(r, 200));
    report = await page.evaluate(() => {
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
      const d = img.data;
      // 序列区域像素样本
      const samples = [];
      let nonTransparent = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) {
          nonTransparent++;
          if (samples.length < 6) samples.push(`rgba(${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]})`);
        }
      }
      // 元素状态
      let seqEl = null;
      const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
      walk(exp.renderer.elements);
      const status = document.getElementById('statusbar').textContent;
      return {
        frame: Math.round(frame),
        nonTransparentInRegion: nonTransparent,
        samples,
        status,
        elState: seqEl ? {
          useExport: seqEl.__seqUseExport === true,
          imgIsSeqExport: seqEl.img === (window.__seqExportProbe || null) || (seqEl.img && seqEl.img.src && seqEl.img.src.length > 0),
          imgSrcLen: seqEl.img ? seqEl.img.src.length : 0,
          imgSrcHead: seqEl.img ? seqEl.img.src.slice(0, 24) : 'none',
          hidden: seqEl.hidden,
        } : 'no-seq-el',
      };
    });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
