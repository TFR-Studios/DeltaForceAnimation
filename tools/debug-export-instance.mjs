// 深度调试:捕获导出实例,检查序列层元素 patch 状态与 img
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
    // 捕获导出实例
    const lottie = window.__lottie;
    const orig = lottie.loadAnimation.bind(lottie);
    lottie.loadAnimation = function (params) {
      const anim = orig(params);
      const c = params.container;
      if (c && c.style && c.style.cssText && c.style.cssText.includes('-10000px')) {
        window.__exportAnim = anim;
      }
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

  let done = false;
  for (let k = 0; k < 120 && !done; k++) {
    await new Promise((r) => setTimeout(r, 500));
    const snap = await page.evaluate(() => {
      const exp = window.__exportAnim;
      const status = document.getElementById('statusbar').textContent;
      if (!exp) return { status, state: 'no-export-anim' };
      const renderer = exp.renderer;
      let seqEl = null;
      const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
      walk(renderer.elements);
      if (!seqEl) return { status, state: 'no-seq-el', elems: (renderer.elements || []).length };
      return {
        status,
        state: 'ok',
        patched: seqEl.__lottieFallbackPatched === true,
        useExport: seqEl.__seqUseExport === true,
        hidden: seqEl.hidden,
        imgIsExport: seqEl.img === window.__seqExportProbe || (seqEl.img && seqEl.img.src && seqEl.img.src.length > 0),
        imgSrcHead: seqEl.img ? seqEl.img.src.slice(0, 25) : 'none',
        renderedFrame: renderer.renderedFrame,
      };
    });
    if (snap.state === 'ok' && snap.patched) { console.log('导出实例序列层:', JSON.stringify(snap)); done = true; }
    if (statusContains(snap.status, '完成') || statusContains(snap.status, '失败')) {
      console.log('导出结束:', JSON.stringify(snap));
      done = true;
    }
  }
  function statusContains(s, k) { return typeof s === 'string' && s.includes(k); }
} finally {
  await browser.close();
}
