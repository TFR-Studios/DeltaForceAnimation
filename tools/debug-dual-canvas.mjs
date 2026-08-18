// 决定性调试:导出过程中,同时采样 lottie canvas 和 outCanvas 的序列区域
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

  let captured = null;
  for (let k = 0; k < 180 && !captured; k++) {
    await new Promise((r) => setTimeout(r, 500));
    captured = await page.evaluate(() => {
      // lottie canvas(离屏容器内)
      const divs = Array.from(document.querySelectorAll('div'));
      const expDiv = divs.find((d) => d.style && d.style.cssText && d.style.cssText.includes('-10000px'));
      if (!expDiv) return null;
      const lottieCanvas = expDiv.querySelector('canvas');
      if (!lottieCanvas) return null;
      // outCanvas(容器外的 canvas,尺寸相同)
      const allCanvas = Array.from(document.querySelectorAll('canvas'));
      const outCanvas = allCanvas.find((c) => c !== lottieCanvas && c.width === 1920 && c.height === 1080);
      const sample = (c) => {
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(260, 410, 40, 40);
        const d = img.data;
        let light = 0, dark = 0;
        const samples = [];
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) light++;
          else if (d[i] + d[i + 1] + d[i + 2] < 90) dark++;
          if (samples.length < 2 && d[i + 3] > 8) samples.push(`(${d[i]},${d[i + 1]},${d[i + 2]},a${d[i + 3]})`);
        }
        return { light, dark, samples, w: c.width };
      };
      return { lottie: sample(lottieCanvas), out: outCanvas ? sample(outCanvas) : null, status: document.getElementById('statusbar').textContent };
    });
  }
  console.log(JSON.stringify(captured, null, 2));
  const st = await page.evaluate(() => document.getElementById('statusbar').textContent);
  console.log('结束状态:', st);
} finally {
  await browser.close();
}
