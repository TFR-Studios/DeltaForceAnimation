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
  hexInputs: document.querySelectorAll('.hex-input').length,
  textColor: document.querySelectorAll('.t-color').length,
  shapeFill: document.querySelectorAll('.s-fill').length,
  shapeStroke: document.querySelectorAll('.s-stroke').length,
}));
console.log('控件数量:', JSON.stringify(counts));

// 读取 ind48 文字颜色(撤离成功)
const readTextFc = () => page.evaluate(() => {
  const e = window.__anim.renderer.elements.find(el => el && el.data && el.data.ind === 48);
  const td = e.data.t.d.k;
  const s = Array.isArray(td) ? td[0].s : td.s;
  return s.fc.map(v => Math.round(v * 255));
});
console.log('撤离成功 初始填充色:', JSON.stringify(await readTextFc()));

// 在 HEX 输入框里直接输入 #ff0000
await page.evaluate(() => {
  const colorInput = document.querySelector('.t-color[data-ind="48"]');
  const hexInput = colorInput.nextElementSibling;
  hexInput.value = '#ff0000';
  hexInput.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
console.log('输入 HEX #ff0000 后:', JSON.stringify(await readTextFc()));

// 再输入不带#的 00ff00
await page.evaluate(() => {
  const colorInput = document.querySelector('.t-color[data-ind="48"]');
  const hexInput = colorInput.nextElementSibling;
  hexInput.value = '00ff00';
  hexInput.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
console.log('输入 00ff00 后:', JSON.stringify(await readTextFc()));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
