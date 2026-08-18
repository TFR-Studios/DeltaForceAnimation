// 简单验证:加载页面,切 SVG/Canvas,确认无报错、帧数推进
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
const svgFrame1 = await page.evaluate(() => document.getElementById('frameInfo').textContent);
await sleep(1500);
const svgFrame2 = await page.evaluate(() => document.getElementById('frameInfo').textContent);
// 切 canvas
await page.select('#selRenderer', 'canvas');
await sleep(2500);
const canvasFrame = await page.evaluate(() => document.getElementById('frameInfo').textContent);
const status = await page.evaluate(() => document.getElementById('statusbar').textContent);
console.log('SVG 帧:', svgFrame1, '->', svgFrame2, '(应递增)');
console.log('Canvas 帧:', canvasFrame, '(应递增)');
console.log('状态:', status);
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

