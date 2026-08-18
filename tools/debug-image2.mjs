// 检查 image_2 图片本身:能否加载、有无可见像素
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
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const asset = data.assets.find(a => a.id === 'image_2');

const imgInfo = await page.evaluate(async (src) => {
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i+3] > 0) opaque++;
      resolve({ loaded: true, w: img.naturalWidth, h: img.naturalHeight, opaquePixels: opaque });
    };
    img.onerror = () => resolve({ loaded: false });
    img.src = src;
  });
}, asset.p);
console.log('image_2 图片信息:', JSON.stringify(imgInfo));
await browser.close();

