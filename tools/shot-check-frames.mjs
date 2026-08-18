// 抽帧验证:复用页面已加载的动画实例(与导出相同的渲染管线),
// 渲染第 0 / 304 / 608 帧并输出缩略图,检查画面内容是否正确。
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
  const shots = await page.evaluate(async () => {
    // 切换为 Canvas 渲染器(与导出一致),等待重载完成
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') {
      sel.value = 'canvas';
      sel.dispatchEvent(new Event('change'));
    }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        const c = document.querySelector('#previewInner canvas');
        if (c && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 20000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const anim = window.__anim;
    const renderer = anim.renderer;
    const canvas = document.querySelector('#previewInner canvas') || renderer.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('找不到渲染画布');
    const out = [];
    for (const f of [0, 304, 608]) {
      renderer.renderFrame(f, true);
      const small = document.createElement('canvas');
      small.width = 480;
      small.height = 270;
      const ctx = small.getContext('2d');
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, 480, 270);
      ctx.drawImage(canvas, 0, 0, 480, 270);
      out.push({ frame: f, w: canvas.width, h: canvas.height, dataUrl: small.toDataURL('image/png') });
    }
    return out;
  });
  for (const s of shots) {
    const b64 = s.dataUrl.split(',')[1];
    const file = 'I:/Delta Force custom animation/tools/frame-' + s.frame + '.png';
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('frame', s.frame, 'canvas', s.w + 'x' + s.h, '->', file);
  }
} finally {
  await browser.close();
}
