/* 顶栏内联制作声明验证:并入顶栏、不增加顶栏高度、文案一致、不影响顶栏控件与状态栏 */
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; out.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  -> ' + extra : '')); };
const EXPECT = '网站内动画均由人工使用AE制作，未使用AI辅助';
const TOPBAR_BASELINE_H = 53; // 加声明前实测的顶栏高度

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1700, height: 1000 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => document.querySelector('#app-loading')?.classList.contains('is-hidden'), { timeout: 240000, polling: 500 });
await sleep(1200);

const probe = () => page.evaluate((EXPECT, BASE) => {
  const note = document.querySelector('.craft-note');
  const noteText = document.querySelector('.craft-note-text');
  const brand = document.querySelector('.topbar .brand');
  const sw = document.querySelector('.anim-switch');
  const topbar = document.querySelector('header.topbar');
  const stage = document.querySelector('.preview-stage');
  const nr = note.getBoundingClientRect(), br = brand.getBoundingClientRect(), sr = sw.getBoundingClientRect(), tr = topbar.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const cs = getComputedStyle(note);
  return {
    text: noteText.textContent.trim(),
    expects: EXPECT,
    stripGone: !document.querySelector('.craft-notice'),
    inTopbar: topbar.contains(note),
    pageStartsAtTopbar: Math.round(tr.top) === 0,
    topbarH: Math.round(tr.height),
    topbarBaseline: BASE,
    noteH: Math.round(nr.height),
    afterBrand: nr.left >= br.right - 0.5,
    beforeSwitch: nr.right <= sr.left + 0.5,
    switchStillRight: Math.round(innerWidth - sr.right) <= 20,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && nr.width > 0 && nr.height > 0,
    oneLine: nr.height < 30,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stageTop: Math.round(st.top),
  };
}, EXPECT, TOPBAR_BASELINE_H);

const s1 = await probe();
check('页面无 JS 报错', errs.length === 0, errs.join(' | '));
check('独立通栏已移除', s1.stripGone);
check('声明位于顶栏内部', s1.inTopbar && s1.pageStartsAtTopbar);
check('不再额外占用高度(顶栏高度未变)', s1.topbarH === s1.topbarBaseline, s1.topbarH + ' vs ' + s1.topbarBaseline);
check('声明文案与要求逐字一致', s1.text === EXPECT, JSON.stringify(s1.text));
check('位于品牌之后、动画切换之前', s1.afterBrand && s1.beforeSwitch);
check('动画切换仍贴右', s1.switchStillRight);
check('单行胶囊且高度小于顶栏内容', s1.visible && s1.oneLine, 'noteH=' + s1.noteH + ' topbarH=' + s1.topbarH);
check('预览区已上移(比横幅方案多出约一行空间)', s1.stageTop <= 70, 'stageTop=' + s1.stageTop);
check('桌面宽度无横向滚动', s1.overflowX <= 0, 'overflowX=' + s1.overflowX);
const noteEl = await page.$('.craft-note');
await noteEl.screenshot({ path: 'I:/Delta Force custom animation/tools/craft-note-badge.png' });
await page.screenshot({ path: 'I:/Delta Force custom animation/tools/craft-note-firstscreen.png', clip: { x: 0, y: 0, width: 1700, height: 230 } });

// 状态栏不受影响
await page.evaluate(() => { const el = document.querySelector('#statusbar'); window.__err = (() => { const b = getComputedStyle(el).color; el.classList.add('error'); const a = getComputedStyle(el).color; el.classList.remove('error'); return [b, a]; })(); });
await page.select('#selAnim', 'exposed');
await page.waitForFunction(() => document.querySelector('#statusbar').textContent !== '就绪', { timeout: 180000, polling: 500 }).catch(() => {});
await sleep(600);
const s2 = await page.evaluate(() => ({ status: document.querySelector('#statusbar').textContent, err: window.__err }));
check('状态栏文本仍正常更新', s2.status !== '就绪' && s2.status.length > 0, JSON.stringify(s2.status));
check('状态栏错误态仍变红', s2.err[0] !== s2.err[1], JSON.stringify(s2.err));

// 中等宽度与窄屏:顶栏换行但不溢出、声明不遮挡控件
for (const w of [1280, 1024, 768, 390]) {
  await page.setViewport({ width: w, height: 900 });
  await sleep(500);
  const s = await probe();
  check(w + 'px:无横向滚动且声明可见', s.overflowX <= 0 && s.visible && s.text === EXPECT, 'overflowX=' + s.overflowX + ' noteH=' + s.noteH);
  if (w === 390) await (await page.$('.craft-note')).screenshot({ path: 'I:/Delta Force custom animation/tools/craft-note-mobile.png' });
}
await page.setViewport({ width: 1700, height: 1000 });
await sleep(400);

await browser.close();
console.log(out.join('\n'));
console.log(failures === 0 ? '\nALL PASS' : '\nFAILURES: ' + failures);
process.exit(failures === 0 ? 0 : 1);
