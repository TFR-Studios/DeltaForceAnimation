/* 窄屏(手机/竖屏平板)布局验证:主布局单栏化、舞台不塌成 0 高度、只剩页面一层滚动、状态栏吸底。
 * 背景:窄屏独有的一类回归 —— 侧栏固定 320px 且 flex-shrink:0,390px 视口里预览区只剩 70px,
 * 舞台被压成 46×2,applyFit 据此算出的 baseScale 是 0,动画完全看不见(而且页面不报错)。
 * 所以这里断言的不是"样式写对了",而是"动画真的看得见 + 只有一层滚动条"。
 * 用 dev 服务器跑:npm run dev 后 node tools/verify-mobile-layout.mjs */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://127.0.0.1:5173/';
const shot = (n) => fileURLToPath(new URL('./' + n, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; out.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  -> ' + extra : '')); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });

async function open(w, h) {
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.setViewport({ width: w, height: h, isMobile: w < 600, hasTouch: w < 600 });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#app-loading')?.classList.contains('is-hidden'), { timeout: 240000, polling: 500 });
  await sleep(1500);
  return { page, errs };
}

const probe = (page) => page.evaluate(() => {
  const de = document.documentElement, Q = (s) => document.querySelector(s);
  const box = (s) => { const b = Q(s).getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
  const st = Q('#stage'), sr = st.getBoundingClientRect(), svg = st.querySelector('svg');
  const vr = svg ? svg.getBoundingClientRect() : null;
  const sp = Q('.side-panel');
  let overflow = [];
  document.querySelectorAll('body *').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && b.right > de.clientWidth + 1) overflow.push((el.id || el.className || el.tagName) + ':' + Math.round(b.right)); });
  const iconBtn = Q('.transport .icon-btn').getBoundingClientRect();
  return {
    vw: de.clientWidth, sw: de.scrollWidth,
    stage: box('#stage'), transport: box('.transport'),
    canvasVisible: !!(vr && vr.width > 20 && vr.height > 20 && vr.right > sr.left && vr.left < sr.right && vr.bottom > sr.top && vr.top < sr.bottom),
    innerScale: Q('#previewInner').style.transform,
    pageScrolls: de.scrollHeight > de.clientHeight,
    sideOwnScroll: sp.scrollHeight > sp.clientHeight + 1,
    sideW: Math.round(sp.getBoundingClientRect().width),
    stackDirection: getComputedStyle(Q('.layout')).flexDirection,
    statusbar: { pos: getComputedStyle(Q('#statusbar')).position, ...box('#statusbar') },
    iconBtn: { w: Math.round(iconBtn.width), h: Math.round(iconBtn.height) },
    overflow,
  };
});

// ---- 手机 / 竖屏平板:单栏、舞台可见、只有页面一层滚动 ----
for (const [w, h, name] of [[320, 640, '320'], [360, 740, '360'], [390, 844, '390'], [430, 932, '430'], [768, 1024, '768'], [820, 1180, '820']]) {
  const { page, errs } = await open(w, h);
  const s = await probe(page);
  check(name + 'px:无 JS 报错', errs.length === 0, errs.join(' | '));
  check(name + 'px:无横向滚动', s.sw <= s.vw && s.overflow.length === 0, 'sw=' + s.sw + ' vw=' + s.vw + ' ' + s.overflow.slice(0, 3).join(','));
  check(name + 'px:主布局为上下单栏', s.stackDirection === 'column', s.stackDirection);
  check(name + 'px:舞台未被压塌', s.stage.w >= Math.min(w, 320) - 40 && s.stage.h >= 140, s.stage.w + 'x' + s.stage.h);
  check(name + 'px:动画真的画在舞台里', s.canvasVisible, 'inner' + s.innerScale);
  check(name + 'px:侧栏占满整宽(不再固定 320px)', s.sideW === s.vw, s.sideW + ' vs ' + s.vw);
  check(name + 'px:只剩页面一层滚动条', s.pageScrolls && !s.sideOwnScroll, 'page=' + s.pageScrolls + ' side=' + s.sideOwnScroll);
  check(name + 'px:状态栏吸底', s.statusbar.pos === 'sticky' && Math.abs(s.statusbar.bottom - h) <= 1, s.statusbar.pos + ' bottom=' + s.statusbar.bottom);
  check(name + 'px:播放/暂停按钮命中区 ≥ 40px', s.iconBtn.h >= 40 && s.iconBtn.w >= 40, s.iconBtn.w + 'x' + s.iconBtn.h);
  if (w === 390) {
    await page.evaluate(() => window.scrollTo(0, 2500)); await sleep(300);
    const mid = await probe(page);
    check('390px:滚到页面中部状态栏仍吸底', Math.abs(mid.statusbar.bottom - h) <= 1, 'bottom=' + mid.statusbar.bottom);
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
    await page.screenshot({ path: shot('ui-mobile-after.png') });
  }
  await page.close();
}

// ---- 桌面:必须与改造前完全一致 ----
{
  const { page, errs } = await open(1440, 900);
  const s = await probe(page);
  check('桌面:无 JS 报错', errs.length === 0, errs.join(' | '));
  check('桌面:仍是左右两栏', s.stackDirection === 'row', s.stackDirection);
  check('桌面:侧栏仍是固定 320px 且自身滚动', s.sideW === 320 && s.sideOwnScroll, s.sideW + ' ownScroll=' + s.sideOwnScroll);
  check('桌面:页面本身不滚动', !s.pageScrolls, 'scrollH>' + 900);
  check('桌面:状态栏不吸底(仍在文档流末尾)', s.statusbar.pos === 'static', s.statusbar.pos);
  check('桌面:舞台尺寸未被窄屏规则影响', s.stage.w === 1096 && s.stage.h === 668, s.stage.w + 'x' + s.stage.h);
  check('桌面:播放控制条仍是两行 98px', s.transport.h === 98, s.transport.h + 'px');
  await page.screenshot({ path: shot('ui-desktop-after.png') });
  await page.close();
}

await browser.close();
console.log(out.join('\n'));
console.log(failures === 0 ? '\nALL PASS' : '\nFAILURES: ' + failures);
process.exit(failures === 0 ? 0 : 1);
