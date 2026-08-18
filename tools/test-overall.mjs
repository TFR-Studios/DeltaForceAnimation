// 整体确认:镜像后动画正常播放、帧数推进、无页面错误
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);
const f1 = await page.evaluate(() => document.getElementById('frameInfo').textContent);
await sleep(2000);
const f2 = await page.evaluate(() => document.getElementById('frameInfo').textContent);
const status = await page.evaluate(() => document.getElementById('statusbar').textContent);
console.log('帧 @1.5s:', f1, '| @3.5s:', f2, '| status:', status);
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

