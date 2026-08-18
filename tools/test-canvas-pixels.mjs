// 无头分析:Canvas 渲染器的实际绘制状态
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const logs = [];
page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) logs.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'canvas');
await new Promise((r) => setTimeout(r, 5000));

async function pixelStats(label) {
  return await page.evaluate((lab) => {
    const c = document.querySelector('#previewInner canvas');
    if (!c) return { label: lab, error: 'no canvas' };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, nonBlack = 0, sumR = 0, sumG = 0, sumB = 0;
    const n = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) {
        opaque++;
        sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2];
        if (d[i] + d[i + 1] + d[i + 2] > 30) nonBlack++;
      }
    }
    return {
      label: lab,
      total: n,
      opaque,
      nonBlack,
      avgColor: opaque ? [Math.round(sumR / opaque), Math.round(sumG / opaque), Math.round(sumB / opaque)] : null,
    };
  }, label);
}

console.log('after 5s:', JSON.stringify(await pixelStats('t=5s')));
await page.click('#btnPlay');
await new Promise((r) => setTimeout(r, 3000));
console.log('after play 3s:', JSON.stringify(await pixelStats('t=8s playing')));
await page.click('#btnRestart');
await new Promise((r) => setTimeout(r, 3000));
console.log('after restart 3s:', JSON.stringify(await pixelStats('t=11s restart')));

const frames = await page.evaluate(() => {
  const f = document.getElementById('frameInfo').textContent;
  const st = document.getElementById('statusbar').textContent;
  return { frameInfo: f, status: st };
});
console.log('frame/status:', JSON.stringify(frames));
console.log('logs:', JSON.stringify(logs.slice(0, 30)));
await browser.close();

