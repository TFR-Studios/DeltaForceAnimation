// 无头复现:对比 SVG 与 Canvas 渲染器,收集控制台错误并截图
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
});

async function testRenderer(renderer) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) logs.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.select('#selRenderer', renderer);
  await new Promise((r) => setTimeout(r, 4000));
  const info = await page.evaluate(() => {
    const inner = document.getElementById('previewInner');
    const stage = document.getElementById('stage');
    const status = document.getElementById('statusbar').textContent;
    const child = inner.firstElementChild;
    return {
      status,
      childTag: child ? child.tagName : null,
      innerHtmlLen: inner.innerHTML.length,
      canvasCount: inner.querySelectorAll('canvas').length,
      canvasW: inner.querySelector('canvas') ? inner.querySelector('canvas').width : 0,
      canvasH: inner.querySelector('canvas') ? inner.querySelector('canvas').height : 0,
    };
  });
  await page.screenshot({ path: 'tools/shot-' + renderer + '.png' });
  console.log('=== renderer:', renderer, '===');
  console.log(JSON.stringify(info, null, 2));
  console.log('logs:');
  for (const l of logs.slice(0, 40)) console.log('  ' + l);
  if (logs.length > 40) console.log('  ... ' + (logs.length - 40) + ' more');
  await page.close();
}

await testRenderer('svg');
await testRenderer('canvas');
await browser.close();

