/* 制作声明入场动效验证:蒙版从左往右揭示、缓动拉满、图标弹入、扫光、下划线、边框光晕、降级 */
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; out.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  -> ' + extra : '')); };
const EXPECT = '网站内动画均由人工使用AE制作，未使用AI辅助';
const SHOT = 'I:/Delta Force custom animation/tools/';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1700, height: 1000 });

const startSampling = () => page.evaluate(() => new Promise((resolve) => {
  const el = document.querySelector('.craft-note');
  const icon = document.querySelector('.craft-note-ico');
  const em = document.querySelector('.craft-note em');
  const samples = [];
  const run = () => {
    const t0 = performance.now();
    const tick = () => {
      const cs = getComputedStyle(el);
      samples.push({
        t: Math.round(performance.now() - t0),
        clip: cs.clipPath,
        shadow: cs.boxShadow,
        iconTf: getComputedStyle(icon).transform,
        emBg: getComputedStyle(em).backgroundSize,
        sheen: getComputedStyle(el, '::after').opacity,
      });
      if (performance.now() - t0 < 2800) requestAnimationFrame(tick); else resolve(samples);
    };
    tick();
  };
  if (document.documentElement.classList.contains('craft-ready')) run();
  else new MutationObserver((_m, o) => {
    if (document.documentElement.classList.contains('craft-ready')) { o.disconnect(); run(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
const sampling = startSampling();
await page.waitForFunction(() => document.documentElement.classList.contains('craft-ready'), { timeout: 240000, polling: 100 });
const samples = await sampling;

const rightInset = (clip) => {
  if (!clip || clip === 'none') return null;
  const m = clip.match(/inset\(([^)]*?)(?:\s+round\s+[^)]*)?\)/);
  if (!m) return null;
  const tok = m[1].trim().split(/\s+/);
  if (tok.length === 1) return parseFloat(tok[0]) === 0 ? 0 : null;
  const v = tok[1];
  return v.endsWith('%') ? parseFloat(v) : (parseFloat(v) === 0 ? 0 : null);
};
/** box-shadow 计算值形如 "<color> 0px 0px 16px 0px":长度依次是 x/y/blur/spread,模糊半径取第 3 个 */
const glowPeak = (shadow) => {
  let blur = 0, alpha = 0;
  for (const part of String(shadow).split(/,(?![^(]*\))/)) {
    const lens = (part.match(/[\d.]+px/g) || []).map(parseFloat);
    if (lens.length >= 3) blur = Math.max(blur, lens[2]);
    const a = part.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
    if (a) alpha = Math.max(alpha, parseFloat(a[1]));
    else if (/rgb\(/.test(part)) alpha = 1;
  }
  return { blur, alpha };
};

const insets = samples.map((s) => rightInset(s.clip)).filter((v) => v !== null);
const first = insets[0], last = insets[insets.length - 1];
const monotonic = insets.every((v, i) => i === 0 || v <= insets[i - 1] + 0.5);
const startSample = samples[0], endSample = samples[samples.length - 1];
const maxSheen = Math.max(...samples.map((s) => parseFloat(s.sheen) || 0));
const glows = samples.map((s) => glowPeak(s.shadow));
const peakGlow = { blur: Math.max(...glows.map((g) => g.blur)), alpha: Math.max(...glows.map((g) => g.alpha)) };
const q4 = samples[Math.floor(samples.length * 0.25)];
const q4Inset = rightInset(q4.clip);
// 同一时刻线性缓动的剩余遮罩应为 1 - (t-420)/800;实测应远小于它,才说明"缓动拉满"
const q4Linear = Math.max(0, 100 - ((q4.t - 420) / 800) * 100);

check('页面无 JS 报错', errs.length === 0, errs.join(' | '));
check('蒙版起手完全遮住(右侧裁切 100%)', first !== undefined && first > 90, 'first=' + first);
check('蒙版收尾完全揭开(右侧裁切 0%)', last === 0, 'last=' + last);
check('遮罩边只从左往右退(单调不回头)', monotonic, 'samples=' + insets.length + ' range=' + Math.min(...insets) + '~' + Math.max(...insets));
check('缓动拉满:同刻线性应剩 ' + q4Linear.toFixed(0) + '%,实测仅剩 ' + (q4Inset === null ? '?' : q4Inset.toFixed(1)) + '%', q4Inset !== null && q4Inset < q4Linear * 0.4, 't=' + q4.t + 'ms');
check('图标由旋转缩小弹入到回正', startSample.iconTf !== endSample.iconTf, startSample.iconTf + ' -> ' + endSample.iconTf);
check('高光条扫过(opacity 峰值 > 0.5)', maxSheen > 0.5, 'maxOpacity=' + maxSheen);
check('边框蓝光确实亮起(模糊半径 >= 10px 且 alpha >= 0.3)', peakGlow.blur >= 10 && peakGlow.alpha >= 0.3, JSON.stringify(peakGlow));
check('强调句下划线由 0 拉到满宽', startSample.emBg !== endSample.emBg && /100%\s+2px/.test(endSample.emBg), startSample.emBg + ' -> ' + endSample.emBg);

// ---- 确定性截帧:暂停 Web Animations 并把时间轴钉在指定毫秒,规避截图延迟抖动 ----
const freezeAt = (ms) => page.evaluate((ms) => {
  const anims = document.getAnimations().filter((a) => String(a.animationName || '').startsWith('craft-'));
  for (const a of anims) { a.pause(); a.currentTime = ms; }
  return anims.map((a) => a.animationName);
}, ms);
/** 收尾:把每条动画钉在自己的结束时刻(不能调 play():已结束的动画 play() 会倒回 0 重播,而重播时胶囊被完全裁掉会连鼠标悬停都命不中) */
const settle = () => page.evaluate(() => {
  for (const a of document.getAnimations()) {
    const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : null;
    if (end != null && isFinite(end)) { a.currentTime = end; a.pause(); } else { a.play(); }
  }
  return getComputedStyle(document.querySelector('.craft-note')).clipPath;
});

const names = await freezeAt(500);          // 揭开一半(easeOutExpo:10% 时长 ≈ 50% 进度)
await sleep(120);
await (await page.$('.craft-note')).screenshot({ path: SHOT + 'craft-motion-mid.png' });
await freezeAt(1300);                       // 扫光进行中 + 下划线收尾
await sleep(120);
await (await page.$('.craft-note')).screenshot({ path: SHOT + 'craft-motion-sheen.png' });
await freezeAt(2816);                       // 终态
await sleep(120);
await (await page.$('.craft-note')).screenshot({ path: SHOT + 'craft-motion-done.png' });
const settled = await settle();
await sleep(250);
check('截帧用动画名齐全', ['craft-wipe','craft-glow','craft-icon-in','craft-sheen','craft-underline'].every((n) => names.includes(n)), names.join(','));

const after = await page.evaluate((EXPECT) => {
  const note = document.querySelector('.craft-note');
  const nr = note.getBoundingClientRect();
  return {
    topbarH: Math.round(document.querySelector('header.topbar').getBoundingClientRect().height),
    noteVisible: nr.width > 0 && nr.height > 0,
    text: document.querySelector('.craft-note-text').textContent.trim(),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clip: getComputedStyle(note).clipPath,
  };
}, EXPECT);
check('平移到终态后胶囊完整(无残留裁切)', /inset\(0px 0%/.test(after.clip) || after.clip === 'none', 'clip=' + after.clip);
check('动效结束后文案完整可读', after.text === EXPECT && after.noteVisible);
check('动效未改变顶栏高度(仍 53px)', after.topbarH === 53, 'h=' + after.topbarH);
check('动效结束无横向滚动', after.overflowX <= 0, 'overflowX=' + after.overflowX);

// 降级:系统「减少动态效果」应直接呈现终态
const page2 = await browser.newPage();
await page2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page2.setViewport({ width: 1700, height: 1000 });
await page2.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page2.waitForFunction(() => document.documentElement.classList.contains('craft-ready'), { timeout: 240000, polling: 100 });
await sleep(500);
const rm = await page2.evaluate((EXPECT) => {
  const note = document.querySelector('.craft-note');
  const em = document.querySelector('.craft-note em');
  const nr = note.getBoundingClientRect();
  return { clip: getComputedStyle(note).clipPath, emBg: getComputedStyle(em).backgroundSize, anim: getComputedStyle(note).animationName,
    visible: nr.width > 0 && nr.height > 0, text: document.querySelector('.craft-note-text').textContent.trim(), expects: EXPECT };
}, EXPECT);
check('减少动效:不裁切(无 clip-path)', rm.clip === 'none', rm.clip);
check('减少动效:下划线直接满宽', /100%\s+2px/.test(rm.emBg), rm.emBg);
check('减少动效:无入场动画', rm.anim === 'none', rm.anim);
check('减少动效:内容仍完整可见', rm.visible && rm.text === rm.expects);

await browser.close();
console.log(out.join('\n'));
console.log('\n采样首帧 :', JSON.stringify(startSample));
console.log('采样末帧 :', JSON.stringify(endSample));
console.log('光晕峰值 :', JSON.stringify(peakGlow), '| 扫光峰值:', maxSheen, '| settle 后 clip:', settled);
console.log(failures === 0 ? '\nALL PASS' : '\nFAILURES: ' + failures);
process.exit(failures === 0 ? 0 : 1);
