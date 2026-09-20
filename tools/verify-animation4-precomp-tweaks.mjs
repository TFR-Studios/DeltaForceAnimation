/* 验证本轮两项改动:
 * 1) 预合成「框 › 形状图层 6」默认不透明度 = 80%(侧栏滑块初值与数据关键帧峰值);
 * 2) 「框 › 形状图层 5」的描边编辑项不再显示(紫色 #5400ff),而填充(黑色)仍可编辑;
 * 3) 顺带确认没误伤:撤离动画里同名的「形状图层 5」(描边 #FDFDFD)描边编辑项应保留。 */
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
let fails = 0;
const check = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  → ' + extra : '')); };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 150)));
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  await sleep(700);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#shapeList .text-item')].map((li) => ({
    nm: li.querySelector('.t-name').textContent,
    ind: Number((li.querySelector('.s-fill,.s-stroke,.o-slider') || { dataset: {} }).dataset.ind),
    fill: li.querySelector('.s-fill') ? li.querySelector('.s-fill').value : null,
    stroke: li.querySelector('.s-stroke') ? li.querySelector('.s-stroke').value : null,
    opacity: li.querySelector('.o-slider') ? li.querySelector('.o-slider').value : null,
  })));
  const l6 = rows.find((r) => r.nm.includes('形状图层 6'));
  const l5 = rows.find((r) => r.nm.includes('形状图层 5'));
  console.log('「框 › 形状图层 6」: ' + JSON.stringify(l6));
  console.log('「框 › 形状图层 5」: ' + JSON.stringify(l5));
  check('形状图层 6 默认不透明度 = 80%', l6 && l6.opacity === '80', l6 && ('滑块=' + l6.opacity + '%'));
  check('形状图层 5 不显示描边编辑项', l5 && l5.stroke === null, l5 && ('stroke=' + l5.stroke));
  check('形状图层 5 的填充仍可编辑(黑色)', l5 && l5.fill === '#000000', l5 && ('fill=' + l5.fill));
  // 撤离动画:同名的形状图层 5 描边应保留
  await page.select('#selAnim', 'extraction');
  for (let i = 0; i < 40; i++) { const ok = await page.evaluate(() => document.getElementById('statusbar').textContent.includes('撤离动画')); if (ok) break; await sleep(500); }
  await sleep(1200);
  const ext = await page.evaluate(() => [...document.querySelectorAll('#shapeList .text-item')].filter((li) => li.querySelector('.t-name').textContent === '形状图层 5').map((li) => ({ fill: li.querySelector('.s-fill') ? li.querySelector('.s-fill').value : null, stroke: li.querySelector('.s-stroke') ? li.querySelector('.s-stroke').value : null })));
  console.log('撤离动画「形状图层 5」: ' + JSON.stringify(ext));
  check('撤离动画同名的形状图层 5 描边编辑项未被误删', ext.length > 0 && ext[0].stroke !== null, JSON.stringify(ext));
  check('无页面脚本错误', errs.length === 0, errs.slice(0, 3).join(' || '));
} finally { await browser.close(); }
console.log(fails === 0 ? '\n全部符合预期' : '\n有 ' + fails + ' 项不符');
