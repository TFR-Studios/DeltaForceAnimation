/* 撤离点开启动画(animations/animation_8)的交互校验:
 * 侧栏区块显隐 / 文字可编辑 / 文字颜色 / 形状与主题颜色 / 资源 404 / 画廊卡片与封面。
 * 用法(dev server 已在 5173 运行时):node tools/verify-evacpoint-ui.mjs
 * 也可用 DEV_ORIGIN=http://127.0.0.1:4173 指向 npm run preview 的构建产物。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const KEY = 'evacpoint';
const OUT = path.resolve(import.meta.dirname, '.evacpoint-check');
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
      colorPickers: document.querySelectorAll('#textList .t-color').length,
      shapeItems: [...document.querySelectorAll('#shapeList li')].map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
      shapeColorPickers: document.querySelectorAll('#shapeList input[type=color]').length,
      themeCount: document.getElementById('themeCount').textContent,
      themeFill: document.getElementById('themeFill').value,
      assetOk: (window.__anim.animationData.assets || []).map((a) => [a.id, String(a.p).slice(-40), a.u]),
      mattes: (window.__anim.animationData.layers || []).filter((l) => l.tt || l.td).map((l) => [l.ind, 'tt' + (l.tt ?? '-'), 'td' + (l.td ?? '-')]),
      renderer: document.getElementById('selRenderer').value,
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('[2] ' + JSON.stringify(info, null, 1));
  check(info.totalFrames === 197, '总帧数 = 197', info.totalFrames);
  check(info.fr === 60, '帧率 = 60', info.fr);
  check(info.size[0] === 1920 && info.size[1] === 1080, '画布 1920×1080', info.size);
  check(info.textItems.length === 1, '侧栏列出 1 个文字图层', info.textItems);
  check(info.textItems[0] === '紧急停堆撤离点已打开', '文字层名字就是那句状态文案', info.textItems[0]);
  check(info.colorPickers === 1, '文字层有颜色选择器', info.colorPickers);
  /* 可见形状层(排除 td=1 的轨道遮罩源:mask / mask 3 / mask 2)应当都列出来 */
  check(info.shapeItems.length === 6, '「形状图层」列出 6 层可见形状', info.shapeItems.length);
  check(info.shapeColorPickers >= 6, '形状层填充/描边有取色器', info.shapeColorPickers);
  check(info.sections.theme === 'hidden', '「主题颜色」区块隐藏(它只跟踪 #77b0f0 / #78c5f3 两族,本套是灰白)', info.sections.theme);
  check(info.sections.timing === 'hidden', '「动画时长」区块对这套动画隐藏(caps 为空)', info.sections.timing);
  check(info.sections.popup === 'hidden', '「弹窗叠加层」区块隐藏(这套动画没有独立弹窗)', info.sections.popup);
  check(info.assetOk.every((a) => !String(a[1]).endsWith('images/83.png')), '位图资源已改写为打包地址', info.assetOk);
  /* 轨道遮罩成对出现(3 个遮罩目标 tt=1/2 + 3 个遮罩源 td=1),数量相等时不需要 SVG 逐帧光栅化导出 */
  const tt = info.mattes.filter((m) => m[1] !== 'tt-').length;
  const td = info.mattes.filter((m) => m[2] !== 'td-').length;
  check(tt === 3 && td === 3, '轨道遮罩 3 目标 / 3 源,成对(不必强制 SVG 光栅化导出)', info.mattes);

  // 画面不是空的:第 89 帧(文字/图标/形状全在)统计 SVG 内容并截图留档
  const draw = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(89, true);
    const root = document.querySelector('#previewInner svg');
    return { svg: !!root, nodes: root ? root.querySelectorAll('path,text,image,g,rect').length : 0 };
  });
  await sleep(500);
  const stage = await page.$('#stage');
  await stage.screenshot({ path: path.join(OUT, 'frame-89.png') });
  console.log('[3] 渲染节点:' + JSON.stringify(draw));
  check(draw.nodes > 10, '第 89 帧有内容(SVG 节点数 > 10)', draw.nodes);

  // 改文字:确认数据与画面都跟着变
  const edited = await page.evaluate(async () => {
    const ta = document.querySelector('#textList .t-input');
    const before = ta.value;
    ta.value = '撤离点开启测试文案';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { before, now: document.querySelector('#textList .t-input').value };
  });
  await sleep(1500);
  const afterText = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(89, true);
    const root = document.querySelector('#previewInner svg');
    return { svgText: root ? root.textContent : '' };
  });
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'after-text-edit.png') });
  console.log('[4] 文字编辑:' + JSON.stringify({ ...edited, svgText: afterText.svgText.slice(0, 60) }));
  check(edited.now === '撤离点开启测试文案', '文字框接受了新文案', edited.now);
  check(afterText.svgText.includes('撤离点开启测试文案'), '渲染出的 SVG 里出现新文案', afterText.svgText.slice(0, 60));
  check(!afterText.svgText.includes('紧急停堆撤离点已打开'), '旧文案已从画面消失', '');

  // 改文字颜色:fc 与画面填充都要跟着变
  const colorRes = await page.evaluate(async () => {
    const ci = document.querySelector('#textList .t-color');
    const ind = Number(ci.dataset.ind);
    ci.value = '#ff0000';
    ci.dispatchEvent(new Event('input', { bubbles: true }));
    ci.nextElementSibling.value = '#ff0000';
    ci.nextElementSibling.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { ind };
  });
  await sleep(1500);
  const afterColor = await page.evaluate((ind) => {
    const walk = (ls) => { for (const l of ls || []) { if (l.ind === ind) return l; const f = walk(l.layers); if (f) return f; } return null; };
    const l = walk(window.__anim.animationData.layers);
    const td = l && l.t && l.t.d && l.t.d.k;
    const s = Array.isArray(td) ? td[0].s : td && td.s;
    window.__anim.pause();
    window.__anim.goToAndStop(89, true);
    const counts = {};
    for (const e of document.querySelectorAll('#previewInner svg [fill]')) {
      const v = e.getAttribute('fill');
      counts[v] = (counts[v] || 0) + 1;
    }
    return { fc: s && s.fc, fills: counts, hexInput: document.querySelector('#textList .hex-input')?.value };
  }, colorRes.ind);
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'after-color-edit.png') });
  console.log('[5] 文字颜色:' + JSON.stringify(afterColor));
  check(JSON.stringify(afterColor.fc) === '[1,0,0]', '图层 fc 变成纯红 [1,0,0]', afterColor.fc);
  check(!!afterColor.fills['rgb(255,0,0)'], '渲染出的画面里出现纯红填充', afterColor.fills);
  check(afterColor.hexInput === '#ff0000', 'HEX 输入框与取色器同步', afterColor.hexInput);

  // 改形状层的填充色(边框/角标一族):数据与画面都要跟着变
  const shapeRes = await page.evaluate(async () => {
    const ci = document.querySelector('#shapeList .s-fill');
    const ind = Number(ci.dataset.ind);
    const before = ci.value;
    ci.value = '#00ff88';
    ci.dispatchEvent(new Event('input', { bubbles: true }));
    ci.nextElementSibling.value = '#00ff88';
    ci.nextElementSibling.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { ind, before };
  });
  await sleep(1500);
  const afterShape = await page.evaluate((ind) => {
    // 该形状层里所有静态填充色里,应当有一个变成 #00ff88
    const walk = (ls) => { for (const l of ls || []) { if (l.ind === ind) return l; const f = walk(l.layers); if (f) return f; } return null; };
    const l = walk(window.__anim.animationData.layers);
    const found = [];
    const chk = (items) => {
      for (const it of items || []) {
        if (it.ty === 'fl' && it.c && it.c.a === 0) found.push(it.c.k.slice(0, 3).map((v) => Math.round(v * 255)).join(','));
        if (it.it) chk(it.it);
      }
    };
    chk(l && l.shapes);
    window.__anim.pause();
    window.__anim.goToAndStop(89, true);
    const fills = {};
    for (const e of document.querySelectorAll('#previewInner svg [fill]')) {
      const v = e.getAttribute('fill');
      fills[v] = (fills[v] || 0) + 1;
    }
    return { shapeFills: found, svgFills: fills };
  }, shapeRes.ind);
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'after-shape-color.png') });
  console.log('[6] 形状颜色:' + JSON.stringify({ ...shapeRes, ...afterShape }));
  check(afterShape.shapeFills.includes('0,255,136'), '形状层填充变成 #00ff88', afterShape.shapeFills);
  check(!!afterShape.svgFills['rgb(0,255,136)'], '画面里出现 #00ff88 填充', afterShape.svgFills);

  // 图标选择:内置 8 张(animations/animation_8/images/*.png),默认选中数据里引用的 83.png;
  // 单图标位形态 —— 没有分段选项卡 /「显示图标」/「图标不透明度」
  const iconUi = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el ? (el.hidden ? 'hidden' : 'visible') : 'missing'; };
    return {
      section: vis('iconSection'), tabs: vis('iconScopeTabs'), toggle: vis('iconToggleRow'),
      opacity: vis('iconOpacityRow'), nudge: vis('iconNudgeRow'),
      hint: vis('iconScopeHint'),
      count: document.getElementById('iconCount').textContent,
      items: [...document.querySelectorAll('#iconList .icon-item')].map((li) => li.dataset.name),
      active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
      thumbsOk: [...document.querySelectorAll('#iconList .icon-thumb')].every((im) => !!im.getAttribute('src')),
      layerName: (window.__anim.animationData.layers || []).find((l) => l.ty === 2)?.nm,
      pr: (window.__anim.animationData.assets || []).find((a) => a.id === 'image_0')?.pr,
    };
  });
  console.log('[8] 图标选择:' + JSON.stringify(iconUi));
  check(iconUi.section === 'visible', '「图标选择」区块对撤离点开启动画显示', iconUi.section);
  check(iconUi.items.length === 8, '内置图标列表 = 8 张(animations/animation_8/images/*.png)', iconUi.items);
  check(iconUi.items.includes('83.png') && iconUi.items.includes('106.png'), '列表含 83.png / 106.png', iconUi.items);
  check(iconUi.active === '83.png', '默认选中数据里引用的 83.png', iconUi.active);
  check(iconUi.thumbsOk, '每张候选都有缩略图', iconUi.thumbsOk);
  check(iconUi.tabs === 'hidden' && iconUi.toggle === 'hidden' && iconUi.nudge === 'hidden',
    '单图标位形态:分段选项卡 /「显示图标」/ 居中微调都隐藏', [iconUi.tabs, iconUi.toggle, iconUi.nudge]);
  check(iconUi.opacity === 'hidden' && iconUi.hint === 'hidden',
    '「图标不透明度」(仅任务弹窗)与二次扫描提示隐藏', [iconUi.opacity, iconUi.hint]);
  check(iconUi.pr === 'xMidYMid meet', '图标资源带 pr=xMidYMid meet(非正方图标不被裁切)', iconUi.pr);

  // 换图标:点 106.png → 数据资源地址与画面 <image> 都要跟着换,且选中态转移
  const iconClicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#iconList .icon-item')].find((li) => li.dataset.name === '106.png');
    if (!el) return false;
    el.click();
    return true;
  });
  check(iconClicked, '列表里点得到 106.png', iconClicked);
  await page.waitForFunction(() => {
    const img = document.querySelector('#previewInner svg image');
    const href = img && (img.getAttribute('href') || img.getAttribute('xlink:href') || '');
    return !!href && href.includes('106.png');
  }, { timeout: 30_000, polling: 100 });
  await sleep(600);
  const afterIcon = await page.evaluate(() => {
    const a = (window.__anim.animationData.assets || []).find((x) => x.id === 'image_0');
    window.__anim.pause();
    window.__anim.goToAndStop(89, true);
    const imgs = [...document.querySelectorAll('#previewInner svg image')];
    return {
      p: String(a.p), pr: a.pr,
      href: imgs.map((i) => String(i.getAttribute('href') || i.getAttribute('xlink:href')))[0] ?? '',
      /* 真正参与渲染的 <image>(defs 里的不用管)*/
      pars: imgs.filter((i) => !i.closest('defs') && i.getAttribute('width')).map((i) => i.getAttribute('preserveAspectRatio')),
      active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
    };
  });
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'after-icon-106.png') });
  console.log('[9] 换图标:' + JSON.stringify(afterIcon));
  check(afterIcon.p.includes('106.png'), '数据里的图标资源地址换成 106.png', afterIcon.p);
  check(afterIcon.href.includes('106.png'), '画面里的图标换成了 106.png', afterIcon.href);
  check(afterIcon.pars.length > 0 && afterIcon.pars.every((p) => p === 'xMidYMid meet'),
    '画面里 <image> 的 preserveAspectRatio = xMidYMid meet(非正方图标不裁切)', afterIcon.pars);
  check(afterIcon.active === '106.png', '选中态转移到 106.png', afterIcon.active);

  // 切走再切回:选择要保留(记在模块状态里,不随动画数据重建被冲掉)
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'extraction');
  await sleep(800);
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', KEY);
  await page.waitForFunction((k) => document.getElementById('selAnim').value === k
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180_000, polling: 200 }, KEY);
  await sleep(800);
  const kept = await page.evaluate(() => ({
    active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
    p: String((window.__anim.animationData.assets || []).find((x) => x.id === 'image_0')?.p),
  }));
  console.log('[10] 切换动画后保留:' + JSON.stringify(kept));
  check(kept.active === '106.png', '切走再切回仍选中 106.png', kept.active);
  check(kept.p.includes('106.png'), '切走再切回,数据资源仍是 106.png', kept.p);

  // 上传自定义图标:走的是同一条 setIconForScope 路径,状态栏要点名「撤离点开启动画」。
  // 那条提示会被随后的重建冲成「已载入: …」,所以先挂一个 MutationObserver 把状态栏历史记下来。
  await page.evaluate(() => {
    window.__statusLog = [];
    const el = document.getElementById('statusbar');
    new MutationObserver(() => window.__statusLog.push(el.textContent)).observe(el, { childList: true, subtree: true, characterData: true });
  });
  const uploadInput = await page.$('#iconFile');
  await uploadInput.uploadFile(path.resolve(import.meta.dirname, 'craft-motion-done.png'));
  await sleep(1800);
  const afterUpload = await page.evaluate(() => ({
    items: [...document.querySelectorAll('#iconList .icon-item')].map((li) => li.dataset.name),
    active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
    p: String((window.__anim.animationData.assets || []).find((x) => x.id === 'image_0')?.p).slice(0, 18),
    statusLog: window.__statusLog || [],
  }));
  await stage.screenshot({ path: path.join(OUT, 'after-icon-upload.png') });
  console.log('[11] 上传自定义图标:' + JSON.stringify(afterUpload));
  check(afterUpload.items.length === 9 && afterUpload.active === 'craft-motion-done',
    '自定义图标进入列表并成为当前项', afterUpload.items);
  check(afterUpload.p.startsWith('data:image/'), '图标资源地址换成上传的 data URI', afterUpload.p);
  check(afterUpload.statusLog.some((s) => s.includes('自定义图标') && s.includes('撤离点开启动画')),
    '状态栏点名应用到「撤离点开启动画」', afterUpload.statusLog.slice(0, 3));

  // 画廊:新卡片在列、带专属封面
  await page.evaluate(() => document.getElementById('animTrigger').click());
  await sleep(800);
  const card = await page.evaluate((k) => {
    const el = document.querySelector('.ap-card[data-key="' + k + '"]');
    if (!el) return null;
    const img = el.querySelector('.ap-card-cover img');
    return { key: el.dataset.key, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100), img: img ? img.getAttribute('src') : null };
  }, KEY);
  console.log('[7] 画廊卡片:' + JSON.stringify(card));
  check(!!card && /evacpoint[^/]*\.webp$/.test(card.img || ''), '画廊里有卡片且使用 posters/evacpoint.webp', card);
  check(!!card && card.text.includes('图标可换'), '卡片特性标签含「图标可换」', card?.text);
  await page.screenshot({ path: path.join(OUT, 'picker.png') });

  check(bad404.length === 0, '没有 4xx/5xx 请求', bad404.slice(0, 5));
  check(errors.length === 0, '没有页面异常', errors.slice(0, 3));
  console.log(failures ? '\n结果:' + failures + ' 项失败' : '\n结果:全部通过');
  console.log('截图目录:' + OUT);
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
