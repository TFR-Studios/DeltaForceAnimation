import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);
await page.evaluate(() => document.getElementById('btnExport').click());
let status = '';
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  status = await page.evaluate(() => document.getElementById('statusbar').textContent);
  if (status.includes('完成') || status.includes('失败')) break;
}
console.log('最终状态:', status);
console.log('错误:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
