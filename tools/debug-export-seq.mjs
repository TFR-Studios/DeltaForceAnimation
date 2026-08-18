// 调试:MP4 导出过程中,检查离屏导出画布的序列内容
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
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'mp4';
    f.dispatchEvent(new Event('change'));
  });

  await page.evaluate(() => document.getElementById('btnExport').click());
  console.log('导出已启动,开始轮询离屏画布…');

  const results = [];
  for (let k = 0; k < 60; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    const snap = await page.evaluate(() => {
      // 找离屏导出容器
      const divs = Array.from(document.querySelectorAll('div'));
      const exp = divs.find((d) => d.style && d.style.cssText && d.style.cssText.includes('-10000px'));
      if (!exp) return { state: 'no-container' };
      const canvas = exp.querySelector('canvas');
      if (!canvas) return { state: 'no-canvas' };
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(220, 375, 80, 90);
      const d = img.data;
      let light = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) light++;
      }
      return { state: 'ok', lightPx: light, canvasW: canvas.width };
    });
    results.push(snap);
    if (snap.lightPx > 20) { console.log('✓ 导出画布出现序列内容(浅色像素):', JSON.stringify(snap), '@', k, 's'); break; }
    if (snap.state === 'no-container') { console.log('导出容器未找到'); break; }
  }
  const status = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('最终状态栏:', status);
  console.log('采样:', JSON.stringify(results.filter((r) => r.state === 'ok').slice(0, 5)));
} finally {
  await browser.close();
}
