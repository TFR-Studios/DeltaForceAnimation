import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2000);

const read = () => page.evaluate(() => ({
  zoom: document.getElementById('zoomInfo').textContent,
  transform: document.getElementById('previewInner').style.transform,
}));

const before = await read();
console.log('初始:', JSON.stringify(before));

// 滚轮缩放(在舞台中心,向上滚=放大)
const wheelResult = await page.evaluate(async () => {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
  await new Promise((res) => setTimeout(res, 100));
  return {
    zoom: document.getElementById('zoomInfo').textContent,
    transform: document.getElementById('previewInner').style.transform,
  };
});
console.log('滚轮放大后:', JSON.stringify(wheelResult));

// 拖拽平移
const dragResult = await page.evaluate(async () => {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
  stage.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 80, clientY: cy + 40, pointerId: 1, pointerType: 'mouse', bubbles: true }));
  stage.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 80, clientY: cy + 40, pointerId: 1, pointerType: 'mouse', bubbles: true }));
  await new Promise((res) => setTimeout(res, 100));
  return {
    zoom: document.getElementById('zoomInfo').textContent,
    transform: document.getElementById('previewInner').style.transform,
  };
});
console.log('拖拽后:', JSON.stringify(dragResult));

// 双击复位
const resetResult = await page.evaluate(async () => {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  stage.dispatchEvent(new MouseEvent('dblclick', { clientX: cx, clientY: cy, bubbles: true }));
  await new Promise((res) => setTimeout(res, 100));
  return {
    zoom: document.getElementById('zoomInfo').textContent,
    transform: document.getElementById('previewInner').style.transform,
  };
});
console.log('双击复位后:', JSON.stringify(resetResult));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
