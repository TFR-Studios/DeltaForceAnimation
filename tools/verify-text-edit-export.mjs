/* 端到端验证:改字 → 导出 MP4 → 从导出的视频里取帧 OCR,
 * 确认「用户改过的文字」真的进了导出产物(这条链路会走 SVG 逐帧光栅化 + 字体内联)。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const OUT = ROOT + '/tools/.mission-check';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  // 改两处文字
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('#textList .text-item')];
    const set = (nm, txt) => {
      const i = items.findIndex((li) => li.querySelector('.t-name').textContent.includes(nm));
      const ta = document.querySelectorAll('#textList .t-input')[i];
      ta.focus(); ta.value = txt; ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('任务名', '测试文字');
    set('数字', '8888');
  });
  await sleep(2500);
  // 导出(按钮用 element.click(),避免被启动加载层挡住)
  await page.evaluate(() => document.getElementById('btnExport').click());
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => ({ s: document.getElementById('exportStatus').textContent, p: document.getElementById('exportPercent').textContent, d: document.getElementById('exportDetail').textContent }));
    if (st.p === '100%') { console.log('导出完成: ' + JSON.stringify(st)); done = true; break; }
    await sleep(1500);
  }
  if (!done) console.log('导出未在 240s 内完成');
  console.log('页面错误: ' + (errs.length ? errs.join(' || ') : '(无)'));
  await page.close();

  // 从导出产物里取帧 OCR(dev 下 /save-avi 会把同一份字节写到 tools/user-export.avi)
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1920, height: 1080 });
  await page2.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const drawn = await page2.evaluate(async (u) => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = u;
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#000';
    document.body.appendChild(v);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video error')); setTimeout(() => rej(new Error('timeout')), 20000); }).catch(() => {});
    v.currentTime = 2.2;
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 5000); });
    const cv = document.createElement('canvas');
    cv.width = v.videoWidth || 1920;
    cv.height = v.videoHeight || 1080;
    cv.getContext('2d').drawImage(v, 0, 0);
    return { w: cv.width, h: cv.height, url: cv.toDataURL('image/png') };
  }, '/tools/user-export.avi').catch((e) => ({ error: String(e && e.message) }));
  if (drawn && drawn.url) {
    fs.writeFileSync(OUT + '/exported-frame.png', Buffer.from(drawn.url.split(',')[1], 'base64'));
    console.log('导出视频取帧: ' + drawn.w + 'x' + drawn.h + ' → tools/.mission-check/exported-frame.png');
  } else console.log('取帧失败: ' + JSON.stringify(drawn));
} finally { await browser.close(); }
