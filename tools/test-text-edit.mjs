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

const count = await page.evaluate(() => document.querySelectorAll('.t-input').length);
console.log('输入框数量:', count);

const before = await page.evaluate(() => {
  const ta = document.querySelector('.t-input[data-ind="48"]');
  return ta ? ta.value : null;
});
console.log('撤离成功 编辑前:', JSON.stringify(before));

// 编辑:改成新文字并触发 input 事件
await page.evaluate(() => {
  const ta = document.querySelector('.t-input[data-ind="48"]');
  ta.value = '新文字测试';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(1000); // 防抖250ms + 重渲染

const after = await page.evaluate(() => {
  // 从动画元素数据里读回文字
  const anim = window.__anim;
  let found = null;
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ind === 48) found = e.data; if (e.elements) walk(e.elements); } };
  walk(anim.renderer.elements);
  const td = found ? found.t.d.k : null;
  const text = Array.isArray(td) ? (td[0] && td[0].s && td[0].s.t) : (td && td.s && td.s.t);
  const taVal = document.querySelector('.t-input[data-ind="48"]')?.value;
  return { dataText: text, textareaValue: taVal, status: document.getElementById('statusbar').textContent };
});
console.log('撤离成功 编辑后:', JSON.stringify(after));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
