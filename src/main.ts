import lottie, { type AnimationItem } from 'lottie-web';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import './style.css';

/* ---------- 音频工厂 ----------
 * lottie-web 默认依赖 window.Howl(howler.js);没有 Howl 时它会返回一个缺 pause/volume
 * 方法的桩对象,一旦动画 pause/stop 就会抛 "this.audio.pause is not a function"。
 * 这里注入基于原生 HTMLAudioElement 的工厂:既修掉崩溃,又能真正播放 JSON 内嵌的音频。
 */
const audioFactory = (assetPath: string) => {
  const el = new Audio();
  el.src = assetPath;
  el.preload = 'auto';
  const setVolume = (v?: number) => { if (v !== undefined) el.volume = v; };
  return {
    play: () => { el.play().catch(() => { /* 浏览器自动播放策略拦截时忽略 */ }); },
    pause: () => { el.pause(); },
    seek: (t?: number) => { if (t !== undefined) el.currentTime = t; return el.currentTime; },
    playing: () => !el.paused && !el.ended,
    rate: (r?: number) => { if (r !== undefined) el.playbackRate = r; },
    volume: setVolume, // 运行时实际调用
    setVolume, // 类型声明要求
  };
};

/* ---------- 字体预加载 ----------
 * Bodymovin 可将 TTF 字体文件以 base64 内嵌在 fonts.list[].fPath 中。
 * 通过 FontFace API 注册到浏览器,使 SVG/Canvas 都能用真实字体渲染文字。
 */
const loadedFontFamilies = new Set<string>();

async function loadEmbeddedFonts(data: any) {
  const list: any[] = data?.fonts?.list ?? [];
  const jobs = list.map(async (f: any) => {
    if (typeof f.fPath !== 'string' || !f.fPath.length) return;
    const families: string[] = [];
    if (f.fFamily) families.push(f.fFamily);
    if (f.fName && !families.includes(f.fName)) families.push(f.fName);
    for (const fam of families) {
      if (loadedFontFamilies.has(fam)) continue;
      try {
        if (document.fonts.check('16px "' + fam + '"')) {
          loadedFontFamilies.add(fam);
          continue;
        }
        const ff = new FontFace(fam, 'url("' + f.fPath + '")');
        await ff.load();
        document.fonts.add(ff);
        loadedFontFamilies.add(fam);
      } catch { /* 字体加载失败时回退系统字体 */ }
    }
  });
  await Promise.allSettled(jobs);
}

/* ---------- Canvas 渲染器文字兜底 ----------
 * lottie-web 的 Canvas 文字渲染依赖字体轮廓数据(chars);本动画的 JSON 只内嵌了
 * TTF 字体文件(fPath)而没有 chars,导致 Font.getCharData 抛异常、整帧绘制被中断
 * (画布空白)。这里把 Canvas 文字元素的 renderInnerContent 换成原生 fillText 绘制:
 * 保留 lottie 的逐字母动画(位置/透明度/颜色/描边),字形交给浏览器文本引擎。
 * 通过包装 buildItem 递归覆盖预合成内部的文字层。
 */
function patchCanvasTextElement(el: any) {
  const buildRgba = (c: number[] | undefined): string =>
    !c ? 'rgba(0,0,0,0)' : 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';

  el.renderInnerContent = function (this: any) {
    const ctx = this.canvasContext;
    const renderer = this.globalData.renderer;
    const cd = renderer.contextData;
    const doc = this.textProperty.currentData;
    const hasFill = !!doc.fc;
    const hasStroke = !!doc.sc;
    const fontData = this.globalData.fontManager.getFontByName(doc.f);
    const family = (fontData && fontData.fFamily) || doc.f || 'sans-serif';

    // 与原实现一致的描边端帽/拐角状态(同步到原生 ctx,代理状态一并更新)
    renderer.ctxLineCap('butt');
    renderer.ctxLineJoin('miter');
    renderer.ctxMiterLimit(4);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    if (cd) {
      cd.appliedLineCap = 'butt';
      cd.appliedLineJoin = 'miter';
      cd.appliedMiterLimit = 4;
    }
    ctx.font = doc.finalSize + 'px ' + family;

    const letters = Array.isArray(doc.l) ? doc.l : null;
    const renderedLetters = letters
      ? ((!this.data.singleShape && this.textAnimator.getMeasures(doc, this.lettersChangedFlag)),
        this.textAnimator.renderedLetters || [])
      : [];
    const canPerLetter = !!(letters && renderedLetters.length > 0);
    if (canPerLetter) {
      // 逐字母绘制:复用 lottie 文字动画器的逐字母矩阵/透明度/颜色。
      // 注意:字形数据缺失时 lottie 计算的逐字母 advance(letters[i].l)为 0,
      // renderedLetters 的 x 偏移只剩 tracking,导致字形全部重叠。
      // 这里用真实字体的 measureText 重算每字母位置,修正 rl.p 的 tx;
      // 修正量 = 正确布局 - lottie 的(错误)布局,因此动画器偏移得以保留。
      const tracking = (doc.tr || 0) * 0.001 * doc.finalSize;
      const widths: number[] = new Array(letters.length).fill(0);
      const lineW: Record<number, number> = {};
      const lineWBroken: Record<number, number> = {};
      for (let i = 0; i < letters.length; i++) {
        if (letters[i].n) continue;
        const ch = doc.finalText ? doc.finalText[i] : undefined;
        if (ch === undefined) continue;
        const w = ctx.measureText(ch).width;
        widths[i] = w;
        const ln = letters[i].line;
        lineW[ln] = (lineW[ln] || 0) + w + tracking;
        lineWBroken[ln] = (lineWBroken[ln] || 0) + tracking;
      }
      const justifyX = (ln: number) => (doc.j === 1 ? -lineW[ln] : doc.j === 2 ? -lineW[ln] / 2 : 0);
      const justifyXBroken = (ln: number) => (doc.j === 1 ? -lineWBroken[ln] : doc.j === 2 ? -lineWBroken[ln] / 2 : 0);

      let lastFill: string | null = null;
      let lastStroke: string | null = null;
      let lastStrokeW: number | null = null;
      let xPos = 0;
      let xPosBroken = 0;
      for (let i = 0; i < letters.length; i++) {
        if (letters[i].n) {
          xPos = 0;
          xPosBroken = 0;
          continue; // 换行标记
        }
        const ch = doc.finalText ? doc.finalText[i] : undefined;
        if (ch === undefined) continue;
        const rl = renderedLetters[i];
        if (!rl) continue;
        const ln = letters[i].line;
        const dx = xPos + justifyX(ln) - (xPosBroken + justifyXBroken(ln));
        renderer.save();
        const p = Array.from(rl.p || []);
        p[12] = ((rl.p && rl.p[12]) || 0) + dx;
        renderer.ctxTransform(p);
        renderer.ctxOpacity(rl.o);
        if (hasFill) {
          const fc = rl.fc || buildRgba(doc.fc);
          if (lastFill !== fc) {
            lastFill = fc;
            renderer.ctxFillStyle(fc);
            ctx.fillStyle = fc;
            if (cd) cd.appliedFillStyle = fc;
          }
          ctx.fillText(ch, 0, 0);
        }
        if (hasStroke) {
          const sc = rl.sc || buildRgba(doc.sc);
          const sw = rl.sw || doc.sw || 1;
          if (lastStroke !== sc) {
            lastStroke = sc;
            renderer.ctxStrokeStyle(sc);
            ctx.strokeStyle = sc;
            if (cd) cd.appliedStrokeStyle = sc;
          }
          if (lastStrokeW !== sw) {
            lastStrokeW = sw;
            renderer.ctxLineWidth(sw);
            ctx.lineWidth = sw;
            if (cd) cd.appliedLineWidth = sw;
          }
          ctx.strokeText(ch, 0, 0);
        }
        renderer.restore();
        xPos += widths[i] + tracking;
        xPosBroken += tracking;
      }
    } else {
      // 无逐字母数据(如 singleShape):整段文本逐行绘制
      const text = String(doc.t ?? doc.finalText ?? '');
      const lines = text.split('\r');
      const lh = doc.yOffset || doc.finalSize * 1.2;
      let align: CanvasTextAlign = 'left';
      if (doc.j === 1) align = 'right';
      else if (doc.j === 2) align = 'center';
      renderer.save();
      ctx.textAlign = align;
      if (hasFill) {
        const fill = buildRgba(doc.fc);
        renderer.ctxFillStyle(fill);
        ctx.fillStyle = fill;
        if (cd) cd.appliedFillStyle = fill;
      }
      if (hasStroke) {
        const stroke = buildRgba(doc.sc);
        const sw = doc.sw || 1;
        renderer.ctxStrokeStyle(stroke);
        ctx.strokeStyle = stroke;
        if (cd) cd.appliedStrokeStyle = stroke;
        renderer.ctxLineWidth(sw);
        ctx.lineWidth = sw;
        if (cd) cd.appliedLineWidth = sw;
      }
      for (let li = 0; li < lines.length; li++) {
        const y = li * lh;
        if (hasFill) ctx.fillText(lines[li], 0, y);
        if (hasStroke) ctx.strokeText(lines[li], 0, y);
      }
      ctx.textAlign = 'left';
      renderer.restore();
    }
  };
}

function patchCanvasRendererTree(renderer: any) {
  const origBuild = renderer.buildItem.bind(renderer);
  renderer.buildItem = function (this: any, pos: number) {
    origBuild(pos);
    const el = this.elements[pos];
    if (!el || el.__lottieFallbackPatched) return;
    el.__lottieFallbackPatched = true;
    if (el.data && el.data.ty === 5) {
      patchCanvasTextElement(el);
    } else if (el.data && el.data.ty === 0 && typeof el.buildItem === 'function') {
      patchCanvasRendererTree(el); // 预合成内的文字层
    }
  };
}

/* ---------- DOM 引用 ---------- */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const previewStage = $<HTMLDivElement>('stage');
const previewInner = $<HTMLDivElement>('previewInner');
const btnPlay = $<HTMLButtonElement>('btnPlay');
const btnRestart = $<HTMLButtonElement>('btnRestart');
const chkLoop = $<HTMLInputElement>('chkLoop');
const rngSpeed = $<HTMLInputElement>('rngSpeed');
const speedVal = $<HTMLSpanElement>('speedVal');
const frameInfo = $<HTMLElement>('frameInfo');
const timeInfo = $<HTMLElement>('timeInfo');
const rngFrame = $<HTMLInputElement>('rngFrame');
const selRenderer = $<HTMLSelectElement>('selRenderer');
const selFit = $<HTMLSelectElement>('selFit');
const bgColor = $<HTMLInputElement>('bgColor');
const chkTransparent = $<HTMLInputElement>('chkTransparent');
const infoList = $<HTMLDListElement>('infoList');
const textList = $<HTMLUListElement>('textList');
const textCount = $<HTMLElement>('textCount');
const shapeList = $<HTMLUListElement>('shapeList');
const shapeCount = $<HTMLElement>('shapeCount');
const statusbar = $<HTMLElement>('statusbar');

/* ---------- 状态 ---------- */
let anim: AnimationItem | null = null;
let currentData: any = null;
let currentName = '';
let scrubWasPlaying = false;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function setStatus(msg: string, isError = false) {
  statusbar.textContent = msg;
  statusbar.classList.toggle('error', isError);
}

/* ---------- 动画生命周期 ---------- */
function destroyAnim() {
  if (anim) {
    try { anim.destroy(); } catch { /* ignore */ }
    anim = null;
  }
  previewInner.innerHTML = '';
}

let loadSeq = 0;

async function loadData(data: any, name: string) {
  const seq = ++loadSeq;
  destroyAnim();
  currentData = data;
  currentName = name;
  captureOriginalState(data);
  captureOriginalShapeState(data);
  applyFit();
  resetView();
  applyBackground();
  setStatus('字体加载中…');
  await loadEmbeddedFonts(data);
  if (seq !== loadSeq) return; // 载入期间又发起了新的载入请求
  try {
    anim = lottie.loadAnimation({
      container: previewInner,
      renderer: selRenderer.value === 'canvas' ? 'canvas' : 'svg',
      loop: chkLoop.checked,
      autoplay: true,
      animationData: data,
      audioFactory,
    });
    (window as any).__anim = anim;
    (window as any).__lottie = lottie;
    if (selRenderer.value === 'canvas') {
      patchCanvasRendererTree((anim as any).renderer);
    }
    anim.addEventListener('DOMLoaded', onAnimReady);
    anim.addEventListener('config_ready', onAnimReady);
    anim.addEventListener('data_failed', () => setStatus('动画数据解析失败,无法渲染', true));
  } catch (e) {
    setStatus('载入失败: ' + (e as Error).message, true);
  }
  updateInfo(data);
}

function onAnimReady() {
  updateFrameRange();
  updateTransport();
  setStatus('已载入: ' + currentName);
}

/* ---------- 播放控制 ---------- */
function updateTransport() {
  if (!anim) return;
  btnPlay.textContent = anim.isPaused ? '▶' : '⏸';
  btnPlay.title = anim.isPaused ? '播放(空格键)' : '暂停(空格键)';
}

  function updateFrameRange() {
    if (!anim) return;
    
    const total = Math.round(anim.totalFrames ?? 0);
    const max = Math.max(0, total - 1);
    rngFrame.min = '0';
    rngFrame.max = String(max);
    rngFrame.value = String(Math.round(anim.currentFrame));
  }

btnPlay.addEventListener('click', () => {
  if (!anim) return;
  if (anim.isPaused) anim.play(); else anim.pause();
  updateTransport();
});

btnRestart.addEventListener('click', () => {
  if (!anim) return;
  const first = anim.firstFrame ?? (currentData?.ip ?? 0);
  anim.goToAndStop(first, true);
  if (!anim.isPaused) anim.play();
});

  rngFrame.addEventListener('input', () => {
    if (!anim) return;
    if (!anim.isPaused) {
      scrubWasPlaying = true;
      anim.pause();
      updateTransport();
    }
    const f = Number(rngFrame.value);
    anim.goToAndStop(f, true);
    frameInfo.textContent = f + ' / ' + Math.round(anim.totalFrames);
    timeInfo.textContent = (f / anim.frameRate).toFixed(2) + 's';
  });

  rngFrame.addEventListener('change', () => {
    if (anim && scrubWasPlaying) {
      anim.play();
      updateTransport();
    }
    scrubWasPlaying = false;
  });

chkLoop.addEventListener('change', () => {
  if (anim) anim.loop = chkLoop.checked;
});

rngSpeed.addEventListener('input', () => {
  const v = parseFloat(rngSpeed.value);
  speedVal.textContent = v.toFixed(1) + '×';
  if (anim) anim.setSpeed(v);
});

selRenderer.addEventListener('change', () => {
  if (currentData) void loadData(currentData, currentName);
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target as HTMLElement | null;
  if (t && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
  e.preventDefault();
  btnPlay.click();
});

/* ---------- 显示适配 / 缩放 / 平移 ---------- */
let baseScale = 1; // 由适配模式决定的基准缩放
let viewZoom = 1; // 用户缩放倍数
let viewPanX = 0; // 平移偏移(屏幕像素)
let viewPanY = 0;

const zoomInfo = $<HTMLElement>('zoomInfo');
const btnResetView = $<HTMLButtonElement>('btnResetView');
const selFormat = $<HTMLSelectElement>('selFormat');
const btnExport = $<HTMLButtonElement>('btnExport');
const exportHint = $<HTMLSpanElement>('exportHint');
const exportOverlay = $<HTMLDivElement>('exportOverlay');
const exportStatus = $<HTMLElement>('exportStatus');
const exportPercent = $<HTMLElement>('exportPercent');
const exportBarFill = $<HTMLDivElement>('exportBarFill');
const exportDetail = $<HTMLElement>('exportDetail');
const exportFormatTag = $<HTMLElement>('exportFormatTag');
const exportWarn = $<HTMLElement>('exportWarn');
const btnExportCancel = $<HTMLButtonElement>('btnExportCancel');

function applyFit() {
  const d = currentData;
  if (!d || !d.w || !d.h) return;
  const cw = previewStage.clientWidth;
  const ch = previewStage.clientHeight;
  previewInner.style.width = d.w + 'px';
  previewInner.style.height = d.h + 'px';
  previewInner.style.marginLeft = -d.w / 2 + 'px';
  previewInner.style.marginTop = -d.h / 2 + 'px';
  const fit = selFit.value;
  if (fit === 'contain') baseScale = Math.min(cw / d.w, ch / d.h);
  else if (fit === 'cover') baseScale = Math.max(cw / d.w, ch / d.h);
  else baseScale = 1;
  updateViewTransform();
}

function updateViewTransform() {
  const s = baseScale * viewZoom;
  previewInner.style.transform =
    'translate(' + viewPanX + 'px, ' + viewPanY + 'px) scale(' + s + ')';
  zoomInfo.textContent = Math.round(viewZoom * 100) + '%';
}

function resetView() {
  viewZoom = 1;
  viewPanX = 0;
  viewPanY = 0;
  updateViewTransform();
}

selFit.addEventListener('change', () => {
  applyFit();
  resetView();
});
new ResizeObserver(applyFit).observe(previewStage);

/* 滚轮缩放(以鼠标位置为中心) */
previewStage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = previewStage.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const factor = Math.pow(1.1, -e.deltaY / 100);
    const nextZoom = Math.min(50, Math.max(0.05, viewZoom * factor));
    const z = nextZoom / viewZoom;
    viewPanX = dx * (1 - z) + z * viewPanX;
    viewPanY = dy * (1 - z) + z * viewPanY;
    viewZoom = nextZoom;
    updateViewTransform();
  },
  { passive: false }
);

/* 鼠标拖动平移 */
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panOrigX = 0;
let panOrigY = 0;

previewStage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  panning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panOrigX = viewPanX;
  panOrigY = viewPanY;
  previewStage.setPointerCapture(e.pointerId);
  previewStage.classList.add('panning');
});
previewStage.addEventListener('pointermove', (e) => {
  if (!panning) return;
  viewPanX = panOrigX + (e.clientX - panStartX);
  viewPanY = panOrigY + (e.clientY - panStartY);
  updateViewTransform();
});
const endPan = () => {
  panning = false;
  previewStage.classList.remove('panning');
};
previewStage.addEventListener('pointerup', endPan);
previewStage.addEventListener('pointercancel', endPan);

/* 双击复位视图 */
previewStage.addEventListener('dblclick', resetView);
btnResetView.addEventListener('click', resetView);

function applyBackground() {
  if (chkTransparent.checked) {
    previewStage.style.background =
      'repeating-conic-gradient(#2a2d33 0% 25%, #22252a 0% 50%) 50% / 20px 20px';
  } else {
    previewStage.style.background = bgColor.value;
  }
}
bgColor.addEventListener('input', applyBackground);

/* 导出格式与背景联动:
 * - 勾选「透明背景」:MP4 不支持透明,导出格式自动切换为 AVI;
 * - 选择 MP4 / AVI(未勾选透明):导出时使用当前选择的背景色。 */
function syncExportFormatUI() {
  const transparent = chkTransparent.checked;
  selFormat.disabled = transparent;
  if (transparent) {
    selFormat.value = 'avi';
    exportHint.textContent = '透明 AVI 供剪辑软件(剪映/AE/Premiere)导入;播放器(PotPlayer 等)不合成 alpha,半透明会显示为不透明';
    exportHint.classList.add('warn');
  } else if (selFormat.value === 'mp4') {
    exportHint.textContent = 'MP4 将使用当前背景色导出(播放流畅,推荐)';
    exportHint.classList.remove('warn');
  } else {
    exportHint.textContent = 'AVI 将使用当前背景色导出(H.264 编码,PotPlayer/VLC/剪映可流畅播放)';
    exportHint.classList.remove('warn');
  }
}
chkTransparent.addEventListener('change', () => {
  applyBackground();
  syncExportFormatUI();
});
selFormat.addEventListener('change', syncExportFormatUI);
syncExportFormatUI();

/* ---------- 帧指示 ---------- */
let lastFrame = -1;
function tick() {
  if (anim && anim.isLoaded) {
    const f = Math.round(anim.currentFrame);
    if (f !== lastFrame) {
      lastFrame = f;
      frameInfo.textContent = f + ' / ' + Math.round(anim.totalFrames);
      timeInfo.textContent = (f / anim.frameRate).toFixed(2) + 's';
        rngFrame.value = String(f);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- 信息面板 ---------- */
function textOfLayer(l: any): string {
  const td = l.t?.d?.k;
  const s = Array.isArray(td) ? td[0]?.s : td?.s;
  return s?.t ?? '';
}

function collectTextLayers(data: any): { nm: string; ind: number; text: string }[] {
  const out: { nm: string; ind: number; text: string }[] = [];
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l.ty === 5) out.push({ nm: l.nm ?? '(未命名)', ind: l.ind, text: textOfLayer(l) });
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(data.layers);
  return out;
}

/* 颜色转换: Bodymovin fc 为 [r,g,b](0~1) ↔ #rrggbb */
function fcToHex(fc: number[] | undefined): string {
  if (!fc || fc.length < 3) return '#ffffff';
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return '#' + toHex(fc[0]) + toHex(fc[1]) + toHex(fc[2]);
}

function hexToFc(hex: string, originalFc?: number[]): number[] {
  const h = hex.replace('#', '');
  const fc = [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
  if (originalFc && originalFc.length > 3) fc.push(originalFc[3]);
  return fc;
}

/* 设置颜色选择器 + 相邻 HEX 输入框的值 */
function setColorPickerValue(colorInput: HTMLInputElement, hex: string) {
  colorInput.value = hex;
  const hexInput = colorInput.nextElementSibling as HTMLInputElement | null;
  if (hexInput) hexInput.value = hex;
}

/* 绑定颜色选择器与其相邻 HEX 输入框,双向同步 */
function bindColorPicker(colorInput: HTMLInputElement, onChange: (hex: string) => void) {
  const hexInput = colorInput.nextElementSibling as HTMLInputElement | null;
  colorInput.addEventListener('input', () => {
    if (hexInput) hexInput.value = colorInput.value;
    onChange(colorInput.value);
  });
  if (hexInput) {
    hexInput.addEventListener('input', () => {
      let v = hexInput.value.trim();
      if (v && !v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        colorInput.value = v.toLowerCase();
        onChange(colorInput.value);
      }
    });
  }
}

/* 记录每个文字图层的原始文字与颜色,供重置使用 */
const originalTextState = new Map<number, { text: string; fc: number[] }>();

function captureOriginalState(data: any) {
  originalTextState.clear();
  for (const t of collectTextLayers(data)) {
    const layer = findLayerByInd(data.layers, t.ind);
    if (!layer) continue;
    const td = layer.t?.d?.k;
    const s = (Array.isArray(td) ? td[0]?.s : td?.s) || {};
    originalTextState.set(t.ind, {
      text: s.t ?? '',
      fc: s.fc ? [...s.fc] : [1, 1, 1],
    });
  }
}

function updateInfo(data: any) {
  const ip = data.ip ?? 0;
  const op = data.op ?? 0;
  const fr = data.fr ?? 0;
  const dur = fr ? (op - ip) / fr : 0;
  const texts = collectTextLayers(data);
  const assets: any[] = data.assets ?? [];
  const embedded = assets.filter((a) => typeof a.p === 'string' && a.p.startsWith('data:'));
  const fontDefs: any[] = data.fonts?.list ?? [];
  const fonts: string[] = fontDefs.map((f: any) => f.fName).filter(Boolean);
  const embeddedFontCount = fontDefs.filter((f: any) => typeof f.fPath === 'string' && f.fPath.length > 0).length;

  const items: [string, string][] = [
    ['尺寸', data.w + ' × ' + data.h],
    ['帧率', fr + ' fps'],
    ['入点 / 出点', ip + ' / ' + op],
    ['时长', dur.toFixed(2) + ' s'],
    ['图层数', String(data.layers?.length ?? 0)],
    ['资源数', String(assets.length)],
    ['内嵌资源', String(embedded.length)],
    ['字体', fonts.length ? fonts.join('、') + (embeddedFontCount > 0 ? ' · 已内嵌' : ' · 未内嵌') : '—'],
    ['Bodymovin 版本', data.v ?? '—'],
  ];
  infoList.innerHTML = items.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');

  textCount.textContent = '· ' + texts.length + ' 个 · 可编辑';
  textList.innerHTML = texts
    .map((t) => {
      const layer = findLayerByInd(data.layers, t.ind);
      const td = layer?.t?.d?.k;
      const s = (Array.isArray(td) ? td[0]?.s : td?.s) || {};
      const hex = fcToHex(s.fc);
      const displayText = String(t.text).replace(/\r/g, '\n');
      const rows = Math.max(1, displayText.split('\n').length);
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(t.nm) + '</span>' +
        '<button class="t-reset" data-ind="' + t.ind + '" type="button" title="重置文字与颜色">↺ 重置</button>' +
        '</div>' +
        '<textarea class="t-input" rows="' + rows + '" data-ind="' + t.ind + '" spellcheck="false"></textarea>' +
        '<label class="t-color-label">颜色 <input type="color" class="t-color" data-ind="' + t.ind + '" value="' + hex + '" /><input type="text" class="hex-input" value="' + hex + '" spellcheck="false" placeholder="#rrggbb" /></label>' +
        '</li>'
      );
    })
    .join('');
  textList.querySelectorAll<HTMLTextAreaElement>('.t-input').forEach((ta) => {
    const target = texts.find((t) => t.ind === Number(ta.dataset.ind));
    if (target) ta.value = String(target.text).replace(/\r/g, '\n');
    ta.addEventListener('input', () => onTextEdited(Number(ta.dataset.ind), ta.value));
  });
  textList.querySelectorAll<HTMLInputElement>('.t-color').forEach((ci) => {
    bindColorPicker(ci, (hex) => onColorChanged(Number(ci.dataset.ind), hex));
  });
  textList.querySelectorAll<HTMLButtonElement>('.t-reset').forEach((btn) => {
    btn.addEventListener('click', () => onResetText(Number(btn.dataset.ind)));
  });

  renderShapeList(data);

  if (fonts.length) {
    setStatus(embeddedFontCount > 0
      ? '自定义字体已从 JSON 内嵌文件加载: ' + fonts.join('、')
      : '注意: 动画使用了自定义字体(' + fonts.join('、') + '),JSON 未内嵌字体,预览文字将回退为系统字体');
  }
}

/* ---------- 文字编辑 ---------- */
function findLayerByInd(layers: any[], ind: number): any | null {
  for (const l of layers ?? []) {
    if (l.ind === ind) return l;
    if (Array.isArray(l.layers)) {
      const found = findLayerByInd(l.layers, ind);
      if (found) return found;
    }
  }
  return null;
}

/* 文字宽度测量(编辑时用于保持居中) */
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function measureTextWidth(text: string, fontName: string, fontSize: number): number {
  const fontDef = currentData?.fonts?.list?.find((f: any) => f.fName === fontName || f.fFamily === fontName);
  const family = (fontDef && fontDef.fFamily) || fontName || 'sans-serif';
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  ctx.font = fontSize + 'px "' + family + '"';
  const lines = String(text).split('\r');
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxW) maxW = w;
  }
  return maxW;
}

function setLayerText(layer: any, newText: string) {
  const td = layer?.t?.d?.k;
  if (!td) return;
  const s = (Array.isArray(td) ? td[0]?.s : td?.s) || {};
  const oldText = s.t ?? '';
  // 统一换行为 AE/Bodymovin 使用的 \r
  const normalized = newText.replace(/\r\n|\r|\n/g, '\r');
  if (Array.isArray(td)) {
    for (const kf of td) if (kf.s) kf.s.t = normalized;
  } else if (td.s) {
    td.s.t = normalized;
  }
  // 保持居中:锚点原本位于文字中心,文字宽度变化时按变化量的一半调整锚点 X
  if (s.f && layer.ks?.a) {
    const oldW = measureTextWidth(oldText, s.f, s.s);
    const newW = measureTextWidth(normalized, s.f, s.s);
    const delta = (newW - oldW) / 2;
    if (layer.ks.a.a === 0) {
      layer.ks.a.k[0] = (layer.ks.a.k[0] || 0) + delta;
    } else if (Array.isArray(layer.ks.a.k)) {
      for (const kf of layer.ks.a.k) if (kf.s) kf.s[0] = (kf.s[0] || 0) + delta;
    }
  }
}

let textEditTimer: number | undefined;

function onTextEdited(ind: number, newText: string) {
  if (!currentData) return;
  const layer = findLayerByInd(currentData.layers, ind);
  if (!layer) return;
  setLayerText(layer, newText);
  // 防抖后重渲染(保留当前帧/播放状态/缩放)
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => {
    reRenderPreservingState();
  }, 250);
}

function setLayerColor(layer: any, hex: string) {
  const td = layer?.t?.d?.k;
  if (!td) return;
  const fc = hexToFc(hex);
  if (Array.isArray(td)) {
    for (const kf of td) if (kf.s) kf.s.fc = [...fc];
  } else if (td.s) {
    td.s.fc = [...fc];
  }
}

function onColorChanged(ind: number, hex: string) {
  if (!currentData) return;
  const layer = findLayerByInd(currentData.layers, ind);
  if (!layer) return;
  setLayerColor(layer, hex);
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => {
    reRenderPreservingState();
  }, 250);
}

function onResetText(ind: number) {
  if (!currentData) return;
  const orig = originalTextState.get(ind);
  if (!orig) return;
  const layer = findLayerByInd(currentData.layers, ind);
  if (!layer) return;
  setLayerText(layer, orig.text);
  setLayerColor(layer, fcToHex(orig.fc));
  // 同步 UI
  const ta = textList.querySelector<HTMLTextAreaElement>('.t-input[data-ind="' + ind + '"]');
  if (ta) ta.value = String(orig.text).replace(/\r/g, '\n');
  const ci = textList.querySelector<HTMLInputElement>('.t-color[data-ind="' + ind + '"]');
  if (ci) setColorPickerValue(ci, fcToHex(orig.fc));
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => {
    reRenderPreservingState();
  }, 250);
}

/* ---------- 形状图层颜色 ---------- */
function collectShapeFillsStrokes(shapes: any[]): { fills: any[]; strokes: any[] } {
  const fills: any[] = [];
  const strokes: any[] = [];
  const walk = (items: any[]) => {
    for (const it of items ?? []) {
      if (it.ty === 'fl') fills.push(it);
      else if (it.ty === 'st') strokes.push(it);
      if (Array.isArray(it.it)) walk(it.it);
    }
  };
  walk(shapes);
  return { fills, strokes };
}

function shapeLayerColorInfo(data: any): { ind: number; nm: string; fill: number[] | null; stroke: number[] | null }[] {
  const out: { ind: number; nm: string; fill: number[] | null; stroke: number[] | null }[] = [];
  for (const l of data.layers ?? []) {
    if (l.ty !== 4) continue;
    const { fills, strokes } = collectShapeFillsStrokes(l.shapes);
    const fill = fills.length > 0 && fills[0].c?.a === 0 ? fills[0].c.k : null;
    const stroke = strokes.length > 0 && strokes[0].c?.a === 0 ? strokes[0].c.k : null;
    out.push({ ind: l.ind, nm: l.nm || '(未命名)', fill, stroke });
  }
  return out;
}

const originalShapeState = new Map<number, { fill: number[] | null; stroke: number[] | null }>();

function captureOriginalShapeState(data: any) {
  originalShapeState.clear();
  for (const s of shapeLayerColorInfo(data)) {
    originalShapeState.set(s.ind, {
      fill: s.fill ? [...s.fill] : null,
      stroke: s.stroke ? [...s.stroke] : null,
    });
  }
}

function setShapeFillColor(layer: any, hex: string) {
  const { fills } = collectShapeFillsStrokes(layer.shapes);
  for (const f of fills) if (f.c?.a === 0) f.c.k = hexToFc(hex, f.c.k);
}

function setShapeStrokeColor(layer: any, hex: string) {
  const { strokes } = collectShapeFillsStrokes(layer.shapes);
  for (const s of strokes) if (s.c?.a === 0) s.c.k = hexToFc(hex, s.c.k);
}

function onShapeColorChanged(ind: number, hex: string, kind: 'fill' | 'stroke') {
  if (!currentData) return;
  const layer = findLayerByInd(currentData.layers, ind);
  if (!layer) return;
  if (kind === 'fill') setShapeFillColor(layer, hex);
  else setShapeStrokeColor(layer, hex);
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
}

function onShapeReset(ind: number) {
  if (!currentData) return;
  const orig = originalShapeState.get(ind);
  if (!orig) return;
  const layer = findLayerByInd(currentData.layers, ind);
  if (!layer) return;
  if (orig.fill) setShapeFillColor(layer, fcToHex(orig.fill));
  if (orig.stroke) setShapeStrokeColor(layer, fcToHex(orig.stroke));
  const fi = shapeList.querySelector<HTMLInputElement>('.s-fill[data-ind="' + ind + '"]');
  if (fi && orig.fill) setColorPickerValue(fi, fcToHex(orig.fill));
  const si = shapeList.querySelector<HTMLInputElement>('.s-stroke[data-ind="' + ind + '"]');
  if (si && orig.stroke) setColorPickerValue(si, fcToHex(orig.stroke));
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
}

function renderShapeList(data: any) {
  const shapes = shapeLayerColorInfo(data);
  shapeCount.textContent = '· ' + shapes.length + ' 个';
  shapeList.innerHTML = shapes
    .map((s) => {
      const fillHex = s.fill ? fcToHex(s.fill) : null;
      const strokeHex = s.stroke ? fcToHex(s.stroke) : null;
      let colorHtml = '';
      if (fillHex) colorHtml += '<label class="t-color-label">填充 <input type="color" class="s-fill" data-ind="' + s.ind + '" value="' + fillHex + '" /><input type="text" class="hex-input" value="' + fillHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      if (strokeHex) colorHtml += '<label class="t-color-label">描边 <input type="color" class="s-stroke" data-ind="' + s.ind + '" value="' + strokeHex + '" /><input type="text" class="hex-input" value="' + strokeHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(s.nm) + '</span>' +
        '<button class="t-reset s-reset" data-ind="' + s.ind + '" type="button" title="重置颜色">↺ 重置</button>' +
        '</div>' +
        '<div class="shape-colors">' + colorHtml + '</div>' +
        '</li>'
      );
    })
    .join('');
  shapeList.querySelectorAll<HTMLInputElement>('.s-fill').forEach((ci) => {
    bindColorPicker(ci, (hex) => onShapeColorChanged(Number(ci.dataset.ind), hex, 'fill'));
  });
  shapeList.querySelectorAll<HTMLInputElement>('.s-stroke').forEach((ci) => {
    bindColorPicker(ci, (hex) => onShapeColorChanged(Number(ci.dataset.ind), hex, 'stroke'));
  });
  shapeList.querySelectorAll<HTMLButtonElement>('.s-reset').forEach((btn) => {
    btn.addEventListener('click', () => onShapeReset(Number(btn.dataset.ind)));
  });
}

function reRenderPreservingState() {
  if (!currentData || !anim) return;
  const frame = anim.currentFrame;
  const wasPaused = anim.isPaused;
  const speed = parseFloat(rngSpeed.value);
  const renderer = selRenderer.value;

  destroyAnim();
  let newAnim: AnimationItem;
  try {
    newAnim = lottie.loadAnimation({
      container: previewInner,
      renderer: renderer === 'canvas' ? 'canvas' : 'svg',
      loop: chkLoop.checked,
      autoplay: false,
      animationData: currentData,
      audioFactory,
    });
  } catch (e) {
    setStatus('载入失败: ' + (e as Error).message, true);
    return;
  }
  anim = newAnim;
  (window as any).__anim = newAnim;
  (window as any).__lottie = lottie;
  if (renderer === 'canvas') patchCanvasRendererTree(newAnim.renderer as any);
  newAnim.addEventListener('DOMLoaded', onAnimReady);
  newAnim.addEventListener('config_ready', onAnimReady);
  newAnim.setSpeed(speed);
  requestAnimationFrame(() => {
    newAnim.goToAndStop(frame, true);
    if (!wasPaused) newAnim.play();
    updateTransport();
  });
}

/* ---------- 载入来源 ----------
 * animation_data.json 已打包进网站,启动时直接解析加载,无需服务器接口。
 * 音频不使用 JSON 内嵌版本,改用 animation 目录下的音频文件(一并打包进网站)。 */
import animationDataJson from '../animation/animation_data.json?raw';
import bundledAudioUrl from '../animation/gunmuchenggong.mp3?url';

let bootAnimation: any;
try {
  // 剥离 JSON 内嵌的旧音频(base64),确保运行时不再使用
  const stripped = animationDataJson.replace(/"data:audio[^"]*"/g, '""');
  bootAnimation = JSON.parse(stripped);
  // 把音频资源指向打包的音频文件(预览播放与导出均使用它)
  for (const a of bootAnimation.assets ?? []) {
    if (typeof a.id === 'string' && a.id.toLowerCase().includes('audio')) {
      a.p = bundledAudioUrl;
      a.u = '';
      a.e = 1;
    }
  }
} catch (e) {
  console.error('[内置动画数据解析失败]', e);
  setStatus('内置动画数据解析失败: ' + (e as Error).message, true);
}

/* ---------- 视频导出 ---------- */
let exporting = false;

/* ---------- 导出进度浮层 ---------- */
class ExportCancelledError extends Error {}

let exportCancelRequested = false;
let exportLastPct = 0;
let exportOverlayTimer: number | undefined;

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
  return bytes + ' B';
}

function showExportOverlay(opts: { formatLabel: string; warn?: string }) {
  window.clearTimeout(exportOverlayTimer);
  exportCancelRequested = false;
  exportLastPct = 0;
  exportOverlay.hidden = false;
  exportFormatTag.textContent = opts.formatLabel;
  exportWarn.hidden = !opts.warn;
  exportWarn.textContent = opts.warn ?? '';
  btnExportCancel.disabled = false;
  btnExportCancel.textContent = '取消导出';
  exportPercent.className = 'export-percent';
  updateExportProgress(0, '正在准备…', '');
}

function updateExportProgress(pct: number, status: string, detail = '') {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  exportLastPct = p;
  exportPercent.textContent = p + '%';
  exportBarFill.style.width = p + '%';
  exportStatus.textContent = status;
  exportDetail.textContent = detail;
}

function finishExportOverlay(kind: 'done' | 'error' | 'cancel', status: string, detail: string, holdMs = 2600) {
  exportPercent.classList.add(kind === 'done' ? 'done' : kind === 'error' ? 'error' : 'cancel');
  exportStatus.textContent = status;
  exportDetail.textContent = detail;
  btnExportCancel.disabled = false;
  btnExportCancel.textContent = '关闭';
  window.clearTimeout(exportOverlayTimer);
  if (kind !== 'error') {
    exportOverlayTimer = window.setTimeout(() => { exportOverlay.hidden = true; }, holdMs);
  }
}

btnExportCancel.addEventListener('click', () => {
  if (!exporting) { exportOverlay.hidden = true; return; }
  exportCancelRequested = true;
  btnExportCancel.disabled = true;
  updateExportProgress(exportLastPct, '正在取消,请稍候…');
});

const WebVideoEncoder = (window as any).VideoEncoder;
const WebAudioEncoder = (window as any).AudioEncoder;
const WebVideoFrame = (window as any).VideoFrame;
const WebAudioData = (window as any).AudioData;

/* 音频来源:animation 目录下的音频文件(已打包进网站),不再使用 JSON 内嵌音频 */
function findAudioAsset(): string | null {
  return bundledAudioUrl || null;
}

async function decodeAudio(dataUrl: string): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
  try {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    const ACtor = (window.AudioContext || (window as any).webkitAudioContext);
    const ac = new ACtor();
    const ab = await ac.decodeAudioData(buf.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < ab.numberOfChannels; c++) channels.push(ab.getChannelData(c));
    const out = { channels, sampleRate: ab.sampleRate };
    ac.close();
    return out;
  } catch { return null; }
}

async function resampleTo(channels: Float32Array[], fromRate: number, toRate: number): Promise<Float32Array[]> {
  if (fromRate === toRate) return channels;
  const numCh = channels.length;
  const len = channels[0].length;
  const off = new OfflineAudioContext(numCh, Math.ceil((len * toRate) / fromRate), toRate);
  const src = off.createBufferSource();
  const buf = off.createBuffer(numCh, len, fromRate);
  for (let c = 0; c < numCh; c++) buf.copyToChannel(channels[c] as Float32Array<ArrayBuffer>, c);
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const out: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) out.push(rendered.getChannelData(c));
  return out;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportVideoMp4(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void) {
  if (!WebVideoEncoder || !WebVideoFrame) throw new Error('当前浏览器不支持 WebCodecs 视频编码(请用 Chrome/Edge)');
  const w = data.w, h = data.h;
  const audioUrl = findAudioAsset();
  const audioInfo = audioUrl ? await decodeAudio(audioUrl) : null;
  const audioChannels = audioInfo ? await resampleTo(audioInfo.channels, audioInfo.sampleRate, 48000) : null;
  const numCh = audioChannels ? Math.min(audioChannels.length, 2) : 0;
  const videoSec = totalFrames / fr;
  const audioFrames = audioChannels ? Math.round(videoSec * 48000) : 0;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate: fr },
    ...(numCh > 0 ? { audio: { codec: 'aac', numberOfChannels: numCh, sampleRate: 48000 } } : {}),
    fastStart: 'in-memory',
  });

  const videoEncoder = new WebVideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: any) => { throw e; },
  });
  videoEncoder.configure({ codec: 'avc1.64002a', width: w, height: h, bitrate: 30_000_000, framerate: fr });

  let audioEncoder: any = null;
  if (numCh > 0 && WebAudioEncoder && WebAudioData) {
    audioEncoder = new WebAudioEncoder({
      output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
      error: (e: any) => { throw e; },
    });
    audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: numCh, bitrate: 192000 });
    const AAC_FRAME = 1024;
    for (let off = 0; off < audioFrames; off += AAC_FRAME) {
      const n = Math.min(AAC_FRAME, audioFrames - off);
      const planar = new Float32Array(n * numCh);
      for (let c = 0; c < numCh; c++) planar.set(audioChannels![c].subarray(off, off + n), c * n);
      const audioData = new WebAudioData({
        format: 'f32-planar', sampleRate: 48000, numberOfChannels: numCh,
        numberOfFrames: n, timestamp: Math.round((off / 48000) * 1e6), data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }
  }

  for (let i = 0; i < totalFrames; i++) {
    if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
    renderFrame(data.ip + i);
    const frame = new WebVideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fr), duration: Math.round(1e6 / fr) });
    videoEncoder.encode(frame, { keyFrame: i % 60 === 0 });
    frame.close();
    if (i % 12 === 0) { onProgress(Math.round((i / totalFrames) * 100), '正在编码帧 ' + (i + 1) + ' / ' + totalFrames); await new Promise((r) => setTimeout(r, 0)); }
  }

  onProgress(99, '帧编码完成,正在封装音视频…');
  await videoEncoder.flush();
  videoEncoder.close();
  if (audioEncoder) { await audioEncoder.flush(); audioEncoder.close(); }
  muxer.finalize();
  onProgress(100, '封装完成,正在下载…');
  downloadBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'animation.mp4');
}

/* --- AVI 自封装(MJPEG + PCM / 无压缩 BGRA 透明 + PCM) --- */
function ascii(s: string) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }

/* AVI 容器通用组装(videoFcc: 编码器标识 MJPG / DIB ;strf: 视频流 BITMAPINFOHEADER;
 * frameFcc: movi 帧块标识 00dc / 00db)。直接以 parts 数组构造 Blob,避免大文件二次拷贝。 */
function buildAvi(w: number, h: number, fr: number, videoFcc: string, strf: Uint8Array<ArrayBuffer>, frameFcc: string, frameChunks: Uint8Array<ArrayBuffer>[], pcm16: Uint8Array<ArrayBuffer>, numCh: number, audioRate: number, frameKeyFlags?: boolean[]): Blob {
  const totalFrames = frameChunks.length;
  const isDib = videoFcc === 'DIB ';
  const frameBytes = w * h * 4;
  const audioChunks: Uint8Array<ArrayBuffer>[] = [];
  const CHUNK = 8192 * numCh * 2;
  for (let off = 0; off < pcm16.length; off += CHUNK) {
    const n = Math.min(CHUNK, pcm16.length - off);
    const pad = n % 2 ? 1 : 0;
    const c = new Uint8Array(n + pad); c.set(pcm16.subarray(off, off + n));
    audioChunks.push(c);
  }
  const bytesPerSample = numCh * 2;
  const hasAudio = numCh > 0;

  // 尺寸计算:LIST 块的大小字段 = 内容(四cc + 子块),不含 LIST 自身 8 字节头
  const avihChunkSize = 8 + 56;                    // 'avih' chunk
  const strhChunkSize = 8 + 56;                    // 'strh' chunk
  const strfVideoChunkSize = 8 + strf.length;      // 'strf' chunk(长度可变:40 或 40+avcC)
  const strfAudioChunkSize = 8 + 18;
  const videoStrlContent = 4 + strhChunkSize + strfVideoChunkSize;  // 'strl' + strh + strf
  const audioStrlContent = 4 + strhChunkSize + strfAudioChunkSize;  // 'auds' + strh + strf
  const hdrlContent = 4 + avihChunkSize + (8 + videoStrlContent) + (hasAudio ? 8 + audioStrlContent : 0);  // 'hdrl'
  const moviContent = 4 + frameChunks.reduce((s, c) => s + 8 + c.length, 0) + audioChunks.reduce((s, c) => s + 8 + c.length, 0);  // 'movi'
  const idxEntries = totalFrames + audioChunks.length;
  const idxDataBytes = idxEntries * 16;
  // RIFF 大小字段 = 文件总大小 - 8('RIFF' + size 本身)
  const riffSize = 28 + hdrlContent + moviContent + idxDataBytes;
  const parts: BlobPart[] = [];
  parts.push(ascii('RIFF'), u32(riffSize), ascii('AVI '));
  // hdrl
  parts.push(ascii('LIST'), u32(hdrlContent), ascii('hdrl'));
  // avih
  {
    const microSecPerFrame = Math.round(1e6 / fr);
    const avihChunk = new Uint8Array(56);
    const d = new DataView(avihChunk.buffer);
    d.setUint32(0, microSecPerFrame, true);
    d.setUint32(4, isDib ? frameBytes * fr : 0, true); // maxBytesPerSec
    d.setUint32(8, 0, true);
    d.setUint32(12, 0x10, true); // flags: HASINDEX
    d.setUint32(16, totalFrames, true);
    d.setUint32(20, 0, true);
    d.setUint32(24, hasAudio ? 2 : 1, true); // streams
    d.setUint32(28, 0, true);
    d.setUint32(32, w, true);
    d.setUint32(36, h, true);
    parts.push(ascii('avih'), u32(56), avihChunk);
  }
  // video strl
  {
    parts.push(ascii('LIST'), u32(videoStrlContent), ascii('strl'));
    // strh
    const strh = new Uint8Array(56);
    const d = new DataView(strh.buffer);
    strh.set(ascii('vids'), 0);
    strh.set(ascii(videoFcc), 4);
    d.setUint32(8, 0, true);
    d.setUint16(12, 0, true); d.setUint16(14, 0, true);
    d.setUint32(16, 0, true);
    d.setUint32(20, 1, true); // scale
    d.setUint32(24, fr, true); // rate
    d.setUint32(28, 0, true);
    d.setUint32(32, totalFrames, true); // length
    d.setUint32(36, isDib ? frameBytes : 0, true); // dwSuggestedBufferSize
    d.setUint32(40, 0xffffffff, true); // dwQuality: -1 使用默认质量
    d.setUint32(44, isDib ? frameBytes : 0, true); // dwSampleSize: 无压缩视频为固定帧大小
    parts.push(ascii('strh'), u32(56), strh);
    // strf (BITMAPINFOHEADER,长度可变:40 或 40+avcC)
    parts.push(ascii('strf'), u32(strf.length), strf);
  }
  // audio strl
  if (hasAudio) {
    parts.push(ascii('LIST'), u32(audioStrlContent), ascii('strl'));
    const strh = new Uint8Array(56);
    const d = new DataView(strh.buffer);
    strh.set(ascii('auds'), 0);
    d.setUint32(4, 0, true);
    d.setUint32(8, 0, true);
    d.setUint16(12, 0, true); d.setUint16(14, 0, true);
    d.setUint32(16, 0, true);
    d.setUint32(20, 1, true);
    d.setUint32(24, audioRate, true);
    d.setUint32(28, 0, true);
    d.setUint32(32, Math.floor(pcm16.length / bytesPerSample), true);
    d.setUint32(36, 0, true);
    d.setUint32(40, 0xffffffff, true); // -1 quality
    d.setUint32(44, bytesPerSample, true);
    parts.push(ascii('strh'), u32(56), strh);
    const strf = new Uint8Array(18);
    const df = new DataView(strf.buffer);
    df.setUint16(0, 1, true); // PCM
    df.setUint16(2, numCh, true);
    df.setUint32(4, audioRate, true);
    df.setUint32(8, audioRate * bytesPerSample, true);
    df.setUint16(12, bytesPerSample, true);
    df.setUint16(14, 16, true);
    df.setUint16(16, 0, true);
    parts.push(ascii('strf'), u32(18), strf);
  }
  // movi
  parts.push(ascii('LIST'), u32(moviContent), ascii('movi'));
  let moviOffset = 4; // 相对 movi list 内容的偏移
  const idx: { fourcc: string; flags: number; offset: number; size: number }[] = [];
  for (let i = 0; i < frameChunks.length; i++) {
    const c = frameChunks[i];
    parts.push(ascii(frameFcc), u32(c.length), c);
    idx.push({ fourcc: frameFcc, flags: frameKeyFlags && frameKeyFlags[i] ? 0x10 : 0x00, offset: moviOffset, size: c.length });
    moviOffset += 8 + c.length;
  }
  for (const c of audioChunks) {
    parts.push(ascii('01wb'), u32(c.length), c);
    idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: c.length });
    moviOffset += 8 + c.length;
  }
  // idx1
  parts.push(ascii('idx1'), u32(idxDataBytes));
  for (const e of idx) {
    const entry = new Uint8Array(16);
    const d = new DataView(entry.buffer);
    entry.set(ascii(e.fourcc), 0);
    d.setUint32(4, e.flags, true);
    d.setUint32(8, e.offset + 4, true); // 相对 movi 起始
    d.setUint32(12, e.size, true);
    parts.push(entry);
  }

  return new Blob(parts, { type: 'video/x-msvideo' });
}

/* BITMAPINFOHEADER:MJPEG(24bpp,无 alpha) */
function mjpegStrf(w: number, h: number): Uint8Array<ArrayBuffer> {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true);
  df.setInt32(4, w, true);
  df.setInt32(8, h, true);
  df.setUint16(12, 1, true);
  df.setUint16(14, 24, true);
  strf.set(ascii('MJPG'), 16);
  df.setUint32(20, 0, true); // size image
  return strf;
}

/* BITMAPINFOHEADER:无压缩 BGRA(32bpp,BI_RGB,带 alpha 透明通道) */
function dibStrf(w: number, h: number): Uint8Array<ArrayBuffer> {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true);
  df.setInt32(4, w, true);
  df.setInt32(8, h, true);
  df.setUint16(12, 1, true);
  df.setUint16(14, 32, true);
  df.setUint32(16, 0, true); // BI_RGB
  df.setUint32(20, w * h * 4, true); // biSizeImage
  return strf;
}

/* BITMAPINFOHEADER + avcC:H.264(24bpp,biCompression='H264',
 * 附加 AVCDecoderConfigurationRecord,PotPlayer/VLC/剪映 可硬解播放) */
function h264Strf(w: number, h: number, avcC: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const strf = new Uint8Array(40 + avcC.length);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40 + avcC.length, true); // biSize 含附加数据
  df.setInt32(4, w, true);
  df.setInt32(8, h, true);
  df.setUint16(12, 1, true);
  df.setUint16(14, 24, true);
  strf.set(ascii('H264'), 16);
  df.setUint32(20, 0, true); // biSizeImage
  strf.set(avcC, 40);
  return strf;
}

/* ImageData(RGBA,自上而下) → DIB 帧(BGRA,自下而上,保留 alpha) */
function rgbaToBgraBottomUp(img: ImageData, w: number, h: number): Uint8Array<ArrayBuffer> {
  const src = img.data;
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const s = y * rowBytes;
    const d = (h - 1 - y) * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      out[d + x] = src[s + x + 2];     // B
      out[d + x + 1] = src[s + x + 1]; // G
      out[d + x + 2] = src[s + x];     // R
      out[d + x + 3] = src[s + x + 3]; // A
    }
  }
  return out;
}

/* MJPEG 压缩 AVI(体积小,不含 alpha,用于带背景色的导出) */
function buildAviMjpeg(w: number, h: number, fr: number, jpegFrames: Uint8Array<ArrayBuffer>[], pcm16: Uint8Array<ArrayBuffer>, numCh: number, audioRate: number): Blob {
  const frameChunks = jpegFrames.map((f) => { const pad = f.length % 2 ? 1 : 0; const c = new Uint8Array(f.length + pad); c.set(f); return c; });
  return buildAvi(w, h, fr, 'MJPG', mjpegStrf(w, h), '00dc', frameChunks, pcm16, numCh, audioRate);
}

/* 无压缩 32 位 BGRA AVI(真正保留 alpha 透明通道,文件较大) */
function buildAviDib(w: number, h: number, fr: number, bgraFrames: Uint8Array<ArrayBuffer>[], pcm16: Uint8Array<ArrayBuffer>, numCh: number, audioRate: number): Blob {
  return buildAvi(w, h, fr, 'DIB ', dibStrf(w, h), '00db', bgraFrames, pcm16, numCh, audioRate);
}

/* 提取动画音频并转为 16bit PCM(所有 AVI 导出共用) */
async function buildPcm16(data: any, totalFrames: number, fr: number): Promise<{ pcm16: Uint8Array<ArrayBuffer>; numCh: number; audioRate: number }> {
  const audioUrl = findAudioAsset();
  const audioInfo = audioUrl ? await decodeAudio(audioUrl) : null;
  const audioChannels = audioInfo ? audioInfo.channels : null;
  const audioRate = audioInfo ? audioInfo.sampleRate : 44100;
  const numCh = audioChannels ? Math.min(audioChannels.length, 2) : 0;
  const videoSec = totalFrames / fr;
  const audioFrames = audioChannels ? Math.round(videoSec * audioRate) : 0;

  let pcm16 = new Uint8Array(0);
  if (numCh > 0) {
    pcm16 = new Uint8Array(audioFrames * numCh * 2);
    const dv = new DataView(pcm16.buffer);
    for (let c = 0; c < numCh; c++) {
      const ch = audioChannels![c];
      for (let i = 0; i < audioFrames; i++) {
        const s = i < ch.length ? Math.max(-1, Math.min(1, ch[i])) : 0;
        dv.setInt16((i * numCh + c) * 2, Math.round(s * 32767), true);
      }
    }
  }
  return { pcm16, numCh, audioRate };
}

async function exportVideoAvi(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void, mode: 'dib' | 'mjpeg') {
  const { pcm16, numCh, audioRate } = await buildPcm16(data, totalFrames, fr);

  let blob: Blob;
  if (mode === 'dib') {
    // 无压缩 32 位 BGRA:直接读取画布像素,真正保留 alpha 透明通道
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法读取渲染画布');
    const bgraFrames: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
      renderFrame(data.ip + i);
      bgraFrames.push(rgbaToBgraBottomUp(ctx.getImageData(0, 0, data.w, data.h), data.w, data.h));
      if (i % 12 === 0) { onProgress(Math.round((i / totalFrames) * 100), '正在处理帧 ' + (i + 1) + ' / ' + totalFrames); await new Promise((r) => setTimeout(r, 0)); }
    }
    onProgress(99, '帧处理完成,正在组装 AVI(无压缩透明)…');
    blob = buildAviDib(data.w, data.h, fr, bgraFrames, pcm16, numCh, audioRate);
  } else {
    // MJPEG 回退方案(浏览器不支持 WebCodecs 时),播放器可能卡顿
    const jpegFrames: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
      renderFrame(data.ip + i);
      const b = await new Promise<Blob>((res, rej) => canvas.toBlob((x) => (x ? res(x) : rej(new Error('toBlob 失败'))), 'image/jpeg', 0.92));
      jpegFrames.push(new Uint8Array(await b.arrayBuffer()));
      if (i % 12 === 0) { onProgress(Math.round((i / totalFrames) * 100), '正在处理帧 ' + (i + 1) + ' / ' + totalFrames); await new Promise((r) => setTimeout(r, 0)); }
    }
    onProgress(99, '帧处理完成,正在组装 AVI…');
    blob = buildAviMjpeg(data.w, data.h, fr, jpegFrames, pcm16, numCh, audioRate);
  }

  onProgress(100, 'AVI 组装完成,正在下载…');
  downloadBlob(blob, mode === 'dib' ? 'animation_transparent.avi' : 'animation.avi');
}

/* H.264 编码 AVI(非透明):与 MP4 同款 WebCodecs 编码,PotPlayer/VLC 可硬解,
 * 无 MJPEG 的色度毛边问题。strf 附加 avcC,帧数据为 AVCC 长度前缀格式。 */
async function exportVideoAviH264(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void) {
  if (!WebVideoEncoder || !WebVideoFrame) throw new Error('当前浏览器不支持 H.264 编码(请用 Chrome/Edge)');
  const { pcm16, numCh, audioRate } = await buildPcm16(data, totalFrames, fr);
  const w = data.w, h = data.h;

  const frames: { data: Uint8Array<ArrayBuffer>; key: boolean }[] = [];
  let avcC: Uint8Array<ArrayBuffer> | null = null;
  const encoder = new WebVideoEncoder({
    output: (chunk: any, meta: any) => {
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer);
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      frames.push({ data: buf, key: chunk.type === 'key' });
    },
    error: (e: any) => { throw e; },
  });
  encoder.configure({ codec: 'avc1.64002a', width: w, height: h, bitrate: 30_000_000, framerate: fr });

  for (let i = 0; i < totalFrames; i++) {
    if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
    renderFrame(data.ip + i);
    const frame = new WebVideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fr), duration: Math.round(1e6 / fr) });
    encoder.encode(frame, { keyFrame: i % 60 === 0 });
    frame.close();
    if (i % 12 === 0) { onProgress(Math.round((i / totalFrames) * 100), '正在编码帧 ' + (i + 1) + ' / ' + totalFrames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await encoder.flush();
  encoder.close();
  if (!avcC) throw new Error('未能获取 H.264 解码配置(avcC)');

  onProgress(99, '帧编码完成,正在组装 AVI(H.264)…');
  const blob = buildAvi(w, h, fr, 'H264', h264Strf(w, h, avcC), '00dc', frames.map((f) => f.data), pcm16, numCh, audioRate, frames.map((f) => f.key));
  onProgress(100, 'AVI 组装完成,正在下载…');
  downloadBlob(blob, 'animation.avi');
}

async function exportVideo() {
  if (exporting || !currentData) return;
  exporting = true;
  btnExport.disabled = true;
  const data = currentData;
  // 透明背景不支持 MP4:勾选透明时无论格式选择如何,一律自动导出 AVI
  const wantTransparent = chkTransparent.checked;
  const format = wantTransparent ? 'avi' : selFormat.value;
  const w = data.w, h = data.h;
  const fr = data.fr || 60;
  const totalFrames = Math.round((data.op ?? 0) - (data.ip ?? 0));
  const formatLabel = format === 'avi'
    ? (wantTransparent ? 'AVI · 无压缩透明' : 'AVI · H.264')
    : 'MP4 · H.264';
  const warn = wantTransparent
    ? '透明 AVI 为无压缩编码,预计文件约 ' + fmtSize(w * h * 4 * totalFrames) + '。注意:视频播放器(PotPlayer/WMP/VLC)播放时不合成 alpha 通道,半透明组件会显示为不透明——这是所有带透明视频的通性,请在剪映/AE/Premiere 中导入验证。导出期间请勿关闭页面。'
    : undefined;
  showExportOverlay({ formatLabel, warn });
  updateExportProgress(0, '正在初始化渲染器…', '');
  let container: HTMLDivElement | null = null;
  let renderAnim: AnimationItem | null = null;
  try {
    setStatus(wantTransparent
      ? '导出中: 已选透明背景,自动导出 AVI…'
      : '导出中: 初始化渲染器…');
    container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:' + h + 'px;';
    document.body.appendChild(container);
    renderAnim = lottie.loadAnimation({
      container,
      renderer: 'canvas',
      rendererSettings: { dpr: 1 },
      loop: false,
      autoplay: false,
      animationData: data,
      audioFactory,
    });
    patchCanvasRendererTree((renderAnim as any).renderer);
    // 修复 Canvas 渲染器 getElementById 扫描到未构建元素时报错的问题
    (renderAnim.renderer as any).getElementById = function (id: number) {
      const els = (this as any).elements || [];
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el && el.data && el.data.ind === id) return el;
      }
      return null;
    };
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('无法创建渲染画布');
    // 导出背景:MP4 / AVI(未勾选透明)都使用当前选择的背景色;透明背景不填充
    const bg: string | null = wantTransparent ? null : bgColor.value;
    let outCanvas: HTMLCanvasElement | null = null;
    let octx: CanvasRenderingContext2D | null = null;
    if (bg) {
      outCanvas = document.createElement('canvas');
      outCanvas.width = w;
      outCanvas.height = h;
      octx = outCanvas.getContext('2d');
      if (!octx) throw new Error('无法创建导出画布');
    }
    const renderFrame = (n: number) => {
      (renderAnim as any).renderer.renderFrame(n, true);
      // 动画画布保持透明,背景通过合成画布垫在下方,避免破坏轨道遮罩合成
      if (octx && outCanvas) {
        octx.fillStyle = bg as string;
        octx.fillRect(0, 0, w, h);
        octx.drawImage(canvas, 0, 0);
      }
    };
    const srcCanvas = outCanvas ?? canvas;

    if (format === 'avi') {
      if (wantTransparent) {
        await exportVideoAvi(data, srcCanvas, renderFrame, totalFrames, fr, (p, detail) => {
          updateExportProgress(p, '正在导出透明 AVI(无压缩)', detail ?? '');
          setStatus('导出透明 AVI(无压缩): ' + p + '%');
        }, 'dib');
      } else if (WebVideoEncoder && WebVideoFrame) {
        await exportVideoAviH264(data, srcCanvas, renderFrame, totalFrames, fr, (p, detail) => {
          updateExportProgress(p, '正在导出 AVI(H.264)', detail ?? '');
          setStatus('导出 AVI(H.264): ' + p + '%');
        });
      } else {
        await exportVideoAvi(data, srcCanvas, renderFrame, totalFrames, fr, (p, detail) => {
          updateExportProgress(p, '正在导出 AVI(MJPEG 回退)', detail ?? '');
          setStatus('导出 AVI(MJPEG): ' + p + '%');
        }, 'mjpeg');
      }
    } else {
      await exportVideoMp4(data, srcCanvas, renderFrame, totalFrames, fr, (p, detail) => {
        updateExportProgress(p, '正在导出 MP4(H.264)', detail ?? '');
        setStatus('导出 MP4: ' + p + '%');
      });
    }
    finishExportOverlay('done', '导出完成 ✓', '文件已开始下载');
    setStatus('导出完成');
  } catch (e) {
    if (e instanceof ExportCancelledError) {
      finishExportOverlay('cancel', '已取消导出', '未生成文件');
      setStatus('导出已取消');
    } else {
      console.error('[导出错误]', (e as Error).stack || e);
      finishExportOverlay('error', '导出失败', (e as Error).message);
      setStatus('导出失败: ' + (e as Error).message, true);
    }
  } finally {
    if (renderAnim) { try { renderAnim.destroy(); } catch { /* ignore */ } }
    if (container) container.remove();
    exporting = false;
    btnExport.disabled = false;
  }
}

btnExport.addEventListener('click', exportVideo);


if (bootAnimation) {
  void loadData(bootAnimation, 'animation_data.json');
}

