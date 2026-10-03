/* 制导导弹弹窗动画(animations/animation_7)的交互校验:
 * 侧栏区块显隐 / 文字可编辑 / 颜色可编辑 / 资源 404 / 画廊卡片与封面。
 * 用法(dev server 已在 5173 运行时):node tools/verify-missile-ui.mjs */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const KEY = 'missile';
const OUT = path.resolve(import.meta.dirname, '.missile-check');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, msg, extra) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + msg + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
  if (!ok) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1700, height: 1000 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  const bad404 = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) bad404.push(r.status() + ' ' + r.url().slice(-70)); });

  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300_000, polling: 200 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 120_000 });

  const total = await page.evaluate(() => document.querySelectorAll('#selAnim option').length);
  console.log('[1] 注册表里的动画数:' + total);

  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', KEY);
  await page.waitForFunction((k) => document.getElementById('selAnim').value === k
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180_000, polling: 200 }, KEY);
  await sleep(600);

  const info = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el ? (el.hidden ? 'hidden' : 'visible') : 'missing'; };
    return {
      sections: {
        timing: vis('timingSection'), theme: vis('themeSection'), image: vis('imageSection'),
        icon: vis('iconSection'), popup: vis('popupSection'), reward: vis('missionRewardSection'),
      },
      totalFrames: window.__anim.totalFrames,
      fr: window.__anim.frameRate,
      size: [window.__anim.animationData.w, window.__anim.animationData.h],
      textItems: [...document.querySelectorAll('#textList .t-name')].map((n) => n.textContent),
      textAreas: [...document.querySelectorAll('#textList .t-input')].map((t) => t.value),
      colorPickers: document.querySelectorAll('#textList .t-color').length,
      shapeItems: [...document.querySelectorAll('#shapeList li')].map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
      shapeColorPickers: document.querySelectorAll('#shapeList input[type=color]').length,
      assetOk: (window.__anim.animationData.assets || []).map((a) => [a.id, String(a.p).startsWith('data:') ? 'data-uri' : a.p.slice(-40), a.u]),
      renderer: document.getElementById('selRenderer').value,
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('[2] ' + JSON.stringify(info, null, 1));
  check(info.totalFrames === 161, '总帧数 = 161', info.totalFrames);
  check(info.fr === 60, '帧率 = 60', info.fr);
  check(info.size[0] === 1920 && info.size[1] === 1080, '画布 1920×1080', info.size);
  check(info.textItems.length === 2, '侧栏列出 2 个文字图层', info.textItems);
  check(info.colorPickers === 2, '两个文字层各有一个颜色选择器', info.colorPickers);
  /* 弹窗本体是形状层(底板 / 底框 / 虚线 / 蒙版效果 / 底线),它们的填充色在「形状图层」列表里可改;
   * 两个 td=1 的形状图层是轨道蒙版源(不渲染),按规则不列出。 */
  check(info.shapeItems.length === 9, '「形状图层」列出 9 层', info.shapeItems.length);
  check(info.shapeColorPickers >= 8, '形状层填充色有取色器(可改 HUD 颜色)', info.shapeColorPickers);
  check(info.sections.timing === 'hidden', '「动画时长」区块对这套动画隐藏(caps 为空)', info.sections.timing);
  check(info.sections.popup === 'hidden', '「弹窗叠加层」区块隐藏(这套动画没有独立弹窗)', info.sections.popup);
  check(info.assetOk.every((a) => a[1] !== 'images/167.png'), '位图资源已改写为打包地址', info.assetOk);

  // 画面不是空的:统计 SVG 里的可见内容 + 截图留档
  const draw = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    const root = document.querySelector('#previewInner svg');
    return {
      svg: !!root,
      nodes: root ? root.querySelectorAll('path,text,image,g').length : 0,
      textContent: root ? root.textContent.slice(0, 120) : '',
    };
  });
  await sleep(500);
  const stage = await page.$('#stage');
  await stage.screenshot({ path: path.join(OUT, 'frame-110.png') });
  console.log('[3] 渲染节点:' + JSON.stringify(draw));
  check(draw.nodes > 10, '第 110 帧有内容(SVG 节点数 > 10)', draw.nodes);

  // 改文字:两行都改成自定义文案,确认数据与渲染都跟着变
  const edited = await page.evaluate(async () => {
    const tas = [...document.querySelectorAll('#textList .t-input')];
    const before = tas.map((t) => t.value);
    tas[0].value = '导弹测试文案一';
    tas[0].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const tas2 = [...document.querySelectorAll('#textList .t-input')];
    tas2[1].value = '导弹测试文案二';
    tas2[1].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { before, now: [...document.querySelectorAll('#textList .t-input')].map((t) => t.value) };
  });
  await sleep(1500);
  const afterText = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    const root = document.querySelector('#previewInner svg');
    return { svgText: root ? root.textContent : '' };
  });
  await sleep(500);
  await stage.screenshot({ path: path.join(OUT, 'after-text-edit.png') });
  console.log('[4] 编辑前后的文字框:' + JSON.stringify({ ...edited, svgText: afterText.svgText.slice(0, 80) }));
  check(edited.now[0] === '导弹测试文案一' && edited.now[1] === '导弹测试文案二', '文字框接受了新文案', edited.now);
  check(afterText.svgText.includes('导弹测试文案一'), '渲染出的 SVG 里出现新文案', afterText.svgText.slice(0, 60));
  check(!afterText.svgText.includes('我军已发射制导导弹'), '旧文案已从画面消失', '');

  // 改颜色:第一个文字层的 fc 应当跟着取色器变化
  const colorRes = await page.evaluate(async () => {
    const ci = document.querySelector('#textList .t-color');
    const ind = Number(ci.dataset.ind);
    const before = JSON.stringify((() => {
      const walk = (ls) => { for (const l of ls || []) { if (l.ind === ind) return l; const f = walk(l.layers); if (f) return f; } return null; };
      const l = walk(window.__anim.animationData.layers);
      const td = l && l.t && l.t.d && l.t.d.k;
      const s = Array.isArray(td) ? td[0].s : td && td.s;
      return s && s.fc;
    })());
    ci.value = '#ff0000';
    ci.dispatchEvent(new Event('input', { bubbles: true }));
    ci.nextElementSibling.value = '#ff0000';
    ci.nextElementSibling.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { ind, before, hexAfter: ci.value };
  });
  await sleep(1500);
  const afterColor = await page.evaluate((ind) => {
    const walk = (ls) => { for (const l of ls || []) { if (l.ind === ind) return l; const f = walk(l.layers); if (f) return f; } return null; };
    const l = walk(window.__anim.animationData.layers);
    const td = l && l.t && l.t.d && l.t.d.k;
    const s = Array.isArray(td) ? td[0].s : td && td.s;
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    // 这套数据带字形表(chars),文字层默认渲染成 <path> 轮廓而不是 <text>,
    // 所以颜色要看 SVG 里所有元素的 fill(改成红色后应当出现 rgb(255,0,0))。
    const counts = {};
    for (const e of document.querySelectorAll('#previewInner svg [fill]')) {
      const v = e.getAttribute('fill');
      counts[v] = (counts[v] || 0) + 1;
    }
    return { fc: s && s.fc, fills: counts, hexInput: document.querySelector('#textList .hex-input')?.value };
  }, colorRes.ind);
  await sleep(500);
  await stage.screenshot({ path: path.join(OUT, 'after-color-edit.png') });
  console.log('[5] 颜色编辑:' + JSON.stringify({ ...colorRes, ...afterColor }));
  check(JSON.stringify(afterColor.fc) === '[1,0,0]', '图层 fc 变成纯红 [1,0,0]', afterColor.fc);
  check(!!afterColor.fills['rgb(255,0,0)'], '渲染出的画面里出现纯红填充', afterColor.fills);
  check(afterColor.hexInput === '#ff0000', 'HEX 输入框与取色器同步', afterColor.hexInput);

  // 画廊:新卡片在列、带专属封面
  await page.evaluate(() => document.getElementById('animTrigger').click());
  await sleep(800);
  const card = await page.evaluate((k) => {
    const el = document.querySelector('.ap-card[data-key="' + k + '"]');
    if (!el) return null;
    const img = el.querySelector('.ap-card-cover img');
    return { key: el.dataset.key, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90), img: img ? img.getAttribute('src') : null };
  }, KEY);
  console.log('[6] 画廊卡片:' + JSON.stringify(card));
  /* 封面地址在 dev 下是 /posters/missile.webp,构建产物里是 /assets/missile-<hash>.webp,两种都要认。 */
  check(!!card && /missile[^/]*\.webp$/.test(card.img || ''), '画廊里有卡片且使用 posters/missile.webp', card);
  await page.screenshot({ path: path.join(OUT, 'picker.png') });

  check(bad404.length === 0, '没有 4xx/5xx 请求', bad404.slice(0, 5));
  check(errors.length === 0, '没有页面异常', errors.slice(0, 3));
  console.log(failures ? '\n结果:' + failures + ' 项失败' : '\n结果:全部通过');
  console.log('截图目录:' + OUT);
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
