import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 150)));
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  const targets = [['extraction', '撤离动画'], ['exposed', '位置暴露动画'], ['blinds', '核电站功率动画'], ['mission', '任务弹窗动画']];
  for (const [key, label] of targets) {
    if (key !== 'extraction') {
      await page.select('#selAnim', key);
      for (let i = 0; i < 60; i++) {
        const ok = await page.evaluate((l) => document.getElementById('statusbar').textContent.includes(l), label);
        if (ok) break;
        await sleep(500);
      }
    }
    await sleep(800);
    const info = await page.evaluate(() => ({
      status: document.getElementById('statusbar').textContent,
      shapes: [...document.querySelectorAll('#shapeList .text-item')].map((li) => li.querySelector('.t-name').textContent),
      texts: [...document.querySelectorAll('#textList .text-item')].map((li) => li.querySelector('.t-name').textContent),
      images: [...document.querySelectorAll('#imageList .text-item')].map((li) => li.querySelector('.t-name').textContent),
    }));
    const dup = info.shapes.length !== new Set(info.shapes).size || info.texts.length !== new Set(info.texts).size;
    console.log((dup ? 'FAIL ' : 'PASS ') + label + ' 形状' + info.shapes.length + ' 文字' + info.texts.length + ' 图片' + info.images.length + (dup ? ' 有重复项' : ''));
    if (info.shapes.some((s) => s.includes('›')) || info.texts.some((s) => s.includes('›'))) {
      console.log('       预合成项: ' + [...info.shapes, ...info.texts].filter((s) => s.includes('›')).join(' | '));
    }
  }
  console.log('页面错误: ' + (errs.length ? errs.slice(0, 3).join(' || ') : '(无)'));
} finally { await browser.close(); }
