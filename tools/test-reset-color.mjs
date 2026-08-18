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
  reset: document.querySelectorAll('.t-reset').length,
  color: document.querySelectorAll('.t-color').length,
  input: document.querySelectorAll('.t-input').length,
}));
console.log('控件数量:', JSON.stringify(counts));

// 读 fc 数据
const readFc = () => page.evaluate(() => {
  const anim = window.__anim;
  const e = anim.renderer.elements.find(el => el && el.data && el.data.ind === 48);
  const td = e.data.t.d.k;
  const s = Array.isArray(td) ? td[0].s : td.s;
  return { text: s.t, fc: s.fc.map(v => Math.round(v * 255)) };
});

console.log('初始:', JSON.stringify(await readFc()));

// 改颜色为红色
await page.evaluate(() => {
  const ci = document.querySelector('.t-color[data-ind="48"]');
  ci.value = '#ff0000';
  ci.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
console.log('改红色后:', JSON.stringify(await readFc()));

// 改文字
await page.evaluate(() => {
  const ta = document.querySelector('.t-input[data-ind="48"]');
  ta.value = '测试文字';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
console.log('改文字后:', JSON.stringify(await readFc()));

// 点重置
await page.evaluate(() => {
  document.querySelector('.t-reset[data-ind="48"]').click();
});
await sleep(800);
console.log('重置后:', JSON.stringify(await readFc()));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
