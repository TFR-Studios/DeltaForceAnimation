import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'], protocolTimeout: 900000 });
const p = await browser.newPage(); await p.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300000, polling: 300 });
await p.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 300000, polling: 300 });
const shot = async (rend, file) => {
  await p.select('#selRenderer', rend);
  await p.evaluate(() => { const s = document.getElementById('selAnim'); s.value = 'maptitle'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => /已载入/.test(document.getElementById('statusbar').textContent) && document.getElementById('statusbar').textContent.includes('地图标题'), { timeout: 300000, polling: 300 });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => { window.__anim.goToAndStop(150, true); });
  await new Promise(r => setTimeout(r, 800));
  const inner = await p.$('#previewInner');
  await inner.screenshot({ path: file });
  // 用 1:1 缩放把画布拍成 1024x1024:临时把 baseScale 拉满不现实,这里直接量元素尺寸
  const box = await p.evaluate(() => { const r = document.getElementById('previewInner').getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
  return box;
};
const c = await shot('canvas', 'tools/.rend-canvas.png');
const s = await shot('svg', 'tools/.rend-svg.png');
console.log(JSON.stringify({ canvasBox: c, svgBox: s }));
await browser.close();
