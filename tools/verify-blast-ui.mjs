/* 黑潮爆破默认弹窗动画的交互校验:侧栏区块显隐 / 文字可编辑 / 时长可调 / 画廊卡片与封面。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(import.meta.dirname, '.blast-check');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1700, height: 1000 } });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300000, polling: 200 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast'
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 200 });
  await page.evaluate(() => { window.__anim.pause(); window.__anim.goToAndStop(120, true); });
  await sleep(400);

  const sections = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el ? (el.hidden ? 'hidden' : 'visible') : 'missing'; };
    return {
      timings: vis('timingSection'), theme: vis('themeSection'), image: vis('imageSection'),
      icon: vis('iconSection'), popup: vis('popupSection'), reward: vis('missionRewardSection'),
      durationValue: document.getElementById('durationVal').textContent,
      durationSlider: document.getElementById('rngDuration').value,
      textItems: [...document.querySelectorAll('#textList .t-name')].map((n) => n.textContent),
      shapeItems: [...document.querySelectorAll('#shapeList .s-name')].map((n) => n.textContent),
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('sections:', JSON.stringify(sections, null, 1));

  const stage = await page.$('#stage');
  await stage.screenshot({ path: path.join(OUT, 'ui-before-edit.png') });

  // 改「主标题」文案:找到对应的 textarea,写入新文案并触发 input
  const edit = await page.evaluate(async () => {
    const tas = [...document.querySelectorAll('#textList .t-input')];
    const info = tas.map((t) => ({ ind: t.dataset.ind, val: t.value.slice(0, 12) }));
    if (!tas.length) return { info, changed: false };
    const ta = tas[tas.length - 1]; // 列表顺序:主标题在前、副标题在后,取最后一个 = 副标题?这里两个都改不到就返回原值
    const before = ta.value;
    ta.value = '黑潮爆破测试文案';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { info, changed: true, before: before.slice(0, 12) };
  });
  console.log('edit:', JSON.stringify(edit));
  await sleep(1200);
  await page.evaluate(() => { if (window.__anim) { window.__anim.pause(); window.__anim.goToAndStop(120, true); } });
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'ui-after-edit.png') });

  // 时长滑块:拖到 3.7s(剪掉空尾)
  await page.evaluate(() => {
    const rng = document.getElementById('rngDuration');
    rng.value = '3.7';
    rng.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1600);
  const after = await page.evaluate(() => ({
    totalFrames: window.__anim ? window.__anim.totalFrames : null,
    durationVal: document.getElementById('durationVal').textContent,
    status: document.getElementById('statusbar').textContent,
  }));
  console.log('after duration:', JSON.stringify(after));

  // 画廊:打开动画选择器并截图(确认新卡片与封面)
  await page.evaluate(() => document.getElementById('animTrigger').click());
  await sleep(700);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.ap-card')].map((el) => ({
    key: el.dataset.key,
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    img: el.querySelector('.ap-card-cover img') ? el.querySelector('.ap-card-cover img').getAttribute('src') : null,
  })));
  console.log('cards:', JSON.stringify(cards, null, 1));
  const blastCard = cards.find((c) => c.key === 'blast');
  console.log(blastCard && blastCard.img && /blast\.webp$/.test(blastCard.img)
    ? 'GALLERY CARD OK(新卡片在列且带专属封面)'
    : 'GALLERY CARD FAILED:' + JSON.stringify(blastCard));
  await page.screenshot({ path: path.join(OUT, 'ui-picker.png') });
  console.log('errors:', errors.slice(0, 4).join(' || ') || '(none)');
} finally { await browser.close(); }
