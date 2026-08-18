import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);

// 检查动画数据里 j 字段
const jCheck = await page.evaluate(() => {
  const anim = window.__anim;
  const out = {};
  for (const ind of [40,41,43,44,46,47,48]) {
    const e = anim.renderer.elements.find(el => el && el.data && el.data.ind === ind);
    if (e) {
      const td = e.data.t.d.k;
      const s = Array.isArray(td) ? td[0].s : td.s;
      out[ind] = s.j;
    }
  }
  return out;
});
console.log('各图层 j 值:', JSON.stringify(jCheck));

// 切 canvas 确认无报错且帧数推进
await page.select('#selRenderer', 'canvas');
await sleep(2500);
const frame = await page.evaluate(() => document.getElementById('frameInfo').textContent);
console.log('canvas 帧:', frame);
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
