/* 二次扫描段:文字自适应宽度时,「光.png」位移关键帧必须跟着底框一起缩放
 * (它是绝对层,不在 空 2 组里),否则光带只扫到加宽前的位置。
 * 验证:
 *   1) 加长文字后底框按 k 加宽(绕自身中心),光.png 的 X 关键帧按同一仿射变换变换;
 *   2) 光带在底框内的相对位置保持不变;
 *   3) 文字还原后光.png 关键帧回到基准值;
 *   4) 一次扫描段不含光.png,不受影响。 */
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; out.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  → ' + extra : '')); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1700, height: 1000 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.select('#selAnim', 'exposed');
await page.waitForFunction(() => !!document.querySelector('#iconSection') && !document.querySelector('#iconSection').hidden && !!window.__anim, { timeout: 180000, polling: 500 });
await sleep(2200);
await page.click('#chkNextScan');
await sleep(4500);

const sample = (frame) => page.evaluate((f) => {
  window.__anim.goToAndStop(f, true);
  const els = window.__anim.renderer.elements.filter(Boolean);
  const findByNm = (nm) => els.find((e) => e.data && e.data.nm === nm);
  const boxOf = (el) => {
    const node = el && (el.baseElement || el.layerElement);
    if (!node || !node.getBBox) return null;
    let bb; try { bb = node.getBBox(); } catch { return null; }
    const m = node.getCTM();
    if (!m || (!bb.width && !bb.height)) return null;
    const xs = [];
    for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]])
      xs.push(m.a * x + m.c * y + m.e);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    return { x0: +x0.toFixed(1), x1: +x1.toFixed(1), w: +(x1 - x0).toFixed(1), cx: +((x0 + x1) / 2).toFixed(1) };
  };
  const lightLayer = window.__anim.animationData.layers.find((l) => l.nm === '光.png');
  return {
    plate: boxOf(findByNm('底框 可见')),
    light: boxOf(findByNm('光.png')),
    lightKeys: lightLayer ? lightLayer.ks.p.k.map((k) => (k.s ? +k.s[0].toFixed(2) : null)) : null,
    hasLightInMain: window.__anim.animationData.layers.some((l, i) => l.nm === '光.png' && l.ind < 100),
  };
}, frame);

const mainOp = await page.evaluate(() => window.__anim.animationData.__mainOp);
const F = mainOp + 60; // 光带扫过底框的时段
const before = await sample(F);
check('数据里存在 光.png 且带位移关键帧', !!before.lightKeys && before.lightKeys.length >= 2, JSON.stringify(before.lightKeys));
check('一次扫描段不含 光.png', before.hasLightInMain === false);

// 加长文字:8 字 → 12 字
await page.evaluate(() => {
  const ta = document.querySelector('#textList .t-input[data-ind="104"]');
  ta.value = '即将扫描移动单位区域';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(4000);
const after = await sample(F);

const k = after.plate.w / before.plate.w;
const pivot = before.plate.cx; // 底框中心 = 底框缩放枢轴(实测两者一致)
check('底框按文字增量加宽', k > 1.05, 'k=' + k.toFixed(4) + ' ' + before.plate.w + '→' + after.plate.w);
check('底框中心(枢轴)不变', Math.abs(after.plate.cx - before.plate.cx) < 1, before.plate.cx + '→' + after.plate.cx);
const expect = before.lightKeys.map((v) => +(pivot + (v - pivot) * k).toFixed(2));
const got = after.lightKeys;
check('光.png 位移关键帧按同一仿射变换跟进', got.every((v, i) => Math.abs(v - expect[i]) < 2),
  JSON.stringify({ expect, got }));
check('光.png 关键帧确实变了(不再停在原位)', got.some((v, i) => Math.abs(v - before.lightKeys[i]) > 5),
  JSON.stringify(before.lightKeys) + ' → ' + JSON.stringify(got));
const relBefore = (before.light.cx - before.plate.x0) / before.plate.w;
const relAfter = (after.light.cx - after.plate.x0) / after.plate.w;
check('光带在底框内的相对位置保持', Math.abs(relAfter - relBefore) < 0.01,
  relBefore.toFixed(4) + ' → ' + relAfter.toFixed(4));

// 还原文字:关键帧应回到基准
await page.evaluate(() => document.querySelector('#textList .t-reset[data-ind="104"]').click());
await sleep(4000);
const reset = await sample(F);
check('文字还原后光.png 关键帧回到基准值',
  reset.lightKeys.every((v, i) => Math.abs(v - before.lightKeys[i]) < 0.5),
  JSON.stringify(reset.lightKeys));
check('文字还原后底框宽度回到基准', Math.abs(reset.plate.w - before.plate.w) < 1, String(reset.plate.w));
check('无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(out.join('\n'));
console.log('\nFAILURES: ' + failures);
await browser.close();
process.exit(failures ? 1 : 0);
