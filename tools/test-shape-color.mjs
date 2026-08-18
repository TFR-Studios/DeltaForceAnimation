import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);

const counts = await page.evaluate(() => ({
  fill: document.querySelectorAll('.s-fill').length,
  stroke: document.querySelectorAll('.s-stroke').length,
  reset: document.querySelectorAll('.s-reset').length,
}));
console.log('控件数量:', JSON.stringify(counts));

// 读取 ind7 的填充色(从动画元素数据)
const readFill = () => page.evaluate(() => {
  const anim = window.__anim;
  const e = anim.renderer.elements.find(el => el && el.data && el.data.ind === 7);
  let fill = null;
  const walk = (items) => { for (const it of items || []) { if (it.ty === 'fl' && it.c && it.c.a === 0) { fill = it.c.k.map(v => Math.round(v * 255)); } if (it.it) walk(it.it); } };
  walk(e.data.shapes);
  return fill;
});
console.log('绿色2 初始填充色:', JSON.stringify(await readFill()));

// 改填充为红色
await page.evaluate(() => {
  const ci = document.querySelector('.s-fill[data-ind="7"]');
  ci.value = '#ff0000';
  ci.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
console.log('改红后:', JSON.stringify(await readFill()));

// 重置
await page.evaluate(() => {
  document.querySelector('.s-reset[data-ind="7"]').click();
});
await sleep(800);
console.log('重置后:', JSON.stringify(await readFill()));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
