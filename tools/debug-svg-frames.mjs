// 诊断 SVG 渲染器:帧号、href 切换、图片加载状态
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
    // 确保 SVG 渲染器
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'svg') { sel.value = 'svg'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner svg') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const anim = window.__anim;
    const renderer = anim.renderer;

    // 手动渲染几帧,检查 href 与帧号
    const out = [];
    for (const f of [0, 304, 305, 600]) {
      renderer.renderFrame(f, true);
      let seqEl = null;
      const walk = (els) => { for (const el of els || []) { if (el && el.data) { if (el.data.ty === 2 && el.data.ind === 56) seqEl = el; if (el.data.ty === 0 && el.elements) walk(el.elements); } } };
      walk(renderer.elements);
      const imgEl = seqEl ? seqEl.innerElem || seqEl.imageElem : null;
      const NS = 'http://www.w3.org/1999/xlink';
      const href = imgEl ? imgEl.getAttributeNS(NS, 'href') : 'NO-IMG';
      out.push({
        f,
        svgGlobalFrameNum: renderer.globalData ? renderer.globalData.frameNum : 'no-globalData',
        hrefLen: href.length,
        hrefTail: href.slice(-30),
        imgLoaded: imgEl ? imgEl.getBBox ? 'svg-el' : '?' : 'none',
        hrefIsSeq0: href.includes('iVBORw0KGgoAAAANSUhEUgAAB4AAAAQ4CAYAAA'), // 序列帧0的 base64 特征?不可靠,改用长度区分
      });
    }
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
