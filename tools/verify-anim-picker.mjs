/*
 * 动画选择器(顶栏触发器 + 画廊浮层)的端到端验证。
 *
 * 覆盖:触发器内容 → 画廊开关 → 卡片生成 → 搜索 → 数字键直选 → 键盘导航 →
 *       鼠标跟随光标 → 滚轮转发 → 选完焦点交还 → 点卡片切换 → 隐藏 select 兼容层 → 窄屏。
 * 另外会断言「分组筛选 / 收藏 / 简介」这三块确实已经不存在(它们是有意去掉的,
 * 如果哪天又被加回来,这里的检查会红,提醒同步更新 README 与样式)。
 *
 * 用法(需要 dev server 已在 5173 上运行):
 *   npm run dev
 *   node tools/verify-anim-picker.mjs
 * 也可以指向生产构建产物:
 *   npm run preview
 *   $env:DEV_ORIGIN='http://127.0.0.1:4173'; node tools/verify-anim-picker.mjs
 *
 * 截图在跑完后统一写入 tools/anim-picker-*.png。
 * 注意:不能边跑边写文件 —— dev server 的文件监听会把「项目里多了个文件」当成变更,
 * 给页面发一次 full-reload,把正在跑的验证打断。
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : ''));
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1600, height: 950 });
await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300_000, polling: 200 });
await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 300_000, polling: 150 });

const shots = [];
const galleryState = () => page.evaluate(() => ({
  open: !document.getElementById('animPicker').hidden,
  expanded: document.getElementById('animTrigger').getAttribute('aria-expanded'),
  cards: [...document.querySelectorAll('.ap-card')].map((c) => c.dataset.key),
  nums: [...document.querySelectorAll('.ap-card-num')].map((n) => n.textContent),
  searching: document.getElementById('animGrid').classList.contains('is-searching'),
  current: document.querySelector('.ap-card.is-current')?.dataset.key ?? '',
  focused: document.activeElement?.id || document.activeElement?.tagName || '',
}));
/* 切到某个 key 并等它真的载入(状态栏会写「已载入: <名字>」) */
const waitLoaded = (key) => page.waitForFunction(
  (k) => document.getElementById('selAnim').value === k
    && /已载入/.test(document.getElementById('statusbar').textContent || ''),
  { timeout: 300_000, polling: 200 }, key);

/* ---------- 1. 顶栏触发器 ---------- */
const total = await page.evaluate(() => document.querySelectorAll('#selAnim option').length);
const trig = await page.evaluate(() => ({
  name: document.getElementById('animTriggerName').textContent,
  meta: document.getElementById('animTriggerMeta').textContent,
  count: document.getElementById('animTriggerCount').textContent,
  thumb: document.getElementById('animTriggerThumb').getAttribute('src') || '',
  expanded: document.getElementById('animTrigger').getAttribute('aria-expanded'),
}));
check('触发器显示当前动画名', trig.name === '撤离动画', JSON.stringify(trig));
check('触发器显示分辨率/帧率', /1920×1080.*60fps/.test(trig.meta), trig.meta);
check('触发器显示动画总数', trig.count === total + ' 套', trig.count);
check('触发器带预览图', trig.thumb.length > 0, trig.thumb.slice(-40));
check('初始 aria-expanded=false', trig.expanded === 'false');

/* ---------- 2. 打开画廊:卡片与「已去掉的三个东西」 ---------- */
await page.click('#animTrigger');
await sleep(400);
let st = await galleryState();
const extras = await page.evaluate(() => ({
  removed: document.querySelectorAll('.ap-chip, .ap-filters, .ap-card-star, .ap-card-desc, .is-pinned').length,
  covers: [...document.querySelectorAll('.ap-card-cover img')].filter((i) => i.naturalWidth > 0).length,
  sub: document.getElementById('animPickerSub').textContent,
  starHint: document.querySelectorAll('.ap-hint-fav').length,
}));
check('点触发器打开画廊', st.open && st.expanded === 'true');
check('卡片数量 = 动画数量', st.cards.length === total, st.cards.length + ' vs ' + total);
check('当前动画带「当前」角标且唯一', st.current === '撤离动画' && st.cards.length > 0, st.current);
check('封面图全部加载成功', extras.covers === total, extras.covers + '/' + total);
check('搜索框自动获得焦点', st.focused === 'animSearch', String(st.focused));
check('卡片带数字键序号角标', st.nums.length === Math.min(9, total), st.nums.join(','));
check('分组筛选 / 收藏 / 简介均已移除', extras.removed === 0 && extras.starHint === 0, String(extras.removed));
shots.push({ name: 'anim-picker-gallery', data: await page.screenshot({ encoding: 'base64' }) });

/* ---------- 3. 搜索 ---------- */
await page.type('#animSearch', '扫描');
await sleep(250);
st = await galleryState();
check('搜索「扫描」只留位置暴露动画',
  st.cards.length === 1 && st.current !== undefined
  && (await page.evaluate(() => document.querySelector('.ap-card-name').textContent)) === '位置暴露动画',
  JSON.stringify(st.cards));
check('搜索态隐藏序号角标', st.searching && st.nums.length === 0, JSON.stringify({ searching: st.searching, nums: st.nums }));
await page.evaluate(() => { const i = document.getElementById('animSearch'); i.value = 'zzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(200);
st = await page.evaluate(() => ({
  cards: document.querySelectorAll('.ap-card').length,
  empty: !document.getElementById('animEmpty').hidden,
  hint: document.getElementById('animEmptyText').textContent,
}));
check('无匹配时显示空状态', st.cards === 0 && st.empty && st.hint.includes('zzz'), JSON.stringify(st));
await page.click('#animSearchClear');
await sleep(200);
check('清空搜索后恢复全部卡片',
  (await page.evaluate(() => document.querySelectorAll('.ap-card').length)) === total);

/* ---------- 4. 数字键直选 ---------- */
const beforeKey = await page.evaluate(() => document.getElementById('selAnim').value);
const numKey = await page.evaluate(() => document.querySelector('.ap-card-num').textContent === '2'
  ? document.querySelectorAll('.ap-card')[1].dataset.key : '');
await page.keyboard.press('2');
await waitLoaded(numKey);
await sleep(500);
st = await page.evaluate(() => ({
  key: document.getElementById('selAnim').value,
  open: !document.getElementById('animPicker').hidden,
  name: document.getElementById('animTriggerName').textContent,
}));
check('数字键 2 直接切换到第二张卡片', st.key === numKey && st.key !== beforeKey,
  st.key + ' (第一张是 ' + beforeKey + ')');
check('数字键切换后画廊关闭且触发器同步', !st.open && st.name.length > 0, JSON.stringify(st));

/* 搜索框有内容时,数字还给搜索框 */
await page.click('#animTrigger');
await sleep(350);
const keyBeforeType = await page.evaluate(() => document.getElementById('selAnim').value);
await page.type('#animSearch', '1');
await sleep(250);
st = await page.evaluate(() => ({
  query: document.getElementById('animSearch').value,
  key: document.getElementById('selAnim').value,
  open: !document.getElementById('animPicker').hidden,
}));
check('搜索框已有内容时数字键不再直选', st.query === '1' && st.key === keyBeforeType && st.open,
  JSON.stringify(st));
await page.click('#animSearchClear');
await sleep(200);

/* ---------- 5. 键盘导航 ---------- */
await page.keyboard.press('Escape');
await sleep(250);
st = await galleryState();
check('Esc 关闭画廊', !st.open && st.expanded === 'false', JSON.stringify(st));

await page.keyboard.press('/');
await sleep(300);
check('斜杠打开画廊', (await galleryState()).open);

const keyOnOpen = await page.evaluate(() => document.querySelector('.ap-card.is-cursor')?.dataset.key);
await page.keyboard.press('ArrowRight');
await sleep(150);
const keyAfterArrow = await page.evaluate(() => document.querySelector('.ap-card.is-cursor')?.dataset.key);
check('方向键移动卡片光标', !!keyAfterArrow && keyAfterArrow !== keyOnOpen, keyOnOpen + ' → ' + keyAfterArrow);
await page.keyboard.press('Enter');
await waitLoaded(keyAfterArrow);
await sleep(500);
check('Enter 切换到光标所在动画',
  (await page.evaluate(() => document.getElementById('selAnim').value)) === keyAfterArrow, keyAfterArrow);
check('「最近使用」写入 localStorage',
  (await page.evaluate(() => localStorage.getItem('dfa.animPicker.v1') || '')).includes(keyAfterArrow));

/* ---------- 6. 选完焦点交还:紧接着按空格应该是播放/暂停,而不是又打开画廊 ---------- */
const focusAfterPick = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '');
check('选完动画后焦点没有停在触发器上', focusAfterPick !== 'animTrigger', focusAfterPick);
const pausedBefore = await page.evaluate(() => !!window.__anim.isPaused);
await page.keyboard.press('Space');
await sleep(400);
const afterSpace = await page.evaluate(() => ({
  paused: !!window.__anim.isPaused,
  open: !document.getElementById('animPicker').hidden,
}));
check('选完动画后按空格是播放/暂停,不会重开画廊',
  afterSpace.paused !== pausedBefore && !afterSpace.open, JSON.stringify({ pausedBefore, ...afterSpace }));

/* ---------- 7. 鼠标跟随 + 滚轮转发 ---------- */
await page.click('#animTrigger');
await sleep(350);
const hoverTarget = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.ap-card')];
  const t = cards[cards.length - 1];
  const r = t.getBoundingClientRect();
  return { key: t.dataset.key, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(hoverTarget.x, hoverTarget.y);
await sleep(200);
const cursorKey = await page.evaluate(() => document.querySelector('.ap-card.is-cursor')?.dataset.key);
check('鼠标移到卡片上键盘光标跟随', cursorKey === hoverTarget.key, cursorKey + ' vs ' + hoverTarget.key);

/* 滚轮落在面板头部(不在网格上)也要能滚动网格 —— 需要网格确实可滚动,先把窗口压矮 */
await page.setViewport({ width: 900, height: 380 });
await sleep(300);
const scrollTest = await page.evaluate(() => {
  const body = document.getElementById('animPickerBody');
  const scrollable = body.scrollHeight > body.clientHeight;
  const before = body.scrollTop;
  document.querySelector('.ap-head').dispatchEvent(
    new WheelEvent('wheel', { deltaY: 160, bubbles: true, cancelable: true }));
  return { scrollable, before, after: body.scrollTop };
});
check('滚轮在面板头部也能滚动卡片网格',
  scrollTest.scrollable ? scrollTest.after > scrollTest.before : st.cards.length <= 6,
  JSON.stringify(scrollTest));
await page.setViewport({ width: 1600, height: 950 });
await page.keyboard.press('Escape');
await sleep(300);
await page.keyboard.press('Escape');
await sleep(200);

/* ---------- 8. 点卡片切换 + 隐藏 select 兼容层 ---------- */
await page.click('#animTrigger');
await sleep(350);
await page.evaluate(() => {
  [...document.querySelectorAll('.ap-card')].find((c) => c.dataset.key === 'extraction')
    .querySelector('.ap-card-pick').click();
});
await waitLoaded('extraction');
await sleep(400);
st = await page.evaluate(() => ({
  key: document.getElementById('selAnim').value,
  open: !document.getElementById('animPicker').hidden,
  name: document.getElementById('animTriggerName').textContent,
  firstCard: document.querySelector('.ap-card')?.dataset.key ?? '',
}));
check('点卡片切换动画并关闭画廊', st.key === 'extraction' && !st.open, JSON.stringify(st));
check('触发器名称随切换更新', st.name === '撤离动画', st.name);

await page.click('#animTrigger');
await sleep(350);
st = await galleryState();
check('「最近使用」让刚用过的动画排在最前', st.cards[0] === 'extraction', st.cards.join(' > '));
await page.keyboard.press('Escape');
await sleep(250);

/* 历史脚本用 page.select('#selAnim', key) 驱动切换,必须继续可用 */
await page.select('#selAnim', 'blinds');
await sleep(1500);
check('隐藏 select 仍可驱动切换(老脚本兼容)',
  (await page.evaluate(() => document.getElementById('selAnim').value)) === 'blinds',
  await page.evaluate(() => document.getElementById('statusbar').textContent));
await page.select('#selAnim', 'extraction');
await sleep(1500);

/* ---------- 9. 窄屏 ---------- */
await page.setViewport({ width: 420, height: 880 });
await page.click('#animTrigger');
await sleep(500);
st = await page.evaluate(() => {
  const panel = document.querySelector('.ap-panel').getBoundingClientRect();
  return {
    open: !document.getElementById('animPicker').hidden,
    panelW: Math.round(panel.width),
    vw: window.innerWidth,
    numBadges: document.querySelectorAll('.ap-card-num').length,
  };
});
check('窄屏画廊铺满视口', st.open && st.panelW === st.vw, JSON.stringify(st));
shots.push({ name: 'anim-picker-mobile', data: await page.screenshot({ encoding: 'base64' }) });
await page.setViewport({ width: 1600, height: 950 });
await page.keyboard.press('Escape');
await sleep(300);
shots.push({ name: 'anim-picker-topbar', data: await page.screenshot({ encoding: 'base64' }) });

check('无页面异常', errs.length === 0, errs.join(' | '));

await browser.close();
/* 截图统一在浏览器关闭后落盘(原因见文件头注释) */
for (const s of shots) fs.writeFileSync(path.join(ROOT, 'tools', s.name + '.png'), Buffer.from(s.data, 'base64'));

console.log(out.join('\n'));
console.log('\n' + (failures ? failures + ' 项未通过' : '全部通过') + '(' + out.length + ' 项检查)');
process.exit(failures ? 1 : 0);
