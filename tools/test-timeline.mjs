// 时间线实验:定位 Canvas 渲染器不绘制的原因
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const events = [];
page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) events.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', (e) => events.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => events.push('[reqfail] ' + r.url()));

const snapshot = () => page.evaluate(() => {
  const a = window.__anim;
  const c = document.querySelector('#previewInner canvas');
  let px = null;
  if (c) {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    px = opaque;
  }
  return {
    frameInfo: document.getElementById('frameInfo').textContent,
    status: document.getElementById('statusbar').textContent,
    curFrame: a ? a.currentFrame : null,
    isPaused: a ? a.isPaused : null,
    renderedFrame: a && a.renderer ? a.renderer.renderedFrame : null,
    opaquePixels: px,
  };
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);
console.log('SVG t=1.5s:', JSON.stringify(await snapshot()));
await sleep(1500);
console.log('SVG t=3.0s:', JSON.stringify(await snapshot()));

await page.select('#selRenderer', 'canvas');
await sleep(1200);
console.log('CANVAS t=1.2s:', JSON.stringify(await snapshot()));
await sleep(1800);
console.log('CANVAS t=3.0s:', JSON.stringify(await snapshot()));

// 若卡住,强制跳帧并检查能否静态绘制
const forced = await page.evaluate(async () => {
  const a = window.__anim;
  if (!a) return 'no anim';
  a.goToAndStop(150, true);
  await new Promise((r) => setTimeout(r, 800));
  const c = document.querySelector('#previewInner canvas');
  if (!c) return 'no canvas';
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
  return { curFrame: a.currentFrame, opaque };
});
console.log('CANVAS forced frame 150:', JSON.stringify(forced));

await page.click('#btnPlay');
await sleep(800);
console.log('CANVAS after pause click:', JSON.stringify(await snapshot()));
console.log('events:');
for (const e of events) console.log('  ' + e);
await browser.close();

