// 调试:序列层元素状态、patch 是否生效、手动触发绘制
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

    let seqEl = null;
    const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
    walk(renderer.elements);

    if (!seqEl) return { error: '序列层元素未构建' };
    const rIC = seqEl.renderInnerContent;
    const info = {
      nm: seqEl.data.nm,
      hidden: seqEl.hidden,
      isInRange: seqEl.isInRange,
      hd: seqEl.data.hd,
      td: seqEl.data.td,
      isTransparent: seqEl.isTransparent,
      renderInnerContentSource: typeof rIC === 'function' ? rIC.toString().slice(0, 150) : 'none',
      imgSrcHead: seqEl.img ? seqEl.img.src.slice(0, 30) : 'none',
      assetDataId: seqEl.assetData ? seqEl.assetData.id : 'none',
    };
    // 手动渲染第 1 帧并检查
    renderer.renderFrame(1, true);
    info.afterRender1 = {
      frameNum: seqEl.globalData ? seqEl.globalData.frameNum : 'no-globalData',
      imgSrcHead: seqEl.img ? seqEl.img.src.slice(0, 30) : 'none',
      hidden: seqEl.hidden,
    };
    // 直接手动调用 renderInnerContent
    if (typeof rIC === 'function') {
      try { rIC.call(seqEl); } catch (e) { info.manualCallError = String(e); }
      info.afterManual = { imgSrcHead: seqEl.img ? seqEl.img.src.slice(0, 30) : 'none' };
    }
    // 检查我们 patch 的标记
    info.__seqElPatched = seqEl.__seqElPatched;
    info.__lottieFallbackPatched = seqEl.__lottieFallbackPatched;
    return info;
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
