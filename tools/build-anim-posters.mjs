/*
 * 生成动画选择画廊的预览图(posters/<key>.webp)。
 *
 * 为什么要有这个脚本:画廊卡片要「一眼看清是哪套动画」,而动画数据包是几 MB 级的按需资源,
 * 不可能为了显示一张封面去下载它;所以预览图必须在开发期从真实渲染里截好、作为小图静态资源入库。
 *
 * 做法(全程真实渲染,不是合成图):
 *   1. 用 puppeteer 打开本地 dev server,从隐藏的兼容 select(#selAnim)读出全部动画 key
 *      —— 也就是说注册表里加一套动画,这里自动多出一张图,不需要改脚本;
 *   2. 逐个 page.select 切过去,等状态栏报「已载入」;
 *   3. 复位视图并切成「包含」适配,定位到该动画的展示帧(默认总帧数的 46%,
 *      可由 FRAME_RATIO 按 key 覆盖),goToAndStop 停帧;
 *   4. 截整个预览舞台,再回到页面里用 canvas 裁到画布范围并缩放到 640px 宽,导出 WebP。
 *      (裁剪在页面内用 canvas 做,免得为了裁图再引一个图像库)
 *
 * 用法:
 *   node tools/build-anim-posters.mjs           # dev server 没起就自己起一个,跑完关掉
 *   node tools/build-anim-posters.mjs --keep    # 复用已在 5173 端口运行的 dev server
 *   POSTER_KEYS=blast node tools/...            # 只重生成指定 key(新增动画时不必动其它封面)
 *
 * 输出:posters/<key>.webp(640×360 左右)。生成后重新构建站点即可在画廊里看到。
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'posters');
const OUT_WIDTH = 640;
const OUT_HEIGHT = 360; // 统一 16:9,与画廊卡片的封面比例一致
const KEEP_SERVER = process.argv.includes('--keep');

/* 展示帧:取总帧数的这个比例。默认 0.46 —— 通常这时入场动画已结束、内容还在画面里。
 * 若某套动画的 46% 正好停在淡出/空场景上,在这里按 key 覆盖即可。 */
const FRAME_RATIO = {
  extraction: 0.46,
  exposed: 0.62,
  blinds: 0.5,
  mission: 0.52,
  // 黑潮爆破默认弹窗:比例是相对**载入后的时间轴**算的 —— 该动画的默认时长是 4.3s(263 帧),
  // 画面在第 ~252 帧淡完,所以 0.45(≈ 第 118 帧)正好落在「HUD + 提示条 + 标题」都在的展示段。
  blast: 0.45,
  // 大战场弹窗动画:两行文字分别到第 48 / 72 帧才淡入完成、图标第 30~36 帧淡入、第 130~144 帧整体淡出
  // (时间轴 op=180,画面第 144 帧就淡完,后面是空尾),所以取 0.6(第 108 帧)落在全在的展示段。
  battlefield: 0.6,
  // 撤离点开启动画:文字与图标第 32~37 帧淡入、形状 20~25 帧淡入,整体在第 118~124 帧淡出,
  // 所以取 0.45(≈ 第 89 帧)落在「文字 + 图标 + 边框角标 + 黑底」全在的展示段。
  evacpoint: 0.45,
};

/* 需要在封面上**标出「这块能换」**的动画:给目标元素画一个高亮圈 + 一句说明,
 * 让用户在看画廊卡片时就一眼知道这套动画的哪个部位是可替换的。
 *   find: 在页面里定位该元素的函数(由 puppeteer 投到浏览器里执行,必须是自包含的),
 *         返回**相对 stage 的 CSS 矩形**;找不到返回 null(此时封面按老样子生成,不画标注)。
 *   label: 画在圆圈下方的说明文字(用系统字体,不走站点字体)。 */
const POSTER_HIGHLIGHT = {
  battlefield: {
    label: '图标可换',
    // 大战场弹窗动画的图标位:预览 SVG 里那条真正参与渲染的 <image>
    // (lottie 还会在 <defs> 里放一份无 width 的预加载 <image>,必须排除,否则量到的是 0×0)
    find: () => {
      const hit = [...document.querySelectorAll('#previewInner svg image')]
        .filter((im) => !im.closest('defs') && im.getAttribute('width'))
        .map((im) => ({ im, r: im.getBoundingClientRect() }))
        .filter((o) => o.r.width > 1 && o.r.height > 1)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
      return hit ? { x: hit.r.x, y: hit.r.y, width: hit.r.width, height: hit.r.height } : null;
    },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverAlive() {
  try {
    const res = await fetch(ORIGIN, { method: 'GET' });
    return res.ok;
  } catch { return false; }
}

let serverProc = null;
async function ensureServer() {
  if (await serverAlive()) {
    console.log('[posters] 复用已在运行的 dev server:' + ORIGIN);
    return;
  }
  console.log('[posters] 未检测到 dev server,启动一个(仅本次运行使用)…');
  serverProc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32', detached: false,
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(700);
    if (await serverAlive()) { console.log('[posters] dev server 已就绪'); return; }
  }
  throw new Error('dev server 启动超时');
}

/* 页面内:把 stage 截图处理成一张 16:9 的封面。
 * 步骤(全在浏览器里做,免得为了裁图再引一个图像库):
 *   ① 按 stage 截图与画布(previewInner)的几何关系裁出「画布区域」;
 *   ② 以当前背景色为基准扫描像素,求出画面内容的包围盒 —— HUD 动画的内容常常只占画面中间一小块,
 *      直接用整帧当封面的话,卡片上就只剩一片黑,什么都看不清;
 *   ③ 内容四周留约 9% 的边,再夹回画布内;
 *   ④ 等比缩放着放进 640×360,四周用背景色补齐 —— 所有封面统一 16:9,
 *      卡片网格用同一套 object-fit,宽画布动画(位置暴露 3840×1080)也不会被裁掉内容。
 *   找不到内容(纯色帧)时退回整帧,不会产出一张空图。 */
const POSTER_IN_PAGE = async (b64, stageRect, innerRect, bgHex, outWidth, outHeight, highlightRect, highlightLabel) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const k = img.naturalWidth / stageRect.width; // 截图像素 / CSS 像素
  const sx = Math.max(0, (innerRect.x - stageRect.x) * k);
  const sy = Math.max(0, (innerRect.y - stageRect.y) * k);
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, innerRect.width * k));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, innerRect.height * k));

  const src = document.createElement('canvas');
  src.width = Math.round(sw);
  src.height = Math.round(sh);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, src.width, src.height);

  const bg = [
    parseInt(bgHex.slice(1, 3), 16),
    parseInt(bgHex.slice(3, 5), 16),
    parseInt(bgHex.slice(5, 7), 16),
  ];
  /* 逐像素找包围盒会被「整幅的暗渐变 / 微弱辉光」带偏 —— 只要四角有一丁点差异,
   * 包围盒就等于整帧,裁了等于没裁。这里改成网格判定:
   *  ① 把画布缩到 64×36 的粗网格(drawImage 缩放本身就是像素平均,顺带降噪);
   *  ② 算出每格与背景色的差异,以「最亮那格」为基准取 25% 作阈值 —— 相对阈值天然免疫
   *     整幅的微弱底色,只圈出真正有内容的地方;
   *  ③ 网格包围盒按格子尺寸换算回画布像素。 */
  const GW = 64, GH = 36;
  const grid = document.createElement('canvas');
  grid.width = GW;
  grid.height = GH;
  const gctx = grid.getContext('2d', { willReadFrequently: true });
  gctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, GW, GH);
  const gp = gctx.getImageData(0, 0, GW, GH).data;
  const cell = new Float64Array(GW * GH);
  let maxCell = 0;
  for (let i = 0; i < GW * GH; i++) {
    const j = i * 4;
    const d = Math.abs(gp[j] - bg[0]) + Math.abs(gp[j + 1] - bg[1]) + Math.abs(gp[j + 2] - bg[2]);
    cell[i] = d;
    if (d > maxCell) maxCell = d;
  }
  const thr = Math.max(24, maxCell * 0.25);
  let gx0 = GW, gy0 = GH, gx1 = -1, gy1 = -1;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (cell[y * GW + x] >= thr) {
        if (x < gx0) gx0 = x;
        if (x > gx1) gx1 = x;
        if (y < gy0) gy0 = y;
        if (y > gy1) gy1 = y;
      }
    }
  }
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  if (gx1 >= gx0 && gy1 >= gy0) {
    const cw0 = src.width / GW, ch0 = src.height / GH;
    x0 = Math.floor(gx0 * cw0);
    y0 = Math.floor(gy0 * ch0);
    x1 = Math.min(src.width - 1, Math.ceil((gx1 + 1) * cw0) - 1);
    y1 = Math.min(src.height - 1, Math.ceil((gy1 + 1) * ch0) - 1);
  }

  let cx = 0, cy = 0, cw = src.width, ch = src.height;
  if (x1 >= x0 && y1 >= y0) {
    const padX = Math.max(10, Math.round((x1 - x0 + 1) * 0.09));
    const padY = Math.max(10, Math.round((y1 - y0 + 1) * 0.09));
    x0 = Math.max(0, x0 - padX);
    y0 = Math.max(0, y0 - padY);
    x1 = Math.min(src.width - 1, x1 + padX);
    y1 = Math.min(src.height - 1, y1 + padY);
    cx = x0; cy = y0; cw = x1 - x0 + 1; ch = y1 - y0 + 1;
  }

  const cv = document.createElement('canvas');
  cv.width = outWidth;
  cv.height = outHeight;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, outWidth, outHeight);
  const scale = Math.min(outWidth / cw, outHeight / ch);
  const dw = Math.max(1, Math.round(cw * scale));
  const dh = Math.max(1, Math.round(ch * scale));
  ctx.drawImage(src, cx, cy, cw, ch, Math.round((outWidth - dw) / 2), Math.round((outHeight - dh) / 2), dw, dh);

  /* ⑤ 高亮标注:告诉用户「这块能换」。把页面里的 CSS 矩形映射到最终封面的像素坐标:
   *   ① 相对 stage 的 CSS 坐标 → 截图像素(乘 k);② 减去画布裁剪原点(sx, sy)得到 src 画布内的坐标;
   *   ③ 再按「内容包围盒 → 封面」的缩放与居中偏移映射到输出画布。 */
  if (highlightRect && highlightLabel) {
    const hx = (highlightRect.x - stageRect.x) * k - sx;
    const hy = (highlightRect.y - stageRect.y) * k - sy;
    const hw = highlightRect.width * k;
    const hh = highlightRect.height * k;
    const ox = Math.round((outWidth - dw) / 2) + (hx - cx) * scale;
    const oy = Math.round((outHeight - dh) / 2) + (hy - cy) * scale;
    const ow = hw * scale;
    const oh = hh * scale;
    if (ow > 2 && oh > 2 && ox + ow > 0 && oy + oh > 0 && ox < outWidth && oy < outHeight) {
      const accent = '#ffd166';
      const ringCx = ox + ow / 2;
      const ringCy = oy + oh / 2;
      const ringR = Math.max(ow, oh) / 2 * 1.28 + 6;
      ctx.save();
      // 圈:双描边(外侧暗色描边让它在浅色内容上也看得清)
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      // 说明文字:半透明深色圆角底 + 强调色文字,放在圈的右下方(超出画面时自动换边)
      const fs = Math.max(13, Math.round(outHeight / 360 * 19));
      ctx.font = '600 ' + fs + 'px "Microsoft YaHei","Segoe UI",sans-serif';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(highlightLabel).width;
      const chipW = tw + fs * 1.3;
      const chipH = fs * 1.75;
      const gap = 7;
      let chipX = ringCx + ringR * 0.72;
      let chipY = ringCy + ringR * 0.72 + gap + chipH / 2;
      if (chipX + chipW > outWidth - 4) chipX = Math.max(4, outWidth - 4 - chipW);
      if (chipY + chipH / 2 > outHeight - 4) chipY = ringCy - ringR * 0.72 - gap - chipH / 2;
      chipY = Math.min(outHeight - 4 - chipH / 2, Math.max(4 + chipH / 2, chipY));
      const chipR = chipH / 2;
      ctx.beginPath();
      ctx.moveTo(chipX + chipR, chipY - chipH / 2);
      ctx.lineTo(chipX + chipW - chipR, chipY - chipH / 2);
      ctx.quadraticCurveTo(chipX + chipW, chipY - chipH / 2, chipX + chipW, chipY - chipH / 2 + chipR);
      ctx.lineTo(chipX + chipW, chipY + chipH / 2 - chipR);
      ctx.quadraticCurveTo(chipX + chipW, chipY + chipH / 2, chipX + chipW - chipR, chipY + chipH / 2);
      ctx.lineTo(chipX + chipR, chipY + chipH / 2);
      ctx.quadraticCurveTo(chipX, chipY + chipH / 2, chipX, chipY + chipH / 2 - chipR);
      ctx.lineTo(chipX, chipY - chipH / 2 + chipR);
      ctx.quadraticCurveTo(chipX, chipY - chipH / 2, chipX + chipR, chipY - chipH / 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(16,16,16,0.86)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillText(highlightLabel, chipX + fs * 0.65, chipY + 1);
      ctx.restore();
    }
  }
  return {
    dataUrl: cv.toDataURL('image/webp', 0.88),
    // 内容包围盒占画布的比例,用于判断「有没有真的裁紧」(0.25 表示内容只有画面 1/4 大)
    crop: Number(((cw / src.width) * (ch / src.height)).toFixed(3)),
  };
};

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('找不到 Chrome:' + CHROME + '(可用 CHROME_PATH 环境变量指定)');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await ensureServer();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=2', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  /* 记录主框架导航次数:dev server 的 HMR 会在文件变化时给页面发 full-reload,
   * 一旦在「切换动画 → 截图」之间发生重载,刚发出的切换就白做了(页面回到默认动画),
   * 后面的等待会一路超时。这里把重载当成可重试事件处理,而不是硬等 5 分钟。 */
  let navCount = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navCount++; });

  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300_000, polling: 200 });

  const allTargets = await page.evaluate(() =>
    [...document.querySelectorAll('#selAnim option')].map((o) => ({ key: o.value, label: o.textContent })));
  if (!allTargets.length) throw new Error('页面上没有读到任何动画(兼容 select #selAnim 为空)');
  /* POSTER_KEYS=key1,key2 时只生成这几张:新增一套动画只需补它自己的封面,
   * 不会顺手把其它封面按当前实现重新裁一遍(避免无关 diff)。 */
  const only = (process.env.POSTER_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const targets = only.length ? allTargets.filter((t) => only.includes(t.key)) : allTargets;
  if (!targets.length) throw new Error('POSTER_KEYS 没有匹配到任何动画:' + only.join(', '));
  console.log('[posters] 待生成 ' + targets.length + ' 张:' + targets.map((t) => t.key).join(', '));

  /* 等到「这套动画确实已经载入」为止。
   * 不能只看状态栏里有没有「已载入」—— 那是上一套动画留下的文案,新动画还在下载时就已经满足,
   * 结果会截到上一套动画的画面(第一版就踩了这个坑)。四个条件缺一不可:
   * ① 兼容 select 已切到目标 key;② 状态栏文案里出现这套动画的名字;
   * ③ 数据加载浮层已关闭;④ 页面里已有可用的 lottie 实例。
   * 自己轮询而不是 waitForFunction:超时的时候能把最后一次观测到的状态打出来,方便定位。 */
  async function waitForLoaded(key, label, navBase) {
    const deadline = Date.now() + 300_000;
    let last = '';
    for (;;) {
      if (navCount !== navBase) return null; // 页面被 HMR 重载:交给外层重来一次
      const st = await page.evaluate((k, lbl) => {
        const sel = document.getElementById('selAnim');
        const status = document.getElementById('statusbar')?.textContent || '';
        const a = window.__anim;
        return {
          ok: sel.value === k && status.indexOf(lbl) >= 0
            && document.getElementById('dataLoading').hidden
            && !!a && !!a.isLoaded && a.totalFrames > 1,
          sel: sel.value, status, max: document.getElementById('rngFrame').max,
          dlHidden: document.getElementById('dataLoading').hidden,
          anim: a ? a.totalFrames : null,
        };
      }, key, label);
      if (st.ok) return st;
      last = JSON.stringify(st);
      if (Date.now() > deadline) throw new Error('等待切换到「' + label + '」超时,最后一次观测:' + last);
      await sleep(300);
    }
  }

  const report = [];
  for (const { key, label } of targets) {
    let result = null;
    /* 最多试 3 次:页面在生成过程中被 HMR 重载时,当前这一张从头再来(其余已生成的图不受影响)。 */
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      const navBase = navCount;
      await page.select('#selAnim', key);
      const loaded = await waitForLoaded(key, label, navBase);
      if (!loaded) {
        console.warn('[posters] 页面在等待期间被重载(dev server HMR),重试「' + label + '」(第 ' + attempt + ' 次)');
        await sleep(2000);
        continue;
      }
      await sleep(700);

      // 复位视图 + 切成「包含」,保证画布完整落在舞台内部(裁剪时才不会缺边)
      await page.evaluate(() => {
        const fit = document.getElementById('selFit');
        fit.value = 'contain';
        fit.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btnResetView').click();
      });
      await sleep(250);

      const frame = await page.evaluate((ratio) => {
        // 用实例的 totalFrames 而不是时间轴上界:后者含「尾部多播的缓冲帧」,比例会偏一点
        const total = Math.round(window.__anim.totalFrames || Number(document.getElementById('rngFrame').max));
        const f = Math.max(0, Math.min(total - 1, Math.round(total * ratio)));
        window.__anim.goToAndStop(f, true); // 第二参数 true = 立即渲染,不等下一帧
        return { f, total };
      }, FRAME_RATIO[key] ?? 0.46);
      await sleep(320); // 让序列图层/滤镜随这一帧刷新

      const stage = await page.$('#stage');
      const stageRect = await stage.boundingBox();
      const innerRect = await page.evaluate(() => {
        const r = document.getElementById('previewInner').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const bgHex = await page.evaluate(() => document.getElementById('bgColor').value);
      /* 需要标注「这块能换」的动画:截图前先在页面里量出目标元素的矩形
       * (POSTER_HIGHLIGHT.find 是自包含函数,直接投进浏览器执行) */
      const hl = POSTER_HIGHLIGHT[key];
      const highlightRect = hl ? await page.evaluate(hl.find) : null;
      const shot = await page.screenshot({
        encoding: 'base64',
        clip: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
      });
      const poster = await page.evaluate(
        POSTER_IN_PAGE, shot, stageRect, innerRect, bgHex, OUT_WIDTH, OUT_HEIGHT,
        highlightRect, hl ? hl.label : null);
      if (navCount !== navBase) continue; // 截图期间被重载,这一张作废重来
      result = {
        key, label, frame: frame.f + '/' + frame.total, crop: poster.crop,
        highlighted: !!highlightRect,
        buf: Buffer.from(poster.dataUrl.split(',')[1], 'base64'),
      };
    }
    if (!result) throw new Error('生成「' + label + '」失败:页面反复被重载,请确认 dev server 上报的文件变化已停止');
    report.push(result);
    console.log('[posters] ' + key.padEnd(11) + label.padEnd(10) + ' 帧 ' + result.frame.padEnd(9) +
      ' 内容占画面 ' + (result.crop * 100).toFixed(1) + '%' +
      (result.highlighted ? ' + 高亮标注' : '') +
      ' → posters/' + key + '.webp (' + (result.buf.length / 1024).toFixed(1) + ' KB,待落盘)');
  }

  await browser.close();
  /* 落盘放在最后:dev server 还在运行时,往 posters/ 里写文件会被文件监听当成「项目变了」,
   * 给打开的页面发一次 full-reload。全部生成完再写,就不会打断生成过程。 */
  for (const r of report) fs.writeFileSync(path.join(OUT_DIR, r.key + '.webp'), r.buf);
  if (serverProc) { try { serverProc.kill(); } catch { /* ignore */ } }
  console.log('[posters] 完成,共 ' + report.length + ' 张,输出目录 ' + path.relative(ROOT, OUT_DIR));
}

main().catch((e) => {
  console.error('[posters] 失败:' + (e && e.stack ? e.stack : e));
  if (serverProc) { try { serverProc.kill(); } catch { /* ignore */ } }
  process.exit(1);
});
