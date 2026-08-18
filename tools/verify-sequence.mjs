// 验证 ccreptile 序列:渲染器元素驱动、帧内容变化、与 PNG 序列内容匹配。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('已载入'),
    { timeout: 60000 }
  );
  console.log('页面已载入');

  const report = await page.evaluate(async () => {
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

    // 1) 序列层元素状态
    const seqEls = [];
    const walk = (els) => {
      for (const el of els || []) {
        if (el && el.data) {
          if (el.data.ty === 2 && el.data.ind === 56) seqEls.push(el);
          if (el.data.ty === 0 && el.elements) walk(el.elements);
        }
      }
    };
    walk(renderer.elements);
    const seqInfo = seqEls.map((el) => ({
      nm: el.data.nm,
      patched: typeof el.renderInnerContent === 'function' && el.__lottieFallbackPatched === true,
      imgSrcPrefix: el.img && el.img.src ? el.img.src.slice(0, 40) : 'none',
    }));

    // 2) 渲染帧 0/304/608,取内容统计
    const frames = [];
    for (const f of [0, 304, 608]) {
      renderer.renderFrame(f, true);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      let nonZero = 0, r = 0, g = 0, b = 0;
      let minX = 1920, minY = 1080, maxX = -1, maxY = -1;
      for (let y = 0; y < 1080; y++) {
        for (let x = 0; x < 1920; x++) {
          const i = (y * 1920 + x) * 4;
          if (d[i + 3] > 8) {
            nonZero++;
            r += d[i]; g += d[i + 1]; b += d[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      frames.push({
        f,
        contentPx: nonZero,
        pct: ((nonZero / (1920 * 1080)) * 100).toFixed(2),
        bbox: `x[${minX}..${maxX}] y[${minY}..${maxY}]`,
        avg: `${(r / nonZero).toFixed(0)},${(g / nonZero).toFixed(0)},${(b / nonZero).toFixed(0)}`,
      });
    }
    // 3) 帧 304 的 img src 是否切到 image_ccr_00304
    renderer.renderFrame(304, true);
    const srcNow = seqEls[0] && seqEls[0].img ? seqEls[0].img.src.slice(0, 60) : 'none';
    return { seqInfo, frames, srcAt304: srcNow };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
