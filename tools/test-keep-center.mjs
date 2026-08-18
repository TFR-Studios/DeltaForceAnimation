import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);

const readState = () => page.evaluate(() => {
  const anim = window.__anim;
  const e = anim.renderer.elements.find(el => el && el.data && el.data.ind === 48);
  const td = e.data.t.d.k;
  const s = Array.isArray(td) ? td[0].s : td.s;
  // 测量文字中心(屏幕坐标,通过渲染的 text 元素)
  const chars = Array.from(document.querySelectorAll('#previewInner text')).filter(t => t.textContent && t.textContent.trim());
  let centerX = null;
  if (chars.length) {
    let minL = 1e9, maxR = -1;
    for (const t of chars) { const r = t.getBoundingClientRect(); if (r.left < minL) minL = r.left; if (r.right > maxR) maxR = r.right; }
    centerX = Math.round((minL + maxR) / 2);
  }
  return { anchorX: Math.round(e.data.ks.a.k[0] * 100) / 100, text: s.t, centerX };
});

const before = await readState();
console.log('编辑前:', JSON.stringify(before));

// 改成更短文字
await page.evaluate(() => {
  const ta = document.querySelector('.t-input[data-ind="48"]');
  ta.value = '成功';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
const short = await readState();
console.log('改短(成功)后:', JSON.stringify(short));

// 改成更长文字
await page.evaluate(() => {
  const ta = document.querySelector('.t-input[data-ind="48"]');
  ta.value = '撤离成功撤离成功';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(800);
const long = await readState();
console.log('改长(撤离成功撤离成功)后:', JSON.stringify(long));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
