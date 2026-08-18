// 保存镜像后的完整动画截图文件供用户查看
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'svg');
await sleep(2000);
await page.evaluate(async () => { window.__anim.renderer.renderFrame(120, true); await new Promise(r=>setTimeout(r,600)); });
// 直接把 svg 画到 canvas 并截下 PNG
await page.evaluate(() => { document.getElementById('previewInner').style.transform = 'scale(1)'; });
await page.screenshot({ path: 'I:/Delta Force custom animation/tools/mirror-full.png' });
console.log('截图已保存: tools/mirror-full.png');
await browser.close();

