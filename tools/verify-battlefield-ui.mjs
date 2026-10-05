/* 大战场弹窗动画(animations/animation_7)的交互校验:
 * 侧栏区块显隐 / 文字可编辑 / 文字与形状颜色 / 图标切换与不裁切 / 资源 404 / 画廊卡片与封面。
 * 用法(dev server 已在 5173 运行时):node tools/verify-battlefield-ui.mjs */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const KEY = 'battlefield';
const OUT = path.resolve(import.meta.dirname, '.battlefield-check');
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
      assetOk: (window.__anim.animationData.assets || []).map((a) => [a.id, String(a.p).startsWith('data:') ? 'data-uri' : a.p.slice(-40), a.u, a.pr || null]),
      renderer: document.getElementById('selRenderer').value,
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('[2] ' + JSON.stringify(info, null, 1));
  check(info.totalFrames === 180, '总帧数 = 180', info.totalFrames);
  check(info.fr === 60, '帧率 = 60', info.fr);
  check(info.size[0] === 1920 && info.size[1] === 1080, '画布 1920×1080', info.size);
  check(info.textItems.length === 2, '侧栏列出 2 个文字图层', info.textItems);
  /* 数据里的默认文字已改成占位文案「主标题 / 内容」,侧栏按 AE 叠放顺序列出(ind 3 内容在上、ind 4 主标题在下)。 */
  check(info.textItems.join(',') === '内容,主标题', '默认文字是占位文案「内容 / 主标题」', info.textItems);
  check(info.textAreas.join(',') === '内容,主标题', '文字框里就是新的默认文字', info.textAreas);
  check(info.colorPickers === 2, '两个文字层各有一个颜色选择器', info.colorPickers);
  /* 弹窗本体是形状层(底板 / 底框 / 虚线 / 蒙版效果 / 底线),它们的填充色在「形状图层」列表里可改;
   * 两个 td=1 的形状图层是轨道蒙版源(不渲染),按规则不列出。 */
  check(info.shapeItems.length === 9, '「形状图层」列出 9 层', info.shapeItems.length);
  check(info.shapeColorPickers >= 8, '形状层填充色有取色器(可改 HUD 颜色)', info.shapeColorPickers);
  check(info.sections.timing === 'hidden', '「动画时长」区块对这套动画隐藏(caps 为空)', info.sections.timing);
  check(info.sections.popup === 'hidden', '「弹窗叠加层」区块隐藏(这套动画没有独立弹窗)', info.sections.popup);
  check(info.assetOk.every((a) => a[1] !== 'images/167.png'), '位图资源已改写为打包地址', info.assetOk);
  /* 图标必须「等比完整显示」:lottie 默认的 xMidYMid slice 会按 91×92 画框裁切,
   * 非正方形的图标(27/38/flag)因此缺边,所以载入时给资源写了 pr。 */
  check(info.assetOk.every((a) => a[3] === 'xMidYMid meet'), '图标资源标记为 pr = xMidYMid meet(不裁切)', info.assetOk);

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

  /* ---- 图标切换(animations/animation_7/images/ 里的四张图标)---- */
  const iconPanel = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el ? (el.hidden ? 'hidden' : 'visible') : 'missing'; };
    return {
      section: vis('iconSection'),
      tabs: vis('iconScopeTabs'),
      toggleRow: vis('iconToggleRow'),
      opacityRow: vis('iconOpacityRow'),
      items: [...document.querySelectorAll('#iconList .icon-item')].map((li) => li.dataset.name),
      active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
    };
  });
  console.log('[3b] 图标选择面板:' + JSON.stringify(iconPanel));
  check(iconPanel.section === 'visible', '「图标选择」区块出现', iconPanel.section);
  check(iconPanel.items.length === 7, '列出 animation_7/images 里全部 7 张图标', iconPanel.items);
  check(iconPanel.items.join(',') === '27.png,38.png,155.png,167.png,car.png,clol.png,flag.png', '图标按名称自然序排列', iconPanel.items);
  check(iconPanel.active === '167.png', '默认选中数据里引用的 167.png', iconPanel.active);
  check(iconPanel.tabs === 'hidden' && iconPanel.toggleRow === 'hidden', '单图标位:不显示分段选项卡与「显示图标」开关', iconPanel);
  check(iconPanel.opacityRow === 'hidden', '「图标不透明度」行仍只属于任务弹窗动画', iconPanel.opacityRow);

  // 点 155.png:资源地址与画面里的 <image> 都要跟着换
  await page.evaluate(() => {
    [...document.querySelectorAll('#iconList .icon-item')].find((el) => el.dataset.name === '155.png')?.click();
  });
  await sleep(1500);
  const afterIcon = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    const imgs = [...document.querySelectorAll('#previewInner svg image')];
    return {
      active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
      assets: (window.__anim.animationData.assets || []).map((a) => [a.id, String(a.p).slice(-34), a.u, a.e, a.pr || null]),
      hrefs: imgs.map((i) => String(i.getAttribute('href') || i.getAttribute('xlink:href')).slice(-34)),
      pars: imgs.filter((i) => !i.closest('defs') && i.getAttribute('width')).map((i) => i.getAttribute('preserveAspectRatio')),
      status: document.getElementById('statusbar').textContent,
    };
  });
  await sleep(400);
  await stage.screenshot({ path: path.join(OUT, 'after-icon-switch.png') });
  const iconPanelEl = await page.$('#iconSection');
  if (iconPanelEl) await iconPanelEl.screenshot({ path: path.join(OUT, 'icon-panel.png') });
  console.log('[3c] 切到 155.png:' + JSON.stringify(afterIcon));
  /* 图标资源地址在 dev 下是 /animations/animation_7/images/155.png?no-inline,
     构建产物里是 /assets/155-<hash>.png,两种都要认。 */
  const isIconFile = (s, base) => new RegExp(base.replace(/\.png$/, '') + '(?:-[A-Za-z0-9_-]+)?\\.png').test(String(s));
  check(afterIcon.active === '155.png', '列表高亮切到 155.png', afterIcon.active);
  check(afterIcon.assets.some((a) => isIconFile(a[1], '155.png')), '资源地址改写成 155.png', afterIcon.assets);
  check(afterIcon.hrefs.some((h) => isIconFile(h, '155.png')), '画面里的 <image> 换成 155.png', afterIcon.hrefs);
  check(afterIcon.pars.length > 0 && afterIcon.pars.every((p) => p === 'xMidYMid meet'),
    '画面里 <image> 的 preserveAspectRatio 跟着资源走(meet)', afterIcon.pars);

  // 切走再切回:选择应当保留(iconBattlefieldName 跨动画切换保存)
  for (const k of ['mission', KEY]) {
    await page.evaluate(() => { window.__prevAnim = window.__anim; });
    await page.select('#selAnim', k);
    await page.waitForFunction((key) => document.getElementById('selAnim').value === key
      && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded,
      { timeout: 180_000, polling: 200 }, k);
    await sleep(700);
  }
  const back = await page.evaluate(() => ({
    active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
    assets: (window.__anim.animationData.assets || []).map((a) => String(a.p).slice(-34)),
  }));
  console.log('[3d] 切走再切回:' + JSON.stringify(back));
  check(back.active === '155.png' && back.assets.some((a) => isIconFile(a, '155.png')), '图标选择在切换动画后保留', back);

  // 上传自定义图标:同样应当生效(走的是同一条 setIconForScope 路径)
  const uploadInput = await page.$('#iconFile');
  await uploadInput.uploadFile(path.resolve(import.meta.dirname, 'craft-motion-done.png'));
  await sleep(1600);
  const afterUpload = await page.evaluate(() => {
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    return {
      items: [...document.querySelectorAll('#iconList .icon-item')].map((li) => li.dataset.name),
      active: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
      assets: (window.__anim.animationData.assets || []).map((a) => String(a.p).slice(0, 18)),
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('[3e] 上传自定义图标:' + JSON.stringify(afterUpload));
  check(afterUpload.items.length === 8 && afterUpload.active === 'craft-motion-done', '自定义图标进入列表并成为当前项', afterUpload);
  check(String(afterUpload.assets[0]).startsWith('data:image/'), '资源地址换成上传的 data URI', afterUpload.assets);

  /* ---- 同一张图标在 slice / meet 两种规则下的真实渲染对比 ----
   * 用**真实的图标文件** + 浏览器真实的 <image preserveAspectRatio> 规则光栅化,量出「可见内容」的宽高比:
   *   slice(站点原来的默认值)= 铺满 91×92 画框后居中裁切 → 可见内容宽高比被强行变成画框的 91:92,
   *       与图标本身的宽高比不符 ⇒ 边缘被切掉(非正方形图标就会「缺一块」,这正是选 27/38/flag 时的现象);
   *   meet(现在写进资源 pr 的值)= 等比缩放塞进画框 → 可见内容宽高比 == 图标本身宽高比,完整不裁切。
   * 注意:图标必须先取成 data URI 再嵌进 SVG —— 用 <img> 加载 SVG 时,外部 href 会被浏览器拦住不加载
   * (站点的 SVG 逐帧光栅化导出也是这么做的,见 main.ts 里收集 <image> 并内联那段)。 */
  const fit = await page.evaluate(async () => {
    const BOX = { w: 91, h: 92 };
    const SS = 4; // 超采样倍数:按 4 倍画框光栅化再折算,避免 1px 量化把长宽比算歪
    const SCALE = 3, PAD = 12, LABEL = 30;
    const items = [...document.querySelectorAll('#iconList .icon-item')]
      .map((li) => ({ name: li.dataset.name, url: li.querySelector('.icon-thumb')?.src || '' }))
      .filter((o) => o.url && !o.url.startsWith('data:'));
    const cellW = BOX.w * SCALE, cellH = BOX.h * SCALE;
    const cv = document.createElement('canvas');
    cv.width = PAD + cellW * 2 + PAD * 2;
    cv.height = LABEL + items.length * (cellH + LABEL + PAD) + PAD;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#141414';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.font = '600 15px "Segoe UI",sans-serif';
    cx.fillStyle = '#ff9a9a';
    cx.fillText('slice(默认:铺满后裁切)', PAD, LABEL - 10);
    cx.fillStyle = '#9affc0';
    cx.fillText('meet(现在:等比完整显示)', PAD * 2 + cellW, LABEL - 10);

    const toDataUrl = async (url) => {
      const b = await (await fetch(url)).blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); });
    };
    const load = (src) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('load fail'));
      i.src = src;
    });
    const measure = async (dataUrl, par) => {
      const bw = BOX.w * SS, bh = BOX.h * SS;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + bw + '" height="' + bh + '">'
        + '<image x="0" y="0" width="' + bw + '" height="' + bh + '" preserveAspectRatio="' + par + '" xlink:href="' + dataUrl + '" href="' + dataUrl + '"/></svg>';
      const raster = await load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
      const t = document.createElement('canvas');
      t.width = bw; t.height = bh;
      const tc = t.getContext('2d', { willReadFrequently: true });
      tc.drawImage(raster, 0, 0, bw, bh);
      const d = tc.getImageData(0, 0, bw, bh).data;
      let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (d[(y * bw + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      // 折算回 91×92 画框单位;长宽比直接用超采样后的像素算,精度更高
      const cw = (x1 - x0 + 1), ch = (y1 - y0 + 1);
      return { t, cw: +(cw / SS).toFixed(1), ch: +(ch / SS).toFixed(1), aspect: +(cw / ch).toFixed(3) };
    };

    const rows = [];
    let y = LABEL;
    for (const it of items) {
      const dataUrl = await toDataUrl(it.url);
      const src = await load(dataUrl);
      /* 基准长宽比必须取「非透明内容」的包围盒而不是文件尺寸:有些图标(car.png 119×119)自带透明留白,
       * 内容只有 110×114,拿文件长宽比当基准会误判成 meet 没等比。 */
      const srcCv = document.createElement('canvas');
      srcCv.width = src.naturalWidth; srcCv.height = src.naturalHeight;
      const sc = srcCv.getContext('2d', { willReadFrequently: true });
      sc.drawImage(src, 0, 0);
      const sd = sc.getImageData(0, 0, srcCv.width, srcCv.height).data;
      let sx0 = srcCv.width, sy0 = srcCv.height, sx1 = -1, sy1 = -1;
      for (let yy = 0; yy < srcCv.height; yy++) {
        for (let xx = 0; xx < srcCv.width; xx++) {
          if (sd[(yy * srcCv.width + xx) * 4 + 3] > 8) {
            if (xx < sx0) sx0 = xx;
            if (xx > sx1) sx1 = xx;
            if (yy < sy0) sy0 = yy;
            if (yy > sy1) sy1 = yy;
          }
        }
      }
      const srcAspect = +((sx1 - sx0 + 1) / (sy1 - sy0 + 1)).toFixed(3);
      const slice = await measure(dataUrl, 'xMidYMid slice');
      const meet = await measure(dataUrl, 'xMidYMid meet');
      cx.drawImage(slice.t, PAD, y, cellW, cellH);
      cx.drawImage(meet.t, PAD * 2 + cellW, y, cellW, cellH);
      cx.strokeStyle = '#666';
      cx.strokeRect(PAD + 0.5, y + 0.5, cellW - 1, cellH - 1);
      cx.strokeRect(PAD * 2 + cellW + 0.5, y + 0.5, cellW - 1, cellH - 1);
      rows.push({
        name: it.name, src: src.naturalWidth + 'x' + src.naturalHeight, srcAspect,
        slice: { w: slice.cw, h: slice.ch, aspect: slice.aspect },
        meet: { w: meet.cw, h: meet.ch, aspect: meet.aspect },
      });
      cx.font = '12px "Segoe UI",sans-serif';
      cx.fillStyle = '#ddd';
      cx.fillText(it.name + '  ' + src.naturalWidth + '×' + src.naturalHeight
        + '  内容长宽比 ' + srcAspect, PAD, y - 6);
      y += cellH + LABEL + PAD;
    }
    return { box: BOX, rows, png: cv.toDataURL('image/png') };
  });
  fs.writeFileSync(path.join(OUT, 'icon-fit-compare.png'), Buffer.from(fit.png.split(',')[1], 'base64'));
  console.log('[3f] 图标可见内容实测(画框 91×92,长宽比 ' + (fit.box.w / fit.box.h).toFixed(3) + '):');
  for (const r of fit.rows) {
    console.log('     ' + r.name.padEnd(10) + '源 ' + r.src.padEnd(8) + '比 ' + String(r.srcAspect).padEnd(6)
      + '| slice 可见 ' + (r.slice.w + '×' + r.slice.h).padEnd(8) + '比 ' + String(r.slice.aspect).padEnd(6)
      + '| meet 可见 ' + (r.meet.w + '×' + r.meet.h).padEnd(8) + '比 ' + r.meet.aspect);
  }
  const boxAspect = fit.box.w / fit.box.h;
  check(fit.rows.length >= 5, '实测覆盖全部内置图标', fit.rows.map((r) => r.name));
  check(fit.rows.every((r) => Math.abs(r.meet.aspect - r.srcAspect) < 0.02),
    'meet:可见内容长宽比 == 图标本身长宽比(等比、不裁切)', fit.rows.map((r) => [r.name, r.srcAspect, r.meet.aspect]));
  /* slice 的可见内容永远等于画框的长宽比 —— 对本来就非正方形的图标就是「被裁掉一条边」 */
  const nonSquare = fit.rows.filter((r) => Math.abs(r.srcAspect - boxAspect) > 0.05);
  check(nonSquare.length > 0 && nonSquare.every((r) => Math.abs(r.slice.aspect - boxAspect) < 0.02),
    'slice:非正方形图标被裁成画框长宽比(所以缺边)', nonSquare.map((r) => [r.name, r.srcAspect, r.slice.aspect]));

  // 换成 flag.png,把预览放大后给图标位拍一张特写(留档给人工比对)
  await page.evaluate(() => {
    [...document.querySelectorAll('#iconList .icon-item')].find((el) => el.dataset.name === 'flag.png')?.click();
  });
  await sleep(1600);
  const closeup = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pick = () => [...document.querySelectorAll('#previewInner svg image')]
      .filter((im) => !im.closest('defs') && im.getAttribute('width'))
      .map((im) => ({ im, r: im.getBoundingClientRect() }))
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    await sleep(300);
    const first = pick();
    if (!first) return null;
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    // 以图标中心为焦点滚轮放大(站点原生缩放,焦点不漂移),约 1.1^14 ≈ 3.8×
    const cxp = first.r.x + first.r.width / 2;
    const cyp = first.r.y + first.r.height / 2;
    for (let i = 0; i < 14; i++) {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: cxp, clientY: cyp, bubbles: true, cancelable: true }));
    }
    await sleep(400);
    window.__anim.pause();
    window.__anim.goToAndStop(110, true);
    await sleep(300);
    const before = { r: first.r, sr };
    const after = pick();
    return after ? { rect: { x: after.r.x, y: after.r.y, width: after.r.width, height: after.r.height }, before } : null;
  });
  if (closeup) {
    const pad = 30;
    await page.screenshot({
      path: path.join(OUT, 'icon-flag-closeup.png'),
      clip: {
        x: Math.max(0, closeup.rect.x - pad), y: Math.max(0, closeup.rect.y - pad),
        width: closeup.rect.width + pad * 2, height: closeup.rect.height + pad * 2,
      },
    });
    console.log('[3g] flag.png 特写:图标框 ' + Math.round(closeup.rect.width) + '×' + Math.round(closeup.rect.height) + ' CSS px(放大约 3.8×)');
    await page.evaluate(() => document.getElementById('btnResetView')?.click());
    await sleep(300);
  }

  /* ---- 预设(animations/animation_7/preset.txt)---- */
  const presetPanel = await page.evaluate(() => ({
    section: document.getElementById('presetSection').hidden ? 'hidden' : 'visible',
    count: document.getElementById('presetCount').textContent,
    hint: document.getElementById('presetHint').textContent,
    hintAccent: document.getElementById('presetHint').classList.contains('is-current'),
    collapsed: document.getElementById('presetBody').hidden,
    expandedAttr: document.getElementById('presetToggle').getAttribute('aria-expanded'),
    caretOpen: document.getElementById('presetToggle').classList.contains('is-open'),
    /* 标题行必须长成「可点控件」而不是灰标题:量一下它的实际盒子与边框 —— 高度 ≥ 24px、
     * 有非零圆角与可见边框色(实测反馈过一次「太不显眼,差点没找到」,这条防回归) */
    toggleBox: (() => {
      const b = document.getElementById('presetToggle');
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        h: Math.round(r.height), w: Math.round(r.width),
        radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, border: cs.borderTopColor,
        cursor: cs.cursor,
      };
    })(),
    items: [...document.querySelectorAll('#presetList .preset-item')].map((li) => ({
      name: li.querySelector('.preset-name')?.textContent ?? '',
      sample: (li.querySelector('.preset-sample')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasThumb: !!li.querySelector('.preset-thumb[src]'),
      active: li.classList.contains('is-active'),
    })),
  }));
  console.log('[3h] 预设面板(初始):' + JSON.stringify(presetPanel));
  check(presetPanel.section === 'visible', '「预设」区块出现', presetPanel.section);
  check(presetPanel.collapsed && presetPanel.expandedAttr === 'false' && !presetPanel.caretOpen,
    '预设列表默认收起(不铺开占地方)', {
      collapsed: presetPanel.collapsed, aria: presetPanel.expandedAttr, open: presetPanel.caretOpen,
    });
  /* 收起态也必须显眼:卡片式按钮(够高、有圆角与边框、手型光标) + 右侧状态提示 */
  check(presetPanel.toggleBox.h >= 24 && presetPanel.toggleBox.radius !== '0px' && presetPanel.toggleBox.cursor === 'pointer',
    '收起后的标题行是可点控件(有高度 / 圆角 / 手型光标),不是灰标题', presetPanel.toggleBox);
  check(presetPanel.hint === '点开选择', '未命中预设时提示「点开选择」', presetPanel.hint);
  check(presetPanel.items.length === 5, '收起状态下也已按 preset.txt 建好 5 条(点开即用)', presetPanel.items.map((i) => i.name));
  check(presetPanel.items.map((i) => i.name).join(',') === '区域烟幕,制导导弹,战略信标,空投载具,炮兵齐射',
    '预设名与 preset.txt 一致且保持文件顺序', presetPanel.items.map((i) => i.name));
  check(presetPanel.items.every((i) => i.hasThumb), '每条预设都带对应图标的缩略图', presetPanel.items.map((i) => i.hasThumb));
  check(presetPanel.items.every((i) => !i.active),
    '默认文案「主标题 / 内容」不等于任何预设,所以初始不高亮', presetPanel.items.map((i) => i.active));
  check(presetPanel.count === '· 5 个', '标题行显示条数', presetPanel.count);
  /* 收起态的样子也留一张图(人工确认「一眼能找到」) */
  const presetCollapsedEl = await page.$('#presetSection');
  if (presetCollapsedEl) await presetCollapsedEl.screenshot({ path: path.join(OUT, 'preset-collapsed.png') });

  // 点标题行展开
  const afterExpand = await page.evaluate(() => {
    document.getElementById('presetToggle').click();
    return {
      expanded: !document.getElementById('presetBody').hidden,
      attr: document.getElementById('presetToggle').getAttribute('aria-expanded'),
      caretOpen: document.getElementById('presetToggle').classList.contains('is-open'),
    };
  });
  await sleep(250);
  console.log('[3h2] 点标题行:' + JSON.stringify(afterExpand));
  check(afterExpand.expanded && afterExpand.attr === 'true' && afterExpand.caretOpen, '点标题行展开预设列表', afterExpand);
  const presetSectionEl = await page.$('#presetSection');
  if (presetSectionEl) await presetSectionEl.screenshot({ path: path.join(OUT, 'preset-panel.png') });

  // 套用第 1 条(区域烟幕:icon 27.png / title 我军已呼叫烟幕 / detail 利用烟幕掩护,迅速隐蔽行动)
  const afterPreset1 = await page.evaluate(async () => {
    document.querySelectorAll('#presetList .preset-item')[0].click();
    await new Promise((r) => setTimeout(r, 1800));
    return {
      texts: [...document.querySelectorAll('#textList .t-input')].map((t) => t.value),
      asset: (window.__anim.animationData.assets || []).map((a) => String(a.p).slice(-30)),
      activePreset: document.querySelector('#presetList .preset-item.is-active .preset-name')?.textContent ?? null,
      activeIcon: document.querySelector('#iconList .icon-item.is-active')?.dataset.name ?? null,
      hint: document.getElementById('presetHint').textContent,
      hintAccent: document.getElementById('presetHint').classList.contains('is-current'),
      status: document.getElementById('statusbar').textContent,
    };
  });
  console.log('[3i] 套用预设「区域烟幕」:' + JSON.stringify(afterPreset1));
  /* 侧栏顺序 = AE 叠放顺序:内容(ind 3)在前、主标题(ind 4)在后 */
  check(afterPreset1.texts.join(',') === '利用烟幕掩护,迅速隐蔽行动,我军已呼叫烟幕',
    '两行文字按预设写入(内容 / 主标题)', afterPreset1.texts);
  check(afterPreset1.asset.some((a) => isIconFile(a, '27.png')), '图标按预设换成 27.png', afterPreset1.asset);
  check(afterPreset1.activePreset === '区域烟幕', '预设列表高亮到这一条', afterPreset1.activePreset);
  check(afterPreset1.activeIcon === '27.png', '「图标选择」的选中态同步到预设的图标', afterPreset1.activeIcon);
  check(afterPreset1.hint === '当前:区域烟幕' && afterPreset1.hintAccent, '标题行提示当前命中的预设名(强调色)', afterPreset1);

  // 收起后标题行仍要能看到当前预设名
  const afterCollapse = await page.evaluate(async () => {
    document.getElementById('presetToggle').click();
    await new Promise((r) => setTimeout(r, 200));
    const collapsed = document.getElementById('presetBody').hidden;
    document.getElementById('presetToggle').click(); // 再展开,方便后面继续点列表
    return { collapsed, hint: document.getElementById('presetHint').textContent };
  });
  console.log('[3i2] 收起:' + JSON.stringify(afterCollapse));
  check(afterCollapse.collapsed && afterCollapse.hint === '当前:区域烟幕', '收起后标题行仍保留「当前:预设名」', afterCollapse);

  // 再套用第 4 条(空投载具:icon car.png / 文案完全不同)
  const afterPreset4 = await page.evaluate(async () => {
    document.querySelectorAll('#presetList .preset-item')[3].click();
    await new Promise((r) => setTimeout(r, 1800));
    return {
      texts: [...document.querySelectorAll('#textList .t-input')].map((t) => t.value),
      asset: (window.__anim.animationData.assets || []).map((a) => String(a.p).slice(-30)),
      activePreset: document.querySelector('#presetList .preset-item.is-active .preset-name')?.textContent ?? null,
    };
  });
  console.log('[3j] 套用预设「空投载具」:' + JSON.stringify(afterPreset4));
  check(afterPreset4.texts.join(',') === '利用载具,改变战局,空投载具就位', '换一条预设,文案跟着换', afterPreset4.texts);
  check(afterPreset4.asset.some((a) => isIconFile(a, 'car.png')), '图标换成 car.png', afterPreset4.asset);
  check(afterPreset4.activePreset === '空投载具', '高亮跟到新预设', afterPreset4.activePreset);

  // 手动改文字后,预设高亮应当自己消失(判定是「内容全对上」而不是记住点了哪条)
  const afterManual = await page.evaluate(async () => {
    const ta = document.querySelector('#textList .t-input');
    ta.value = '手改文案';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1800));
    return { active: document.querySelector('#presetList .preset-item.is-active')?.dataset.index ?? null };
  });
  console.log('[3k] 手动改字后:' + JSON.stringify(afterManual));
  check(afterManual.active === null || afterManual.active === undefined, '手动改过文字后预设不再高亮', afterManual.active);

  // 改文字:两行都改成自定义文案,确认数据与渲染都跟着变
  const edited = await page.evaluate(async () => {
    const tas = [...document.querySelectorAll('#textList .t-input')];
    const before = tas.map((t) => t.value);
    tas[0].value = '弹窗测试文案一';
    tas[0].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const tas2 = [...document.querySelectorAll('#textList .t-input')];
    tas2[1].value = '弹窗测试文案二';
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
  check(edited.now[0] === '弹窗测试文案一' && edited.now[1] === '弹窗测试文案二', '文字框接受了新文案', edited.now);
  check(afterText.svgText.includes('弹窗测试文案一'), '渲染出的 SVG 里出现新文案', afterText.svgText.slice(0, 60));
  check(!afterText.svgText.includes('主标题'), '原占位文案已从画面消失', '');

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
  /* 封面地址在 dev 下是 /posters/battlefield.webp,构建产物里是 /assets/battlefield-<hash>.webp,两种都要认。 */
  check(!!card && /battlefield[^/]*\.webp$/.test(card.img || ''), '画廊里有卡片且使用 posters/battlefield.webp', card);

  /* 封面必须**凸显出图标可以更换**:生成封面时给图标位画了高亮圈 + 「图标可换」标签
   * (tools/build-anim-posters.mjs 的 POSTER_HIGHLIGHT),这里直接数封面里强调色 #ffd166 的像素 ——
   * 与另一张没有标注的封面(黑潮爆破)对比,能确认不是靠内容里的巧合颜色蒙混过关。 */
  const posterInk = await page.evaluate(async (k) => {
    const count = async (url) => {
      if (!url) return null;
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let accent = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 255) < 46 && Math.abs(d[i + 1] - 209) < 46 && Math.abs(d[i + 2] - 102) < 56) accent++;
      }
      return { w: cv.width, h: cv.height, accent };
    };
    const mine = document.querySelector('.ap-card[data-key="' + k + '"] .ap-card-cover img');
    const other = document.querySelector('.ap-card[data-key="blast"] .ap-card-cover img');
    return {
      battlefield: await count(mine && mine.getAttribute('src')),
      blast: await count(other && other.getAttribute('src')),
    };
  }, KEY);
  console.log('[7] 封面强调色像素:' + JSON.stringify(posterInk));
  check(!!posterInk.battlefield && posterInk.battlefield.accent > 120,
    '封面上画出了高亮标注(强调色像素 > 120)', posterInk.battlefield);
  check(!posterInk.blast || posterInk.battlefield.accent > posterInk.blast.accent * 3,
    '高亮标注只出现在这张封面上(与黑潮爆破封面相比)', posterInk);
  await page.screenshot({ path: path.join(OUT, 'picker.png') });

  check(bad404.length === 0, '没有 4xx/5xx 请求', bad404.slice(0, 5));
  check(errors.length === 0, '没有页面异常', errors.slice(0, 3));
  console.log(failures ? '\n结果:' + failures + ' 项失败' : '\n结果:全部通过');
  console.log('截图目录:' + OUT);
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
