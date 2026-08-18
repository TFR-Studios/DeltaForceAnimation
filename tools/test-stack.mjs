// 捕获完整堆栈,精确定位 null.length 出处
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'canvas');
await sleep(2000);

const result = await page.evaluate(async () => {
  const a = window.__anim;
  const r = a.renderer;
  const stacks = [];
  for (const e of r.elements) {
    if (!e || !(e.data && e.data.ty === 5)) continue;
    const orig = e.renderFrame;
    e.renderFrame = function () {
      try { return orig.apply(this, arguments); } catch (err) {
        stacks.push(err.stack.split('\n').slice(0, 6).join(' | '));
        throw err;
      }
    };
  }
  await new Promise((res) => setTimeout(res, 1200));
  return stacks.slice(0, 3);
});
console.log(JSON.stringify(result, null, 2));
await browser.close();

