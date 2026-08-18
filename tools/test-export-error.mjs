import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);
// 点导出(MP4),等几秒看错误
await page.evaluate(() => document.getElementById('btnExport').click());
await sleep(4000);
const status = await page.evaluate(() => document.getElementById('statusbar').textContent);
console.log('状态:', status);
console.log('错误日志:');
errors.slice(0, 20).forEach(e => console.log('  ' + e.slice(0, 600)));
await browser.close();
