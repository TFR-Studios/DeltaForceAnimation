/*
 * 三角洲行动 HUD 动画编辑器 —— 纯静态前端(无后端),Vite + TypeScript + lottie-web。
 * 本文件是整个应用的入口与主逻辑(约 5.7k 行),按区块推进,建议按下面的顺序建立全局图景。
 *
 * 素材打包:动画 JSON、字体、音效、PNG 序列全部作为「静态资源」进产物 ——
 *   JSON 用 ?url 按需 fetch(避免首屏拖十几 MB 的 chunk);字体用 new URL(字面量, import.meta.url);
 *   图片序列用 import.meta.glob({ eager: true, query: '?url' })。Bodymovin 内嵌的 TTF 已剥离为
 *   animations/animation_1/fonts/ 下的共享文件,由本文件在运行时注册(否则只有装过该字体的机器显示正常)。
 *
 * 渲染管线:lottie-web 两套渲染器(SVG / Canvas)可切换,渲染器在构造时确定,切换即整段重建。
 *   本文件在渲染器树上打三类补丁(见各 patch 区块):
 *   Canvas 文字兜底(数据里没有 chars 字形轮廓,只能改用原生 fillText 绘制)、
 *   图片序列驱动(逐帧换 src / <image> href,并强制 lottie 重绘,否则静态层画过一次就不再更新)、
 *   叠加序列调色(feColorMatrix 做 colorize,滤镜宿主挂在 body 的隐藏 svg 上,预览与导出共用)。
 *
 * 五套动画(ANIMATIONS,按需加载):撤离动画(1920×1080)、位置暴露动画(画布加宽为 3840×1080,
 *   可把「二次扫描」第二段合并进同一条时间轴)、核电站功率动画(两条 359 帧透明序列叠加)、
 *   任务弹窗动画(1920×1080,自带一枚货币图标,可在「图标选择」里替换/上传并调不透明度)、
 *   地图标题动画(宽画布 2560×1024,纯文字 + 形状的「地图名称 / 地图地点」标题卡,
 *   文字左对齐、底框与描边随文字宽度自适应)。
 *
 * 编辑面板(所有编辑都是就地改渲染用的 JSON,再走 reRenderPreservingState() 单飞重建并恢复播放位置):
 *   • 文字 / 形状 / 图片图层列表 —— 顶层与被引用的预合成(assets[] 里的合成)内部都列出,预合成项名字带「合成名 ›」前缀;
 *     预合成内部的 ind 会和顶层撞号,载入时统一平移到独立号段(见 normalizePrecompInds);
 *   • 主题颜色 —— 两个色块把「默认填充色 / 描边默认色」两族颜色值整族替换(按颜色值匹配,填充与描边一起换);
 *   • 图标替换(位置暴露两段可分别设置;任务弹窗动画单图标位)、图标不透明度、弹窗叠加层、动画时长(1–10s)与二次扫描时长;
 *   • 占位色不作为编辑项展示:纯红填充 #ff0000、纯白描边 #ffffff、预合成里的紫色描边 #5400ff(判据见 hideShapeFill / hideShapeStroke)。
 *
 * 导出管线:逐帧 renderer.renderFrame(n, true) 渲染 → WebCodecs H.264 编码 → mp4-muxer 封装 MP4;
 *   需要透明时走自封装 AVI(无压缩 BGRA + 预乘 alpha);浏览器不支持 WebCodecs 时回退 MJPEG AVI;
 *   个别 Canvas 画不出的效果会自动改走 SVG 逐帧光栅化导出。导出实例与预览实例完全隔离。
*/
import lottie, { type AnimationItem } from 'lottie-web';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import './style.css';

/* 音效资源:独立小文件(?url 打包为静态资源),不进入大体积动画数据 chunk */
import bundledAudioUrl from '../animations/animation_1/gunmuchenggong.mp3?url';
import exposedAudioUrl from '../animations/animation_2/UI_C201_Energy_Scout_Bow_Scout_02.wav?url';
/* 核电站功率动画音效(48kHz 立体声,约 6.0s,与 359 帧 @60fps 基本等长) */
import blindsAudioUrl from '../animations/animation_3/反应堆音效.wav?url';

/* 共享字体资源的静态地址。
 * 不要写成 import ... from '*.ttf?url':Vite 7 的 dev server 对「模块请求 + ?url」
 * 返回的是一段 JS 模块(约 440 字节)而不是字体字节,运行时 fetch 到的内容不对,
 * FontFace 会抛 "Invalid font data in ArrayBuffer" 并被 catch 吞掉,字体注册静默失败,
 * 结果只剩「本机装过该字体」的人能看对。
 *
 * 这里用 new URL('字面量', import.meta.url):dev 下直接解析为源文件地址,
 * build 下由 Vite 静态分析后输出带 hash 的静态资源。两个写法上的硬约束:
 *  1) 路径必须是字符串字面量,且 new URL 的调用要直接写在 new 表达式里 ——
 *     包进普通函数(如 assetUrl(path))Vite 就无法静态分析,build 阶段不会产出字体
 *     文件,产物里会残留 '../animations/animation_1/fonts/*.ttf' 这种源码相对路径,build 后 404;
 *  2) 用相对路径而非 '/xxx' 绝对路径,部署到子路径时同样可用。 */
const FONT_MEDIUM_URL = new URL('../animations/animation_1/fonts/ProjectDType-Medium.ttf', import.meta.url).href;
const FONT_CURVE_URL = new URL('../animations/animation_1/fonts/ProjectDTypeCurve-Bold.ttf', import.meta.url).href;

/* 同一字体的 WOFF2 版本:仅供「SVG 逐帧光栅化导出」内联使用(体积约为 TTF 的一半,
 * 每帧都要重新解析一次内联字体,所以这里省下的是实打实的导出时间)。 */
const FONT_MEDIUM_WOFF2_URL = new URL('../animations/animation_1/fonts/ProjectDType-Medium.woff2', import.meta.url).href;
const FONT_CURVE_WOFF2_URL = new URL('../animations/animation_1/fonts/ProjectDTypeCurve-Bold.woff2', import.meta.url).href;

/* ---------- 启动加载界面 ----------
 * #app-loading 的样式是内联在 index.html 中的(不依赖本文件 import 的 style.css),
 * 因此在样式表加载完成前即可渲染显示;本模块在 import 到 style.css 之后执行,
 * 代表样式已就绪,这里启动块状进度条动画。
 * 进度推进到接近完成时停滞等待;主动画首次 ready 后(符号 flag)快速冲到 100%,
 * 走到 100% 才淡出并移除加载界面(真正做到"进度条走满再进入网站")。 */
// appLoadingHidden:加载界面是否已进入淡出流程 —— hideAppLoading 在多处分支被调用,这里做重入保护
let appLoadingHidden = false;
let appLoadingReady = false; // 主动画已就绪,允许进度条收尾到 100%

/* 把百分比进度画到加载界面上:pct 取 0..100(#ldPct 显示四舍五入后的整数百分比)。
 * #ldBar 里是 22 个 <i> 方块,按比例点亮前 on 个;方块总数用 children.length 动态取,
 * 这样改 index.html 里的方块数量不会与本文件写死的数字失配。 */
function renderLoadingPct(pct: number) {
  const bar = document.getElementById('ldBar');
  const pctEl = document.getElementById('ldPct');
  if (bar) {
    const on = Math.round((Math.min(100, pct) / 100) * (bar.children.length || 1));
    for (let i = 0; i < bar.children.length; i++) bar.children[i].classList.toggle('on', i < on);
  }
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
}

function finishAppLoading() {
  appLoadingReady = true;
}

/* 淡出并移除启动加载界面:pct 参数先把进度条补画到指定值(默认 100),再挂 .is-hidden 触发 CSS 过渡。
 * 500ms 后 remove() 与 style.css 里 #app-loading 的过渡时长对应,提前移除会打断淡出。 */
// appLoadingHidden 保证重复调用只生效一次(多处失败分支都会调它)。
function hideAppLoading(pct = 100) {
  if (appLoadingHidden) return;
  appLoadingHidden = true;
  renderLoadingPct(pct);
  const el = document.getElementById('app-loading');
  if (el) {
    el.classList.add('is-hidden');
    /* 顶栏「制作声明」徽标的入场动效触发点:加载界面开始淡出的同一刻。
     * 用 <html> 上的常驻 class(而不是 #app-loading 的兄弟选择器):该节点 500ms 后会被移除,
     * 挂在它身上的选择器一旦失配,尚未播完的动效会被立刻打断。 */
    document.documentElement.classList.add('craft-ready');
    window.setTimeout(() => el.remove(), 500);
  }
}

/* 块状进度条的自走逻辑(立即执行的 IIFE,不等任何数据)。
 * step 的单位是百分比,每 70ms 推进一次:
 *  • 未就绪时最多停在 96%:留出最后一段;60% 之后从 +2 降速到 +1,让「快满却还没满」更接近真实加载;
 *  • 主动画 ready 后(appLoadingReady)每 tick +4 快速冲线,走到 100% 才 hideAppLoading,
 *    保证「进度条走满再进入网站」,不会出现进度条没走完页面就消失。 */
(function startLoadingProgress() {
  const bar = document.getElementById('ldBar');
  if (!bar) return;
  const blocks = 22;
  for (let i = 0; i < blocks; i++) bar.appendChild(document.createElement('i'));
  let step = 0;
  const timer = window.setInterval(() => {
    if (appLoadingReady) {
      step += 4; // 就绪后快速冲过最后一段
    } else {
      // 未就绪:推进到 96% 附近停滞等待,不提前放行
      step = Math.min(96, step + (step >= 60 ? 1 : 2));
    }
    if (step >= 100) {
      renderLoadingPct(100);
      window.clearInterval(timer);
      window.setTimeout(() => hideAppLoading(100), 250);
      return;
    }
    renderLoadingPct(step);
  }, 70);
})();

/* 音效播放音量(0-1):预览与导出统一使用,调低以避免音效过响 */
const AUDIO_VOLUME = 0.3;

/* ---------- 音频工厂 ----------
 * lottie-web 默认依赖 window.Howl(howler.js);没有 Howl 时它会返回一个缺 pause/volume
 * 方法的桩对象,一旦动画 pause/stop 就会抛 "this.audio.pause is not a function"。
 * 这里注入基于原生 HTMLAudioElement 的工厂:既修掉崩溃,又能真正播放 JSON 内嵌的音频。
 * 同时处理浏览器自动播放策略:动画 autoplay 触发的 play() 在无用户手势时会被拦截,
 * 这里在首次用户交互(点击/按键)时自动重试,保证用户一定能听到音效。
 */
/* 音频元素缓存:同一资源只创建一个 Audio 元素并复用。
 * 每次重建动画(lottie 会为每个音频层新建 Audio 元素)都会发起新请求,
 * 旧元素被 GC 时若请求仍在进行会中止加载,控制台报 net::ERR_ABORTED。
 * 元素常驻缓存不会被回收,既消除该报错,也避免重复请求。 */
const audioElCache = new Map<string, HTMLAudioElement>();

/* 音频控制器工厂:lottie-web 要求 audioFactory(assetPath) 返回带
 * play/pause/seek/playing/rate/volume 的对象,并且会为每个音频层各调用一次,
 * 所以必须返回独立的控制器闭包 —— wantPlay / retryHandler 是每个音频层各自的状态,不能复用同一对象。
 * el.src 每次赋值是幂等的(值相同不会重新发起请求),所以放心直写。 */
const audioFactory = (assetPath: string) => {
  let el = audioElCache.get(assetPath);
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    audioElCache.set(assetPath, el);
  }
  el.src = assetPath; // 同值赋值是幂等操作,不会重新发起加载
  let wantPlay = false; // lottie 期望该音频处于播放状态
  let retryHandler: (() => void) | null = null;

  // play() 只有较新的浏览器才返回 Promise;返回 undefined 时无从得知是否被自动播放策略拦截
  const tryPlay = () => {
    const p = el.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch((e: any) => {
        // 自动播放被浏览器拦截:等待首次用户交互后重试(仅当 lottie 仍期望播放时)
        if (e && e.name === 'NotAllowedError' && wantPlay && !retryHandler) {
          console.warn('[AUDIO] 自动播放被浏览器拦截,等待用户交互后重试');
          const onGesture = () => {
            window.removeEventListener('pointerdown', onGesture);
            window.removeEventListener('keydown', onGesture);
            retryHandler = null;
            // 延迟到点击事件处理完成后:若点击的是播放按钮(会暂停动画),此时 wantPlay 已为 false,跳过重试避免"开始又立即暂停"
            window.setTimeout(() => { if (wantPlay) tryPlay(); }, 0);
          };
          retryHandler = onGesture;
          window.addEventListener('pointerdown', onGesture, { once: true });
          window.addEventListener('keydown', onGesture, { once: true });
        }
      });
    }
  };

  const setVolume = (v?: number) => { if (v !== undefined) el.volume = v; };
  return {
    play: () => { wantPlay = true; tryPlay(); },
    pause: () => { wantPlay = false; el.pause(); },
    seek: (t?: number) => { if (t !== undefined) el.currentTime = t; return el.currentTime; },
    playing: () => !el.paused && !el.ended,
    rate: (r?: number) => { if (r !== undefined) el.playbackRate = r; },
    volume: setVolume, // 运行时实际调用
    setVolume, // 类型声明要求
  };
};

/* ④ 声音优先加载:页面启动即预载两套音效(文件很小),音频请求先于大体积
 * 动画数据包发出;配合「数据按需加载」,用户触发播放时音效已就绪(不再卡顿)。 */
function prefetchAudios() {
  audioFactory(bundledAudioUrl);
  audioFactory(exposedAudioUrl);
}
void prefetchAudios();

/* 在 lottie 的 AnimationItem.destroy 中先暂停音频:
 * 动画销毁(切换/重建/导出结束)时 lottie 不会暂停音频层,若不处理,
 * 缓存的音频元素会继续播放,切换到其他动画时会出现声音重叠。 */
let audioDestroyPatched = false;
/* 在原型上打一次补丁即可对所有 lottie 实例生效(audioDestroyPatched 做幂等保护)。
 * destroy() 内部可能因异常提前中断,所以 pause 包在 try 里,避免补丁把销毁流程带崩。 */
function patchAudioDestroy(animItem: any) {
  if (audioDestroyPatched || !animItem) return;
  const proto = animItem.constructor && animItem.constructor.prototype;
  if (!proto || typeof proto.destroy !== 'function') return;
  const orig = proto.destroy;
  proto.destroy = function (this: any, name?: string) {
    try {
      if (this.audioController && typeof this.audioController.pause === 'function') this.audioController.pause();
    } catch { /* ignore */ }
    return orig.call(this, name);
  };
  audioDestroyPatched = true;
}

/* ---------- 字体预加载 ----------
 * Bodymovin 可把 TTF 以 base64 内嵌在 fonts.list[].fPath 中;为减小数据包体积,
 * 各动画 JSON 内的字体已剥离为仓库唯一的共享字体文件(animations/animation_1/fonts/)。
 * 因此必须由站点自己把字体注册给浏览器,否则只有「本机装过该字体」的人才能看到
 * 正确字形,其他人会静默回退到系统默认字体。
 *
 * 三条硬性要求(每条都踩过坑):
 *  1) URL 必须是真正的静态资源地址:用 new URL(..., import.meta.url) 而不是
 *     '*.ttf?url' 导入 —— Vite 7 dev 下后者返回 JS 模块,见文件顶部 FONT_*_URL 注释;
 *  2) 不能因为「系统里已有同名 family」就跳过注册:document.fonts.check() 对本机
 *     安装的字体同样返回 true,早期版本据此提前 return,于是网页实际用的是本机那份
 *     字体,而没装字体的机器上注册永不发生(这正是「只有作者电脑显示正常」的原因)。
 *     同名 @font-face 会覆盖系统字体,所以无条件注册才能保证各机器字形一致;
 *  3) 拿到的字节必须先校验字体魔数:服务器 MIME/中间层返回错误内容时,FontFace 会抛
 *     "Invalid font data in ArrayBuffer",要尽早发现并说明,而不是静默降级。
 */
/* 已成功注册到 document.fonts 的 family 集合:只记成功项,失败的不入集合,
 * 之后再遇到同名 family 仍会重试一次注册。 */
const loadedFontFamilies = new Set<string>();

/* 绑定字体 TTF 资源(与 JSON 中被剥离的 fPath 一一对应) */
const BUNDLED_FONT_URLS = {
  medium: FONT_MEDIUM_URL,
  curve: FONT_CURVE_URL,
};

/* 动画 JSON 中出现的 name/family → 绑定字体文件。
 * 中英文名都登记:不同导出模板里 fFamily 可能是 'ProjectD Type'(带空格)、
 * 'ProjectDType-Medium'(PostScript 名)或 '战术体 Medium'(字体内部中文名)。 */
const EXTERNAL_FONT_URLS: Record<string, string> = {
  'ProjectD Type': BUNDLED_FONT_URLS.medium,
  'ProjectD Type Medium': BUNDLED_FONT_URLS.medium,
  'ProjectDType-Medium': BUNDLED_FONT_URLS.medium,
  '战术体': BUNDLED_FONT_URLS.medium,
  '战术体 Medium': BUNDLED_FONT_URLS.medium,
  'ProjectD Type Curve': BUNDLED_FONT_URLS.curve,
  'ProjectD Type Curve Bold': BUNDLED_FONT_URLS.curve,
  'ProjectDTypeCurve-Bold': BUNDLED_FONT_URLS.curve,
  '战术粗体': BUNDLED_FONT_URLS.curve,
  '战术粗体 Bold': BUNDLED_FONT_URLS.curve,
};
/* 归一化索引(小写 + 去空格/连字符/下划线),让 'ProjectDType-Medium' 与
 * 'ProjectD TypeMedium' 之类的写法也能命中,避免只靠硬编码字面量匹配。 */
const EXTERNAL_FONT_URLS_NORM: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
  for (const [k, v] of Object.entries(EXTERNAL_FONT_URLS)) out[norm(k)] = v;
  return out;
})();

/* 与 EXTERNAL_FONT_URLS 同键,只是指向 WOFF2 版本(键→URL 的映射由下面的表自动生成) */
const EXTERNAL_FONT_WOFF2: Record<string, string> = {};
for (const [key, url] of Object.entries(EXTERNAL_FONT_URLS)) {
  EXTERNAL_FONT_WOFF2[key] = url === FONT_CURVE_URL ? FONT_CURVE_WOFF2_URL : FONT_MEDIUM_WOFF2_URL;
}
const EXTERNAL_FONT_WOFF2_NORM: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
  for (const [k, v] of Object.entries(EXTERNAL_FONT_WOFF2)) out[norm(k)] = v;
  return out;
})();

/* 按 JSON 里出现的字体名查对应的 WOFF2 地址(可传 fFamily / fName 多个候选,依次尝试);
 * 都命中不了返回空串,调用方以此为「该字体没有绑定资源」的判定依据。 */
function resolveFontWoff2Url(...names: (string | undefined)[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
  for (const n of names) {
    if (!n) continue;
    const hit = EXTERNAL_FONT_WOFF2[n] ?? EXTERNAL_FONT_WOFF2_NORM[norm(n)];
    if (hit) return hit;
  }
  return '';
}

// 与 resolveFontWoff2Url 同规则,只是返回 TTF 地址(预览与 Canvas 渲染用 TTF,内联光栅化导出用 WOFF2)
function resolveFontUrl(...names: (string | undefined)[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
  for (const n of names) {
    if (!n) continue;
    const hit = EXTERNAL_FONT_URLS[n] ?? EXTERNAL_FONT_URLS_NORM[norm(n)];
    if (hit) return hit;
  }
  return '';
}

/* 同一字体二进制只取一次(内存缓存),供多个 family 名注册 FontFace */
const fontBinaryCache = new Map<string, Promise<ArrayBuffer | null>>();
/* 取字体二进制;同一 URL 只 fetch 一次并缓存 Promise(多个 family 名可共用同一份字节)。
 * 网络失败或非 2xx 一律返回 null 而不抛异常,内容是否可用统一交给 looksLikeFontBuffer 判定。 */
function fetchFontBinary(url: string): Promise<ArrayBuffer | null> {
  let p = fontBinaryCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((resp) => (resp.ok ? resp.arrayBuffer() : null))
      .catch(() => null);
    fontBinaryCache.set(url, p);
  }
  return p;
}

/* 常见字体容器魔数:0x00010000 / 'true' / 'OTTO'(CFF) / 'ttcf'(字体集合)
 * / 'wOFF'(WOFF) / 'wOF2'(WOFF2 —— 栅格化导出内联用的是 WOFF2,少认一个就会静默丢失字体)。 */
function looksLikeFontBuffer(buf: ArrayBuffer | null): buf is ArrayBuffer {
  if (!buf || buf.byteLength < 12) return false;
  const b = new Uint8Array(buf, 0, 4);
  const u32 = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  return (
    u32 === 0x00010000 ||
    u32 === 0x74727565 || // 'true'
    u32 === 0x4f54544f || // 'OTTO'
    u32 === 0x74746366 || // 'ttcf'
    u32 === 0x774f4646 || // 'wOFF'
    u32 === 0x774f4632 // 'wOF2'
  );
}

/* 字体注册结果:updateInfo 用它给出真实状态,而不是拿 JSON 里有没有 fPath 去猜。 */
type FontLoadState = 'pending' | 'ready' | 'failed';
const fontLoadState = new Map<string, FontLoadState>();
/* lastFontWarnings 是「本次载入」的诊断信息:loadEmbeddedFonts 每次开头会清空,
 * 供信息面板展示;addFontWarning 负责去重,避免同一 family 反复刷屏。 */
const lastFontWarnings: string[] = [];
function addFontWarning(msg: string) {
  if (!lastFontWarnings.includes(msg)) lastFontWarnings.push(msg);
}

/* 把一个二进制字体注册成指定 family 的 @font-face。
 * FontFace.load() 只解析与校验,必须 document.fonts.add() 之后才真正参与字体匹配。 */
function registerFontFamily(fam: string, source: ArrayBuffer): Promise<boolean> {
  if (loadedFontFamilies.has(fam)) return Promise.resolve(true);
  return new FontFace(fam, source).load().then((face) => {
    document.fonts.add(face); // 同名 @font-face 优先于系统已装字体,保证各机器字形一致
    loadedFontFamilies.add(fam);
    fontLoadState.set(fam, 'ready');
    return true;
  });
}

/* 为一份动画 JSON 注册它用到的全部字体。fonts.list 每项两种情况:
 *  • 仍有 fPath(旧数据:TTF base64 内嵌在 fPath 里)—— 直接按 CSS url(...) 交给 FontFace;
 *  • fPath 已被剥离 —— 用 resolveFontUrl 查到 animations/animation_1/fonts/ 下的共享文件,取二进制后校验魔数再注册。
 * 查不到 / 魔数不对 / 注册抛错都只记 warning 并标 failed,绝不阻断动画渲染(回退系统字体)。
 * 全部完成后 await document.fonts.ready,保证首帧渲染时字形已经可用;
 * DEV 下把状态挂到 window.__fontDebug,方便确认用的是「本站注册的字体」而不是本机同名系统字体。 */
async function loadEmbeddedFonts(data: any) {
  const list: any[] = data?.fonts?.list ?? [];
  lastFontWarnings.length = 0;
  await Promise.allSettled(
    list.map(async (f: any) => {
      const fPath = typeof f.fPath === 'string' ? f.fPath : '';
      const families: string[] = [];
      if (f.fFamily) families.push(f.fFamily);
      if (f.fName && !families.includes(f.fName)) families.push(f.fName);
      if (!families.length) return;
      for (const fam of families) {
        if (!fontLoadState.has(fam)) fontLoadState.set(fam, 'pending');
      }

      try {
        if (fPath) {
          // 兼容仍把 TTF base64 内嵌在 fPath 里的旧数据
          const face = await new FontFace(families[0], 'url("' + fPath + '")').load();
          document.fonts.add(face);
          for (const fam of families) {
            loadedFontFamilies.add(fam);
            fontLoadState.set(fam, 'ready');
          }
          return;
        }

        const url = resolveFontUrl(f.fFamily, f.fName);
        if (!url) {
          for (const fam of families) fontLoadState.set(fam, 'failed');
          addFontWarning('未找到绑定字体文件: ' + families.join(' / '));
          return;
        }

        const binary = await fetchFontBinary(url);
        if (!looksLikeFontBuffer(binary)) {
          for (const fam of families) fontLoadState.set(fam, 'failed');
          addFontWarning('字体文件内容不是有效字体: ' + families.join(' / '));
          return;
        }

        const results = await Promise.all(
          families.map((fam) =>
            registerFontFamily(fam, binary).catch((e) => {
              fontLoadState.set(fam, 'failed');
              addFontWarning(fam + ' 注册失败: ' + ((e as Error)?.message ?? String(e)));
              return false;
            })
          )
        );
        if (!results.some(Boolean)) return;
      } catch (e) {
        // 字体加载失败时回退系统字体,但不再静默:状态栏/信息面板会说明原因
        for (const fam of families) fontLoadState.set(fam, 'failed');
        addFontWarning(families.join(' / ') + ' 加载失败: ' + ((e as Error)?.message ?? String(e)));
      }
    })
  );
  await document.fonts.ready.catch(() => undefined);
  if (import.meta.env.DEV) {
    // 自检用:确认这些 family 是「本站注册的」,而不是碰巧命中本机安装的同名字体
    (window as any).__fontDebug = {
      bundledOnly: new Set(loadedFontFamilies),
      states: new Map(fontLoadState),
      warnings: lastFontWarnings.slice(),
    };
  }
}

/* ---------- Canvas 渲染器文字兜底 ----------
 * lottie-web 的 Canvas 文字渲染依赖字体轮廓数据(chars);本动画的 JSON 只内嵌了
 * TTF 字体文件(fPath)而没有 chars,导致 Font.getCharData 抛异常、整帧绘制被中断
 * (画布空白)。这里把 Canvas 文字元素的 renderInnerContent 换成原生 fillText 绘制:
 * 保留 lottie 的逐字母动画(位置/透明度/颜色/描边),字形交给浏览器文本引擎。
 * 通过包装 buildItem 递归覆盖预合成内部的文字层。
 */
/* 用原生 Canvas 文字绘制替换 lottie 的 Canvas 文字渲染。
 * 为什么必须换:Canvas 渲染器的文字依赖 JSON 里的 chars 字形轮廓,而本项目的数据没有携带,
 * lottie 会在 Font.getCharData 处抛异常并中断整个 renderFrame(表现是画布整块空白)。
 * 替换后保留 lottie 的逐字母动画(位置矩阵 / 透明度 / 颜色 / 描边),只把「画字形」交给浏览器文本引擎。
 * 注意:必须自己把 renderer.contextData(appliedFillStyle 等)与原生 ctx 的状态一起同步,
 * 否则 lottie 的状态缓存与实际 ctx 不一致,后续元素会沿用错误的填充/描边。 */
function patchCanvasTextElement(el: any) {
  const buildRgba = (c: number[] | undefined): string =>
    !c ? 'rgba(0,0,0,0)' : 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';

  /* 两条绘制路径:doc.l 存在(有逐字母数据)→ 逐字母绘制;否则(如 singleShape)整段逐行绘制。
   * doc 是 lottie 的文字属性当前值:finalSize 单位 px(已含缩放,不要再乘 globalData 的缩放),
   * tr 是字距(AE tracking,单位 1/1000 em),j 是对齐(0=左 / 1=右 / 2=居中)。 */
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
    // finalSize 已是最终像素字号;family 取 JSON 声明的 fFamily,查不到就退回 doc.f 或 sans-serif
    ctx.font = doc.finalSize + 'px ' + family;

    const letters = Array.isArray(doc.l) ? doc.l : null;
    const renderedLetters = letters
      ? ((!this.data.singleShape && this.textAnimator.getMeasures(doc, this.lettersChangedFlag)),
        this.textAnimator.renderedLetters || [])
      : [];
    const canPerLetter = !!(letters && renderedLetters.length > 0);
    /* 是否需要我们「自己重算」逐字母 advance:只有当 lottie 拿不到字形数据时才需要。
     * JSON 内嵌了 chars 的动画(地图标题动画 chars=5、任务弹窗动画 chars=13)lottie 会按
     * 字形轮廓算出正确的 letters[i].l(l 即该字的前进宽度),此时 renderedLetters 的 p[12]
     * 已经是正确间距;再补偿一次等于把字距翻倍 —— 表现为文字被撑到画布外(地图标题动画
     * 实测:文字宽度由 347 → 约 694 合成单位,盖过底框并被画布裁掉)。
     * 反之 chars 为空的动画(撤离/位置暴露/核电站)l 恒为 0,p[12] 只剩 tracking,必须补偿。
     * 同一条文字里 l 要么全有要么全无,所以判定放在循环外即可。 */
    const advanceMissing = !!letters && letters.some((lt: any) => !lt.n && !lt.l);
    if (canPerLetter) {
      // 逐字母绘制:复用 lottie 文字动画器的逐字母矩阵/透明度/颜色。
      // 注意:字形数据缺失时 lottie 计算的逐字母 advance(letters[i].l)为 0,
      // renderedLetters 的 x 偏移只剩 tracking,导致字形全部重叠。
      // 这里用真实字体的 measureText 重算每字母位置,修正 rl.p 的 tx;
      // 修正量 = 正确布局 - lottie 的(错误)布局,因此动画器偏移得以保留。
      // tracking 换算:AE 的 tr 单位是 1/1000 em,乘字号得到像素间距
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
      // AE 对齐方式 j:0=左(不偏移)、1=右(整行左移一个行宽)、2=居中(左移半个行宽)
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
        const dx = advanceMissing ? (xPos + justifyX(ln) - (xPosBroken + justifyXBroken(ln))) : 0;
        renderer.save();
        // rl.p 是 16 元素变换矩阵(列主序),p[12]/p[13] 是平移分量;复制一份再改,避免污染 lottie 缓存的矩阵
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
      // Bodymovin 用 \r 作换行符(不是 \n),按它切行才能与 AE 里的行结构一致
      const lines = text.split('\r');
      // 行距优先用数据里的 yOffset;缺省按 1.2 倍字号估算(常见默认行高)
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

/* 给 Canvas 渲染器树补丁:文字兜底 + 图片序列 + 投影效果,两个入口缺一不可:
 *  • 遍历当前已构建的 elements —— loadAnimation 可能已经同步建好了元素;
 *  • 包装 renderer.buildItem —— 元素是懒构建的,首次渲染才创建,只能靠包装覆盖后来出现的元素。
 * ty===0 的预合成递归下钻;__lottieFallbackPatched 标记保证每个元素只补一次。
 * exportMode 会透传给序列层的 canvas 补丁:导出走「导出专用图片」而不是预览双缓冲。 */
function patchCanvasRendererTree(renderer: any, exportMode = false) {
  // loadAnimation 可能已同步构建元素,patch 需要对已构建元素立即生效
  for (const el of renderer.elements ?? []) {
    if (el && el.data && !el.__lottieFallbackPatched) {
      el.__lottieFallbackPatched = true;
      // 图层类型 ty:0=预合成、1=实心、2=图片、3=空对象、4=形状、5=文字;这里只处理 5 / 2 / 0
      if (el.data.ty === 5) patchCanvasTextElement(el);
      else if (el.data.ty === 2 && seqEntryByInd.get(el.data.ind)) {
        el.__seqUseExport = exportMode;
        patchSeqCanvasElement(el, seqEntryByInd.get(el.data.ind) as SeqEntry);
      } else if (el.data.ty === 0 && typeof el.buildItem === 'function') {
        patchCanvasRendererTree(el, exportMode); // 预合成内
      }
      if (getDropShadow(el.data)) patchCanvasDropShadow(el);
    }
  }
  const origBuild = renderer.buildItem.bind(renderer);
  renderer.buildItem = function (this: any, pos: number) {
    origBuild(pos);
    const el = this.elements[pos];
    if (!el || el.__lottieFallbackPatched) return;
    el.__lottieFallbackPatched = true;
    if (el.data && el.data.ty === 5) {
      patchCanvasTextElement(el);
    } else if (el.data && el.data.ty === 2 && seqEntryByInd.get(el.data.ind)) {
      el.__seqUseExport = exportMode;
      patchSeqCanvasElement(el, seqEntryByInd.get(el.data.ind) as SeqEntry);
    } else if (el.data && el.data.ty === 0 && typeof el.buildItem === 'function') {
      // 注意:预合成内层递归没有透传 exportMode(取默认 false),嵌套的序列层按预览路径处理
      patchCanvasRendererTree(el); // 预合成内的文字层
    }
    if (el.data && getDropShadow(el.data)) patchCanvasDropShadow(el);
  };
}

/* ---------- 图片序列支持 ----------
 * 动画 JSON 中带 ks.src 关键帧的图片图层为"图像序列"层(如 ccreptile):
 * lottie-web 不原生支持逐帧切换 asset,这里在渲染管线中驱动:
 * - canvas 渲染器:绘制前把元素的 img 切换为当前帧图片(双缓冲预加载);
 * - SVG 渲染器:逐帧切换 <image> 的 href(浏览器图片缓存保证即时显示);
 * - 导出:在渲染帧前 await 解码,保证帧内容完整。 */
/* urls 是按帧号稠密排列的数组(索引 = 帧号),没有关键帧的帧位填空串;
 * seqFrameUrl 遇到空串会回退到第 0 帧,所以序列首帧应当始终存在。 */
type SeqEntry = { ind: number; nm: string; urls: string[] };
let seqEntries: SeqEntry[] = [];
const seqEntryByInd = new Map<number, SeqEntry>();
const seqExportImages = new Map<number, HTMLImageElement>(); // 序列图层 ind → 导出专用图片

/* 从动画 JSON 里挑出「图像序列」层并建索引,供渲染期逐帧取图。
 * 识别条件:ty===2(图片层)且 ks.src 是长度 ≥2 的关键帧数组(只有一帧不算序列)。
 * 关键帧的 s 里放的是 asset id,要用它在 data.assets 里查到真正的 p(图片 URL),
 * 再按 round(kf.t)(帧号取整)填进帧号索引数组 urls。
 * 只扫描顶层 data.layers —— 现有数据的序列层都在顶层。 */
function setupImageSequence(data: any) {
  seqEntries = [];
  seqEntryByInd.clear();
  seqExportImages.clear();
  if (!data) return;
  for (const l of data.layers ?? []) {
    const src = l.ty === 2 && l.ks && l.ks.src;
    if (!src || !Array.isArray(src.k) || src.k.length < 2) continue;
    const byFrame = new Map<number, string>();
    for (const kf of src.k as any[]) {
      const id = Array.isArray(kf.s) ? kf.s[0] : kf.s;
      const a = (data.assets ?? []).find((x: any) => x.id === id);
      if (a && typeof a.p === 'string') byFrame.set(Math.round(kf.t), a.p);
    }
    if (byFrame.size < 2) continue;
    const maxF = Math.max(...byFrame.keys());
    const urls = new Array(maxF + 1).fill('');
    for (const [f, u] of byFrame) urls[f] = u;
    const entry: SeqEntry = { ind: l.ind, nm: String(l.nm ?? ''), urls };
    seqEntries.push(entry);
    seqEntryByInd.set(l.ind, entry);
    seqExportImages.set(l.ind, new Image());
  }
}

/* 取某帧对应的图片 URL:帧号四舍五入后夹到 [0, len-1](负帧与越界都用边界帧),
 * 该帧位是空串时退回第 0 帧,保证永远返回一个可用 URL。 */
function seqFrameUrl(entry: SeqEntry | undefined, frame: number): string {
  if (!entry || entry.urls.length === 0) return '';
  const f = Math.max(0, Math.min(entry.urls.length - 1, Math.round(frame)));
  return entry.urls[f] || entry.urls[0] || '';
}

/* 可靠的当前全局帧号:canvas 渲染器的 globalData.frameNum 可能因
 * animationItem._isFirstFrame 缺失而为 NaN,改用渲染器的 renderedFrame */
function seqCurrentFrame(globalData: any): number {
  const r = globalData && globalData.renderer;
  let v = r && typeof r.renderedFrame === 'number' ? r.renderedFrame : 0;
  if (typeof v !== 'number' || !isFinite(v)) v = globalData && typeof globalData.frameNum === 'number' && isFinite(globalData.frameNum) ? globalData.frameNum : 0;
  return v;
}

/* canvas 元素:在 prepareFrame(每帧无条件调用)中切换图片,不依赖渲染器 _mdf;
 * 当前槽绘制,另一槽预载下一帧。导出模式(__seqUseExport)只挂导出专用图片。
 * 关键:lottie 的 renderFrame 仅在 globalData._mdf 为真时才真正重绘元素——
 * 静态层(变换/透明度不变)画过一次后永不重绘,序列换图不会生效(画面冻结=残影),
 * 所以换图后必须强制 this._mdf / globalData._mdf。 */
function patchSeqCanvasElement(el: any, entry: SeqEntry) {
  // 每条序列各自持有双缓冲图片(一个动画里可以有多条序列),缓冲挂在元素上互不干扰
  if (!el.__seqA) {
    el.__seqA = new Image();
    el.__seqB = new Image();
  }
  const origPrepare = el.prepareFrame ? el.prepareFrame.bind(el) : null;
  if (origPrepare) {
    el.prepareFrame = function (this: any, num: number) {
      let changed = false;
      if (this.__seqUseExport) {
        const exp = seqExportImages.get(this.data?.ind);
        if (exp && this.img !== exp) this.img = exp;
        changed = true; // 导出模式:导出图片内容每帧在变,必须每帧强制重绘
      } else {
        const f = typeof num === 'number' && isFinite(num) ? num : seqCurrentFrame(this.globalData);
        const url = seqFrameUrl(entry, f);
        if (url && this.__seqA && this.__seqB) {
          const mySlot = this.__seqSlot === 1 ? this.__seqB : this.__seqA;
          const other = mySlot === this.__seqA ? this.__seqB : this.__seqA;
          if (mySlot.src !== url) mySlot.src = url;
          if (this.img !== mySlot) { this.img = mySlot; changed = true; }
          const nextUrl = seqFrameUrl(entry, f + 1);
          if (nextUrl && other.src !== nextUrl) other.src = nextUrl;
          this.__seqSlot = this.__seqSlot === 1 ? 0 : 1;
          // 图片是异步解码的:解码完成的这一刻再补渲一次当前帧,避免换成还没解码完的图时画到空白
          mySlot.onload = () => {
            const anim = (window as any).__anim;
            if (anim && anim.isLoaded && anim.renderer) {
              /* renderer.renderFrame 收的是**绝对帧**(lottie 内部会传 currentFrame + firstFrame),
               * 而 anim.currentFrame 是相对帧;ip>0 的动画这里要补回 firstFrame,否则补渲会偏到别的帧。
               * 现有素材 ip 都是 0(且带序列图的动画本就没有 ip>0 的),属于预防性修正。 */
              try { (anim.renderer as any).renderFrame(anim.currentFrame + (anim.firstFrame ?? 0), true); } catch { /* ignore */ }
            }
          };
        }
      }
      const r = origPrepare(num);
      // 换图后强制重绘:lottie 只在 globalData._mdf 时调用元素 renderFrame
      if (changed) {
        this._mdf = true;
        if (this.globalData) this.globalData._mdf = true;
      }
      return r;
    };
  }
  // 兜底:绘制前再次确保图片正确(覆盖 prepareFrame 不可用的路径);绘制时套用序列调色滤镜
  const orig = el.renderInnerContent.bind(el);
  el.renderInnerContent = function (this: any) {
    if (this.__seqUseExport) {
      const exp = seqExportImages.get(this.data?.ind);
      if (exp && this.img !== exp) this.img = exp;
      return withSeqTint(this, orig);
    }
    const f = seqCurrentFrame(this.globalData);
    const url = seqFrameUrl(entry, f);
    if (url && this.__seqA && this.__seqB) {
      const mySlot = this.__seqSlot === 1 ? this.__seqB : this.__seqA;
      if (mySlot.src !== url) mySlot.src = url;
      if (this.img !== mySlot) this.img = mySlot;
    }
    return withSeqTint(this, orig);
  };
}

/* SVG 元素:在 prepareFrame(每帧无条件调用,不依赖渲染器 _mdf)中切换 <image> 的 href */
function patchSeqSvgElement(el: any, entry: SeqEntry) {
  const origPrepare = el.prepareFrame ? el.prepareFrame.bind(el) : null;
  if (!origPrepare) return;
  el.prepareFrame = function (this: any, num: number) {
    const imgEl = this.innerElem || this.imageElem;
    if (imgEl) {
      const f = typeof num === 'number' && isFinite(num) ? num : seqCurrentFrame(this.globalData);
      const url = seqFrameUrl(entry, f);
      const NS = 'http://www.w3.org/1999/xlink';
      if (url && imgEl.getAttributeNS(NS, 'href') !== url) {
        imgEl.setAttributeNS(NS, 'href', url);
        // 预加载下一帧(利用浏览器图片缓存,让 SVG 换图即时显示)
        const nextUrl = seqFrameUrl(entry, f + 1);
        if (nextUrl) {
          if (!this.__seqPre) this.__seqPre = new Image();
          if (this.__seqPre.src !== nextUrl) this.__seqPre.src = nextUrl;
        }
      }
    }
    // 序列调色:给图层 <g> 挂 CSS filter(SVG 元素无法用 canvas 的 ctx.filter)
    applySeqTintToSvg(this);
    return origPrepare(num);
  };
}

/* SVG 渲染器树 patch(图片序列层 + 投影效果) */
function patchSvgRendererTree(renderer: any) {
  // 与 patchCanvasRendererTree 同构:__seqTreePatched 幂等标记 + 包装 buildItem 覆盖懒构建的元素
  if (renderer.__seqTreePatched) return;
  renderer.__seqTreePatched = true;
  // 移除根 <g> 上 Lottie 默认应用的固定尺寸 clipPath(1920×1080),并允许 SVG 溢出,
  // 避免底框随文字变宽后两侧竖条超出合成边界被裁剪(缩放画布时仍可见完整竖条)
  if (renderer.svgElement) {
    const rootG = renderer.layerElement;
    if (rootG && rootG.removeAttribute) rootG.removeAttribute('clip-path');
    renderer.svgElement.style.overflow = 'visible';
    renderer.svgElement.setAttribute('overflow', 'visible');
  }
  // 已构建元素立即应用
  for (const el of renderer.elements ?? []) {
    if (el && el.data && !el.__seqElPatched) {
      el.__seqElPatched = true;
      const seqEntry = el.data.ty === 2 ? seqEntryByInd.get(el.data.ind) : undefined;
      if (seqEntry) patchSeqSvgElement(el, seqEntry);
      else if (el.data.ty === 0 && typeof el.buildItem === 'function') patchSvgRendererTree(el);
      applySeqTintToSvg(el); // 预合成宿主(黑潮爆破的逐帧序列)也要挂调色滤镜
      /* AE 效果补丁:投影与填充都要写 style.filter,统一由 patchSvgDropShadow 合并成一条。
       * 不能只按"有没有投影"来调 —— 只有「填充」没有投影的图层(黑潮爆破的 HUD 底条与提示条)
       * 会因此被整段跳过,表现为"改了颜色画面没反应"。 */
      if (getDropShadow(el.data) || getFillEffect(el.data)) patchSvgDropShadow(el);
    }
  }
  const origBuild = renderer.buildItem.bind(renderer);
  renderer.buildItem = function (this: any, pos: number) {
    origBuild(pos);
    const el = this.elements[pos];
    if (!el || el.__seqElPatched) return;
    el.__seqElPatched = true;
    const seqEntry = el.data && el.data.ty === 2 ? seqEntryByInd.get(el.data.ind) : undefined;
    if (seqEntry) {
      patchSeqSvgElement(el, seqEntry);
    } else if (el.data && el.data.ty === 0 && typeof el.buildItem === 'function') {
      patchSvgRendererTree(el); // 预合成内
    }
    if (el) applySeqTintToSvg(el); // 预合成宿主(黑潮爆破的逐帧序列)也要挂调色滤镜
    if (el.data && (getDropShadow(el.data) || getFillEffect(el.data))) patchSvgDropShadow(el);
  };
}

/* 导出前确保第 n 帧的序列图片已解码(每条序列各自的导出专用图片,与预览隔离) */
/* 逐帧导出前调用:把第 n 帧的序列图片挂到导出专用 <img> 上并等它解码完成。
 * 已经 complete 的图不再 await(decode() 虽会立即返回,但少一次 Promise 开销);
 * decode() 失败(图 404 / 解码报错)被吞掉 —— 少一帧总好过中断整段导出。 */
async function ensureSeqDecoded(n: number) {
  if (seqEntries.length === 0) return;
  await Promise.all(
    seqEntries.map(async (entry) => {
      const img = seqExportImages.get(entry.ind);
      const url = seqFrameUrl(entry, n);
      if (!img || !url) return;
      if (img.src !== url) {
        img.src = url;
        if (!img.complete) await img.decode().catch(() => {});
      }
    })
  );
}

/* ---------- 叠加序列调色 ----------
 * 两条叠加序列(99999 / 百叶窗)是同色调纹理,画面信息几乎全在 alpha 上,所以「改颜色」用
 * feColorMatrix 把 RGB 换成目标色、保留源 alpha(colorize):目标色取源色时与原图一致,
 * 换色也不丢纹理。同一个 <filter> 同时服务两条渲染路径:
 *   • SVG 渲染器:图层 <g> 的 CSS filter = url(#id);
 *   • Canvas 渲染器:绘制前 ctx.filter = url(#id)(视频导出走同一条 canvas 路径)。
 * 因此改色是即时的:不需要把 359×2 张 PNG 逐帧重新编码着色(那样拖动取色器会卡死)。
 * filter 宿主放在 document.body 的隐藏 <svg> 里:切渲染器、重建动画、导出期间都不会丢。 */
/* 调色按「动画 + 图层 ind」记录:不同动画的序列图层 ind 可能相同,不能只按 ind 存 */
const seqTints = new Map<string, string>(); // '动画key:ind' → 目标色 #rrggbb
let seqTintSvg: SVGSVGElement | null = null;

function seqTintKey(name: string): string {
  return currentAnimKey + ':' + name;
}

/* 叠加序列名单:这些序列默认就挂着调色滤镜(出厂色 #d82f28),而不是「未调色 = 不挂滤镜」。
 * 判定用函数而不是模块级常量:BLINDS_SEQUENCES 在文件后面的「载入来源」区声明。 */
function isBlindsSequenceName(nm: string | undefined): boolean {
  return !!nm && BLINDS_SEQUENCES.some((s) => s.name === nm);
}

/* ---------- 位图图层的调色(黑潮爆破默认弹窗的「图片图层」) ----------
 * 与核电站功率的叠加序列不同:那里的图层是逐帧换图(ks.src),调色只能挂滤镜;
 * 这里要调的是一张**静态位图资源**(提示条 / 图标 / HUD 底条 / 遮罩源 / 两张整幅图),所以走的是
 * 「把资源换成着色后的 data URI」——也就是站点原本给「百叶窗.png」用的那条通路。
 *
 * 三个必须处理的点:
 *  ① **要能调回原样**:着色是"从原始位图重新着色",所以原始地址必须先存下来。动画自带的资源原本是
 *     /animations/animation_6/images/xxx.png 这种打包地址,直接存下来即可;一旦被着过色,
 *     资源 p 就变成了 data:image/png;base64... —— 所以用 blastTintHex/isBlastTintedUri 判定"当前是不是
 *     着色结果",只在还没着色时记住原地址,避免把着色结果当原图(re-reset 就回不去了)。
 *  ② **着色后必须刷新缓存**:站点按地址缓存解码结果(imageTintCaches),不清一遍的话重建时会拿旧图,
 *     表现为"拖了颜色但画面不变"(见 invalidateBitmapCaches)。
 *  ③ **着色用乘色法**(目标色 × 源像素亮度),而不是站点原有的"保留亮度换色相饱和度":这些 UI 素材是
 *     纯灰度的(实测 100% 灰度像素、平均饱和度 0),"保留饱和度"的算法对灰色等于什么都不做 ——
 *     拖了颜色画面纹丝不动。乘色法则天然适配"白描边 + 半透明底"的 UI 图:白描边保持色相、
 *     灰底被染成所选颜色、暗部仍是暗部。
 *
 * 逐帧序列(696 帧)走的是另一条路:按图层 ind 记色,套 SVG 滤镜(与核电站的叠加序列同一套机制),
 * 不逐帧重编码 —— 见 seqTint* 那几个函数。 */
/* 清掉按「图片地址」缓存的解码结果:资源换成着色后的 data URI 之后,不清就会命中旧图,
 * 表现为"拖了颜色但重建出来的画面没变"。着色用的原始位图缓存也一并清,保证下次仍从原图重算。 */
function invalidateBitmapCaches(asset: any, originalUri: string) {
  if (typeof asset?.p === 'string') imageTintCaches.delete(asset.p);
  imageTintCaches.delete(originalUri);
}
const blastOriginalImageUri = new Map<string, string>(); // '动画key:refId' → 原始资源地址
const blastFillOriginalColor = new Map<string, number[]>(); // '动画key:refId' → 原始「填充」色(fc 数组),用于重置
const blastTintHex = new Map<string, string>(); // '动画key:refId' → 用户选定的颜色
/** 当前资源是不是本站着色产物(着色后 p 一定是 data:image/...) */
function isBlastTintedUri(p: unknown): boolean {
  return typeof p === 'string' && p.indexOf('data:image/') === 0;
}
function blastTintKey(refId: string): string {
  return currentAnimKey + ':' + refId;
}
/* 逐帧序列的调色键:用**宿主图层名**(如「箭头 1_[00000-00695].png」)。
 * 为什么不复用 ind:预合成内的图层 ind 会被 normalizePrecompInds 重新编号 —— 实测 comp_1 里的宿主
 * ind 是 100001,但列表里拿到的对象 ind 是 1(与预合成内其它图层撞号),用它当键会串味。
 * 图层名既唯一又稳定,而且它本来就是这条序列的素材名。 */
const SEQ_NAME_PREFIX = 'seqname:';
function seqNameKey(name: string): string {
  return SEQ_NAME_PREFIX + name;
}
function isSeqNameRef(ref: string): boolean {
  return ref.startsWith(SEQ_NAME_PREFIX);
}

/* 该图层当前生效的调色:用户手动设过的色优先,否则叠加序列用出厂色,其余序列图层不调色。
 * 键用**图层名**而不是 ind:预合成内的 ind 会被 normalizePrecompInds 重新编号(实测同一条序列
 * 在不同遍历路径下 ind 是 100001 / 1 两种值),用名字才稳定;名字在这份数据里也是唯一的。 */
function seqTintHexOfLayer(data: any): string | null {
  const nm = typeof data?.nm === 'string' ? data.nm : '';
  if (!nm) return null;
  const explicit = seqTints.get(seqTintKey(nm));
  if (explicit) return explicit;
  return isBlindsSequenceName(nm) ? sequenceDefaultHex(nm) : null;
}

// 滤镜 id 只能含字母数字 / 下划线 / 连字符,把 '动画key:图层名' 里的非法字符统一替换掉
function seqTintFilterId(name: string): string {
  return 'df-seq-tint-' + seqTintKey(name).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/* 生成 feColorMatrix 的 20 个系数(4×5,行主序):输出 RGB 恒等于目标色、alpha 沿用源图,
 * 即用目标色给源图重新着色(colorize)—— 纹理信息都在 alpha 上,所以换色不丢纹理。 */
function seqTintMatrixValues(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // 输出 RGB = 常量目标色,alpha 沿用源图 → 纯色化;color-interpolation-filters 用 sRGB,
  // 否则 SVG 默认的 linearRGB 会让取色器选的色与画面对不上
  return '0 0 0 0 ' + r + ' 0 0 0 0 ' + g + ' 0 0 0 0 ' + b + ' 0 0 0 1 0';
}

/* 重建调色滤镜:每个被调色的序列一个 <filter>;未调色的序列不生成 */
function syncSeqTintFilters() {
  const NS = 'http://www.w3.org/2000/svg';
  if (!seqTintSvg) {
    seqTintSvg = document.createElementNS(NS, 'svg');
    seqTintSvg.setAttribute('width', '0');
    seqTintSvg.setAttribute('height', '0');
    seqTintSvg.setAttribute('aria-hidden', 'true');
    seqTintSvg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(seqTintSvg);
  }
  while (seqTintSvg.firstChild) seqTintSvg.removeChild(seqTintSvg.firstChild);
  const defs = document.createElementNS(NS, 'defs');
  // 按当前动画的序列图层生成:即使 seqTints 里没有显式记录,叠加序列也会按出厂色生成滤镜
  /* 每条序列一个 <filter>:只有"有有效颜色"的才生成 —— 叠加序列自带出厂色,黑潮爆破的逐帧序列
   * 出厂不调色(seqTintHexOfLayer 返回空),用户选过色之后才有滤镜。 */
  /* 逐帧序列的宿主图层藏在预合成里(currentData.layers 顶层找不到),所以整棵树找一遍;
   * 它是一条 ty:0 预合成图层,用户选过色之后才有滤镜(未选色 = 画面保持素材原样)。 */
  const seqNames: string[] = [];
  const collectSeqNames = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l && String(l.refId) === 'sequence_0' && typeof l.nm === 'string' && seqNames.indexOf(l.nm) < 0) seqNames.push(l.nm);
      if (Array.isArray(l?.layers)) collectSeqNames(l.layers);
    }
  };
  collectSeqNames(currentData?.layers);
  for (const a of currentData?.assets ?? []) if (Array.isArray(a.layers)) collectSeqNames(a.layers);
  for (const nm of seqNames) {
    const hex = seqTintHexOfLayer({ nm });
    if (!hex) continue;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', seqTintFilterId(nm));
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', seqTintMatrixValues(hex));
    filter.appendChild(m);
    defs.appendChild(filter);
  }
  for (const entry of seqEntries) {
    const hex = seqTintHexOfLayer({ nm: entry.nm });
    if (!hex) continue;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', seqTintFilterId(entry.nm));
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', seqTintMatrixValues(hex));
    filter.appendChild(m);
    defs.appendChild(filter);
  }
  seqTintSvg.appendChild(defs);
}

/* canvas 渲染路径:绘制序列帧时套用调色滤镜 */
function withSeqTint(el: any, draw: () => void) {
  const hex = seqTintHexOfLayer(el?.data);
  const ctx = el?.canvasContext;
  if (!hex || !ctx || typeof ctx.filter !== 'string') return draw();
  const prev = ctx.filter;
  let applied = false;
  try {
    ctx.filter = 'url(#' + seqTintFilterId(String(el.data?.nm ?? '')) + ')';
    applied = true;
  } catch { /* 浏览器不支持时按原色绘制 */ }
  const r = draw();
  if (applied) ctx.filter = prev;
  return r;
}

/* 序列图层对应的"调色键 ind":黑潮爆破的逐帧序列是一条引用 sequence_0 的预合成图层,
 * 它被嵌在「预合成 1」里(宿主 ind 100001),渲染器顶层只有引用 comp_1 的那条图层。
 * 调色按宿主的 ind 记录,但滤镜要挂在**能覆盖整条序列的那个元素**上 —— 也就是引用了同一份
 * 预合成资源的顶层图层。这里统一解析出"用于取色和挂滤镜的那个 ind"。 */
function seqTintTargetInd(el: any): number | null {
  const data = el?.data;
  if (!data || typeof data.ind !== 'number') return null;
  if (String(data.refId) === 'sequence_0') return data.ind; // 宿主自身(若直接出现在顶层)
  if (String(data.refId) === 'comp_1' || String(data.refId) === '99') return data.ind; // 承载序列的预合成
  return null;
}

/* SVG 渲染路径:把调色滤镜挂到图层 <g> 上(该层若带 AE 投影则让位给投影)。
 * 黑潮爆破的逐帧序列是一条**被引用的预合成**(宿主在 comp_1 内,ind 100001),
 * 渲染器顶层只有引用 comp_1 的那条图层 —— 对它挂滤镜就等于覆盖整条序列,
 * 所以这里用 seqTintTargetInd 解析"该元素代表哪条序列",再按宿主的 ind 取色。 */
function applySeqTintToSvg(el: any) {
  if (!el || !el.layerElement || getDropShadow(el.data)) return;
  /* 取色键 = 该元素**承载的那条序列**的名字:
   *  · 元素自身是序列图层(核电站的叠加序列、或宿主直接位于顶层)→ 用它自己的名字;
   *  · 元素是承载序列的预合成(黑潮爆破的「预合成 1」)→ 用其内部宿主图层的名字。 */
  const seqName = seqNameOfElement(el);
  const hex = seqName ? seqTintHexOfLayer({ nm: seqName }) : seqTintHexOfLayer(el.data);
  const want = hex && seqName ? 'url(#' + seqTintFilterId(seqName) + ')' : '';
  if (el.layerElement.style.filter !== want) el.layerElement.style.filter = want;
}
/* 该渲染元素对应的「序列图层名」:自身是序列图层就用自己,是承载序列的预合成就用内部的宿主名 */
function seqNameOfElement(el: any): string | null {
  const nm = typeof el?.data?.nm === 'string' ? el.data.nm : '';
  if (nm && seqTintHexOfLayerNameKnown(nm)) return nm;
  const refId = el?.data ? String(el.data.refId) : '';
  if (refId) {
    const comp = (currentData?.assets ?? []).find((a: any) => String(a.id) === refId);
    const host = (comp?.layers ?? []).find((l: any) => l && String(l.refId) === 'sequence_0');
    if (host && typeof host.nm === 'string') return host.nm;
  }
  return nm || null;
}
/* 该名字是否是一条"已登记调色"的序列(核电站的叠加序列名 / 黑潮爆破的宿主名) */
function seqTintHexOfLayerNameKnown(nm: string): boolean {
  if (seqTints.has(seqTintKey(nm))) return true;
  if (isBlindsSequenceName(nm)) return true;
  return false;
}

/* ---------- DOM 引用 ---------- */
/* 元素查询:放宽到 HTMLElement | SVGElement(播放/暂停等内联 SVG 也要用它取引用) */
const $ = <T extends HTMLElement | SVGElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* 预览区与播放控制条的常用引用(播放/暂停、循环、速度、时长、帧滑块、渲染器/适配选择) */
const previewStage = $<HTMLDivElement>('stage');
const previewInner = $<HTMLDivElement>('previewInner');
const btnPlay = $<HTMLButtonElement>('btnPlay');
const btnRestart = $<HTMLButtonElement>('btnRestart');
const chkLoop = $<HTMLInputElement>('chkLoop');
const rngSpeed = $<HTMLInputElement>('rngSpeed');
const speedVal = $<HTMLSpanElement>('speedVal');
const rngDuration = $<HTMLInputElement>('rngDuration');
const durationVal = $<HTMLSpanElement>('durationVal');
const timingSection = $<HTMLDivElement>('timingSection');
const chkNextScan = $<HTMLInputElement>('chkNextScan');
const nextScanRow = $<HTMLLabelElement>('nextScanRow');
const nextDurationRow = $<HTMLLabelElement>('nextDurationRow');
const rngNextDuration = $<HTMLInputElement>('rngNextDuration');
const nextDurationVal = $<HTMLSpanElement>('nextDurationVal');
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
const imageSection = $<HTMLDivElement>('imageSection');
const imageList = $<HTMLUListElement>('imageList');
const imageCount = $<HTMLElement>('imageCount');

const themeSection = $<HTMLDivElement>('themeSection');
const themeCount = $<HTMLElement>('themeCount');
const themeFill = $<HTMLInputElement>('themeFill');
const themeStroke = $<HTMLInputElement>('themeStroke');
const btnThemeReset = $<HTMLButtonElement>('themeReset');

const iconSection = $<HTMLDivElement>('iconSection');
const iconList = $<HTMLUListElement>('iconList');
const iconCount = $<HTMLElement>('iconCount');
const iconFile = $<HTMLInputElement>('iconFile');
const chkIcon = $<HTMLInputElement>('chkIcon');
const iconNudgeRow = $<HTMLDivElement>('iconNudgeRow'); // 居中微调行:仅「显示图标」取消勾选(图标隐藏)后显示
const iconToggleRow = $<HTMLLabelElement>('iconToggleRow'); // 「显示图标」开关行:仅位置暴露动画显示
const iconScopeTabs = $<HTMLDivElement>('iconScopeTabs'); // 分段选项卡容器:仅位置暴露动画显示
/* 图标不透明度(仅任务弹窗动画):图标是普通位图图层,直接改图层不透明度 */
const iconOpacityRow = $<HTMLDivElement>('iconOpacityRow');
const iconOpacitySlider = $<HTMLInputElement>('iconOpacitySlider');
const iconOpacityVal = $<HTMLSpanElement>('iconOpacityVal');
/* 「报酬信息」统一开关(仅任务弹窗动画):控制「预期报酬」「数字」与货币图标的显隐 */
const missionRewardSection = $<HTMLDivElement>('missionRewardSection');
const chkMissionReward = $<HTMLInputElement>('chkMissionReward');
/* 图标选择的分段选项卡:位置暴露(主段)/ 二次扫描(第二段)分别自定义图标 */
const iconScopeMain = $<HTMLButtonElement>('iconScopeMain');
const iconScopeNext = $<HTMLButtonElement>('iconScopeNext');
const iconScopeThumbMain = $<HTMLImageElement>('iconScopeThumbMain');
const iconScopeThumbNext = $<HTMLImageElement>('iconScopeThumbNext');
const iconScopeNameMain = $<HTMLElement>('iconScopeNameMain');
const iconScopeNameNext = $<HTMLElement>('iconScopeNameNext');
const iconScopeHint = $<HTMLElement>('iconScopeHint');
const iconFollowRow = $<HTMLLabelElement>('iconFollowRow');
const chkFollowMainIcon = $<HTMLInputElement>('chkFollowMainIcon');
const chkPopup = $<HTMLInputElement>('chkPopup');
const popupLayer = $<HTMLDivElement>('popupLayer');
const popupCount = $<HTMLElement>('popupCount');
const popupTextList = $<HTMLUListElement>('popupTextList');
const popupTextCount = $<HTMLElement>('popupTextCount');
const popupShapeList = $<HTMLUListElement>('popupShapeList');
const popupShapeCount = $<HTMLElement>('popupShapeCount');
const statusbar = $<HTMLElement>('statusbar');

/* ---------- 状态 ---------- */
/* currentData 是「当前正在渲染的那份数据」—— 可能已被二次扫描合并、时长调整、图标替换就地改过,
 * 与 ANIMATIONS[].data() 返回的源数据不是同一个引用;currentName 用于按名字走特殊逻辑
 * (如「位置暴露动画」的默认时长与图标处理)。scrubWasPlaying 记录拖动时间轴之前是否在播放。 */
let anim: AnimationItem | null = null;
let currentData: any = null;
let currentName = '';
let scrubWasPlaying = false;
/* 播放/暂停图标上次同步到的状态:仅用于「变了才写 DOM」,同时便于发现动画状态与图标不一致 */
let transportShownPlaying: boolean | null = null;
let transportShownAnim: AnimationItem | null = null;
// 兜底看门狗定时器 id:全局只注册一个(syncTransportUI 内部已做变化检测,可安全高频调用)
let transportWatchdog: number | null = null;

// HTML 转义:所有拼进 innerHTML 的文本(图层名、用户输入)都要过一遍,防止注入与破版
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function setStatus(msg: string, isError = false) {
  statusbar.textContent = msg;
  statusbar.classList.toggle('error', isError);
}

/* ---------- 动画生命周期 ---------- */
/* 销毁当前 lottie 实例并清空预览容器。
 * 容器必须清空:destroy() 不会移除容器里残留的渲染节点,残留会让下一次重建出现新旧画面叠加,
 * 或留下「只剩一个图标的半成品」。 */
function destroyAnim() {
  if (anim) {
    try { anim.destroy(); } catch { /* ignore */ }
    anim = null;
  }
  previewInner.innerHTML = '';
}

// 载入序号:loadData 中途要 await 字体加载,期间用户可能已经切到别的动画,
// 回来自查序号不一致就整体放弃,避免过期数据把新动画覆盖掉
let loadSeq = 0;

/* 载入并渲染一份动画数据(编辑器的主入口,流程顺序有强约束,别随意调换):
 *   销毁旧实例 → 记录 currentData/currentName → 位置暴露默认时长 → 捕获各项「原始状态」
 *   → setupImageSequence → syncSeqTintFilters → 适配/复位视图/背景 → await 字体加载
 *   → lottie.loadAnimation → 按渲染器打 patch → 注册事件 → rAF 兜底刷新帧范围。
 * 几个容易踩的点:
 *  • 原始状态(文字/形状/透明度/底框/图标)必须在时长压缩之后捕获,否则「重置」会恢复成压缩前的时刻;
 *  • 字体 await 回来后必须校验 loadSeq,过期载入直接 return(连 UI 都不更新);
 *  • 本函数不返回 Promise,调用方用 void loadData(...) 触发,内部失败只写状态栏。 */
async function loadData(data: any, name: string) {
  const seq = ++loadSeq;
  const serial = ++buildSerial; // 使在途的 reRenderPreservingState 恢复逻辑失效
  destroyAnim();
  currentData = data;
  currentName = name;
  /* 默认时长(注册项 caps.defaultDuration):位置暴露动画载入时压缩到 1.25s 内容时长,
   * 总播放 = 内容时长 + 5 帧;仅首次载入时应用,之后交给用户的时长滑杆。 */
  const defaultDurDef = animDef();
  const defaultDur = defaultDurDef?.caps.defaultDuration;
  if (defaultDur && defaultDurDef && !defaultDurationApplied.has(defaultDurDef.key)) {
    defaultDurationApplied.add(defaultDurDef.key);
    applyMainDuration(data, defaultDur);
  }
  /* 预合成内部图层的 ind 挪到独立号段(幂等):侧栏要能编辑预合成里的文字/形状/图片,
   * 而它们的 ind 只在各自合成内唯一,会与顶层撞号(详见 normalizePrecompInds 的注释)。
   * 必须在任何「按 ind 快照/查找」之前执行,否则快照会记到错误图层上。 */
  normalizePrecompInds(data);
  /* 字形表只烘焙了导出时的那些字:一旦用户改成表外的字就会渲染成空路径(文字消失)。
   * 盖不住时丢掉 chars、退回浏览器文本引擎;必须在 lottie.loadAnimation 之前判定。 */
  dropCharsIfUncovered(data);
  // 「原始状态」捕获必须放在时长压缩之后:applyMainDuration 会把各图层末尾淡出
  // 关键帧平移到压缩后的出点(如文字层由 47→61 帧改为 61→75 帧)。若在压缩前捕获,
  // 点图层「重置」会恢复成压缩前的渐出时刻,导致该图层与其余图层渐隐不同步(乱套)。
  captureOriginalState(data);
  captureOriginalShapeState(data);
  captureOpacityState(data);
  captureDikuangBaseState();
  captureMaptitlePlateBase(); // 地图标题动画:采集底框/描边的基准宽度与文字基准宽度
  captureIconState();
  setupImageSequence(data);
  // 按本次载入的序列图层(重新)生成调色滤镜:叠加序列默认就挂出厂色滤镜,
  // 显式改过色的序列沿用用户颜色;切换动画后按新动画的序列重建
  syncSeqTintFilters();
  applyFit();
  resetView();
  applyBackground();
  setStatus('字体加载中…');
  await loadEmbeddedFonts(data);
  if (seq !== loadSeq) return; // 载入期间又发起了新的载入请求
  // 「显示图标」开关未勾选时,对刚载入的数据应用隐藏(图标透明度置 0 + 文字居中)。
  // 这套位移逻辑只对位置暴露动画成立(图层号、底框都在那段数据里写死),其它动画走「图标不透明度」。
  if (!chkIcon.checked && iconToggleApplies()) setIconVisible(false, false);
  try {
    /* lottie 实例化:renderer 由下拉框决定(SVG / Canvas 是两条不同的渲染管线,patch 也不同);
     * autoplay 恒开 —— 是否循环由 chkLoop 控制;音效走上面注入的 audioFactory(修复 Howl 缺失导致的崩溃)。 */
    anim = lottie.loadAnimation({
      container: previewInner,
      renderer: selRenderer.value === 'canvas' ? 'canvas' : 'svg',
      loop: chkLoop.checked,
      autoplay: true,
      animationData: data,
      audioFactory,
    });
    patchAudioDestroy(anim);
    (window as any).__anim = anim;
    (window as any).__lottie = lottie;
    // 立即给已构建的元素打 patch;懒构建的元素由 patch 内部包装的 buildItem 覆盖
    if (selRenderer.value === 'canvas') {
      patchCanvasRendererTree((anim as any).renderer);
    } else {
      patchSvgRendererTree((anim as any).renderer);
    }
    rebuildPopupOverlay(); // 弹窗与主动画同渲染器、同帧号跟随
    anim.addEventListener('DOMLoaded', onAnimReady);
    anim.addEventListener('config_ready', onAnimReady);
    anim.addEventListener('data_failed', () => { hideAppLoading(); setStatus('动画数据解析失败,无法渲染', true); });
    // 播到结尾自动暂停 / 循环回绕:同步播放按钮图标,否则会出现图标停在「暂停中」而画面已停的情况
    anim.addEventListener('complete', syncTransportUI);
    anim.addEventListener('loopComplete', syncTransportUI);
    // 兜底看门狗:任何路径改了播放状态都能在 250ms 内把图标纠正回来(syncTransportUI 内部已做变化检测)。
    // onAnimReady 可能被 DOMLoaded / config_ready 触发多次,这里不会重复注册定时器。
    if (transportWatchdog === null) transportWatchdog = window.setInterval(syncTransportUI, 250);
    // lottie 实例构造时 totalFrames 即已确定;以 rAF 兜底刷新一次帧范围,
    // 防止 DOMLoaded/config_ready 在监听绑定前就已触发(如二次扫描合并数据),导致时间轴上限停在旧值。
    scheduleFrameRangeRefresh(seq);
    // 若之前 reRenderPreservingState 曾隐藏预览区(重建闪避),此处在本次实例就绪后恢复显示;
    // 仅当本次仍是最新载入/重建时才放行,避免旧实例提前点亮画面。
    const loadedAnim = anim;
    const revealIfLatest = () => {
      if (serial === buildSerial && seq === loadSeq) previewInner.style.visibility = 'visible';
      void loadedAnim;
    };
    loadedAnim.addEventListener('DOMLoaded', revealIfLatest);
    loadedAnim.addEventListener('config_ready', revealIfLatest);
    requestAnimationFrame(revealIfLatest);
  // 构造失败也必须收掉加载界面,否则用户会永远停在加载页上
  } catch (e) {
    hideAppLoading();
    setStatus('载入失败: ' + (e as Error).message, true);
  }
  updateInfo(data);
  syncDurationSlider();
  syncNextDurationSlider();
}

/* DOMLoaded 与 config_ready 都会触发这里(可能各触发一次),因此函数体必须可重复执行:
 * finishAppLoading 只置标志位;帧范围与时长滑块都是「按当前数据重算后覆盖」,天然幂等。 */
function onAnimReady() {
  finishAppLoading(); // 主动画就绪:放行进度条走到 100% 后再隐藏加载界面
  updateFrameRange();
  updateTransport();
  syncDurationSlider();
  syncNextDurationSlider();
  setStatus('已载入: ' + currentName);
}

/* ---------- 播放控制 ---------- */
/* 帧号约定(踩过坑,改动前务必先读):
 * lottie 的 currentFrame / currentRawFrame 是**相对帧号** —— 0 就代表合成的 ip,
 * 它内部渲染时会再补上一次 animationData.ip(见 AnimationItem.renderFrame 的
 * renderer.renderFrame(this.currentFrame + this.firstFrame))。因此:
 *   • 本应用里「首帧」恒为 0(first 参数是相对帧);把 a.firstFrame(= ip)当首帧传回
 *     goToAndStop(.., true) 会让 ip>0 的动画凭空多跳过 ip 帧 —— 地图标题动画的 ip=4,
 *     「重新播放」于是落到相对帧 4(合成帧 8),此时「地图名称」的不透明度已淡入到 88.9%,
 *     表现就是「一开场就没有透明度、看不到淡入」。其它动画 ip=0,所以这个坑长期没暴露。
 *     (该动画的 ip 已在素材侧归一为 0,见 README;此处保留 ip>0 的正确处理,以防日后
 *      再接入 ip≠0 的素材 —— 这类素材很常见,不能依赖"大家都从 0 开始"。)
 *   • 同理,末帧(相对)恒为 totalFrames-1,不能再加 firstFrame,否则 ip>0 时
 *     currentFrame 永远够不到 326 这种值,「停在末帧」判定失效,播完再点播放会没反应。
 * 用 0.5 帧容差,避免浮点帧号(如 608.9999)判不出来。 */
const FIRST_REL_FRAME = 0;

function isAtLastFrame(a: AnimationItem): boolean {
  const last = Math.max(0, (a.totalFrames ?? 1) - 1);
  return a.currentFrame >= last - 0.5;
}

/* 把播放/暂停图标、按钮标题与 aria 同步到 anim.isPaused,并记录本次同步的基准
 * (transportShownAnim / transportShownPlaying),供 syncTransportUI 做变化检测。 */
function updateTransport() {
  const a = anim;
  if (!a) return;
  // 播放/暂停用矢量图标切换(两枚图标叠在同一格,切换不产生宽度跳动)
  const playing = !a.isPaused;
  const icoPlay = $<SVGElement>('icoPlay');
  const icoPause = $<SVGElement>('icoPause');
  icoPlay.style.display = playing ? 'none' : 'block';
  icoPause.style.display = playing ? 'block' : 'none';
  btnPlay.title = playing ? '暂停(空格键)' : '播放(空格键)';
  btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
  btnPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
  transportShownPlaying = playing;
  transportShownAnim = a;
}

/* 把图标同步到动画的真实状态(仅在状态变化时写 DOM,可安全地高频调用)。
 * 之所以需要它:lottie 在「播到结尾自动暂停」「循环回绕」「重建后恢复」等路径里会自行改变
 * isPaused,这些路径不一定经过我们的按钮回调;另外 goToAndStop() 自身也会置暂停,
 * 若在它之后才读 anim.isPaused,就会把「正在播放」误判成「已暂停」而让图标卡住。 */
function syncTransportUI(): void {
  const a = anim;
  if (!a) return;
  if (a === transportShownAnim && transportShownPlaying === !a.isPaused) return; // 已一致,不必写 DOM
  updateTransport();
}

  /* 立即把时间轴滑块的帧范围刷新到当前实例(与下面的 scheduleFrameRangeRefresh 内容相同:
   * 这里是同步写,那里是等一帧再写)。totalFrames 是帧数,滑块用 0 基帧号,故 max = totalFrames-1。 */
  function updateFrameRange() {
    if (!anim) return;
    
    const total = Math.round(anim.totalFrames ?? 0);
    const max = Math.max(0, total - 1);
    rngFrame.min = '0';
    rngFrame.max = String(max);
    rngFrame.value = String(Math.round(anim.currentFrame));
  }

  /* 在动画实例就绪后刷新时间轴帧范围。lottie 实例构造时 totalFrames 已确定,
   * 用 rAF 兜底一次,防止 DOMLoaded/config_ready 在监听绑定前触发导致 max 停在旧值。
   * 传入 preferSeq 时同时校验 loadData 序号,避免陈旧加载覆盖;并校验全局 anim 仍是本次实例。 */
  function scheduleFrameRangeRefresh(preferSeq?: number) {
    const a = anim;
    requestAnimationFrame(() => {
      if (preferSeq !== undefined && loadSeq !== preferSeq) return;
      if (!anim || anim !== a) return;
      const total = Math.round(anim.totalFrames ?? 0);
      const max = Math.max(0, total - 1);
      rngFrame.min = '0';
      rngFrame.max = String(max);
      rngFrame.value = String(Math.round(anim.currentFrame));
    });
  }

/* 播放按钮:停在末帧时 lottie 认为没有可播内容,play() 毫无反应(表现为点了没动静),
 * 这种情况按用户预期回到首帧再播。空格键也是通过 btnPlay.click() 走同一个入口,不必另写一份逻辑。 */
btnPlay.addEventListener('click', () => {
  if (!anim) return;
  if (anim.isPaused) {
    // 停在最后一帧时 lottie 认为「没有可播的帧」,play() 不会有任何反应(表现为按钮点了没动静)。
    // 这种情况按用户预期从头开始播。
    if (isAtLastFrame(anim)) anim.goToAndStop(FIRST_REL_FRAME, true);
    anim.play();
  } else {
    anim.pause();
  }
  updateTransport();
});

btnRestart.addEventListener('click', () => {
  if (!anim) return;
  // 无论之前在播放还是暂停,「回到开头」一律定格到第 0 帧(播放中也暂停)。
  // 注意:曾用「先存 !isPaused、goToAndStop 后再选择性 play」的写法,但 goToAndStop
  // 自身会把动画置为暂停,导致播放状态下按钮误判、画面停止而图标仍显示播放中。
  anim.goToAndStop(FIRST_REL_FRAME, true);
  updateTransport(); // 同步图标/标题/aria:定格后一律显示播放三角
});

  /* 拖动时间轴:先把播放暂停(拖动中逐帧 seek 与播放循环会互相打架),
   * scrubWasPlaying 记住「拖动前是否在播」,松手(change 事件)时才恢复。
   * frameInfo 显示 0 基帧号 / 总帧数;timeInfo 把帧号换算成秒(帧号 ÷ 帧率)。 */
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

  // 松手(change)才恢复播放:仅当本次拖动之前动画确实在播放
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

// 倍速滑块(HTML 上限定 0.1×–3×,步进 0.1):直接交给 lottie 的 setSpeed,1 = 原速
rngSpeed.addEventListener('input', () => {
  const v = parseFloat(rngSpeed.value);
  speedVal.textContent = v.toFixed(1) + '×';
  if (anim) anim.setSpeed(v);
});

/* ---------- 动画时长调整(1s-10s) ----------
 * 通过把各图层末尾的淡出关键帧对移动到目标时间,并同步更新 op 出点,
 * 实现动画持续时间调整。仅移动"末尾淡出"(末帧值低于前一帧)的图层,
 * 避免破坏淡入结构。总播放时长 = 设定时长 + DURATION_BUFFER 帧。 */
const DURATION_BUFFER = 5; // 在设定时长基础上额外多播放的帧数
// 时长滑块的防抖定时器:两个时长滑块共用;拖动过程中不重建动画(重建代价高),停 200ms 才真正应用
let durationTimer: number | undefined;
/* 已应用过「默认时长」的动画 key(每套动画各自只应用一次)。
 * 这里必须按 key 记,不能用一个全局布尔:带 defaultDuration 的动画可能不止一套,
 * 全局布尔会被「先载入的那套」吃掉,后载入的那套就永远拿不到自己的默认时长。 */
const defaultDurationApplied = new Set<string>();

/* 调整指定段(0=第一段,1=二次扫描)的末尾淡出关键帧到目标时长。
 * 第二段关键帧已整体平移到 __mainOp 之后,末尾淡出以 __mainOp 为基准。 */
/* 把指定段末尾的「淡出关键帧对」搬到目标时间,实现时长调整。
 * 判定「末尾淡出」:ks.o 是动画属性(a===1)且最后两个关键帧里后一帧数值更低 ——
 * 只动这类图层,以免破坏淡入结构(淡入的末帧值比前帧高,不会被碰)。
 * 移动方式:保持两帧之间的 gap 不变(淡出快慢不变),末帧放到 base+targetEnd、前一帧放到 base+targetEnd-gap。
 * base 对第二段是 __mainOp(第二段帧号已整体平移到主段之后)。段归属靠图层 ind 区分:
 * 合并时第二段整段的 ind 被 +100,所以 ind>=100 即第二段。 */
function applyDurationToSegment(data: any, seconds: number, segment: 0 | 1) {
  const fr = data.fr ?? 60;
  const targetEnd = Math.max(1, Math.round(seconds * fr));
  const mainOp = data.__mainOp ?? data.op;
  const base = segment === 1 ? mainOp : 0;
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      const isSecond = l.ind >= 100;
      if (isSecond !== (segment === 1)) {
        if (Array.isArray(l.layers)) walk(l.layers);
        continue;
      }
      const o = l.ks?.o;
      if (o && o.a === 1 && Array.isArray(o.k) && o.k.length >= 2) {
        const kf = o.k;
        const last = kf[kf.length - 1];
        const prev = kf[kf.length - 2];
        const lastVal = Number(Array.isArray(last.s) ? last.s[0] : last.s);
        const prevVal = Number(Array.isArray(prev.s) ? prev.s[0] : prev.s);
        if (!isFinite(lastVal) || !isFinite(prevVal) || lastVal >= prevVal) {
          if (Array.isArray(l.layers)) walk(l.layers);
          continue;
        }
        const gap = Math.max(1, last.t - prev.t);
        prev.t = base + targetEnd - gap;
        last.t = base + targetEnd;
      }
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(data.layers);
}

/* 应用第一段时长:调整第一段末尾淡出,第一段时长变化时整体平移第二段保持紧接 */
/* 应用第一段时长。新出点 = round(秒 × 帧率) + DURATION_BUFFER(尾部多播的缓冲帧)。
 * 第一段变长/变短时第二段要整体平移 delta 保持「紧接」,最后写回两个基准:
 *   __mainOp = 第一段出点(不含第二段);data.op = __mainOp + __nextOp(合并态的总出点)。 */
function applyMainDuration(data: any, seconds: number) {
  const fr = data.fr ?? 60;
  const oldMainOp = data.__mainOp ?? data.op;
  applyDurationToSegment(data, seconds, 0);
  const newMainOp = Math.max(1, Math.round(seconds * fr)) + DURATION_BUFFER;
  const delta = newMainOp - oldMainOp;
  if (isMergedNext(data) && delta !== 0) offsetSecondSegment(data, delta);
  data.__mainOp = newMainOp;
  data.op = newMainOp + (data.__nextOp ?? 0);
}

/* 由数据反算当前时长回填滑块:时长 = (__mainOp - ip - DURATION_BUFFER) / fr,单位秒,
 * 并夹到滑块的 1–10s 范围内(数据可能来自别的实现或被手工改过,不能假定合法)。 */
function syncDurationSlider() {
  if (!currentData) return;
  const fr = currentData.fr ?? 60;
  const mainOp = currentData.__mainOp ?? currentData.op;
  const dur = ((mainOp ?? 0) - (currentData.ip ?? 0) - DURATION_BUFFER) / fr;
  const v = Math.min(10, Math.max(1, dur));
  rngDuration.value = String(v);
  durationVal.textContent = Number(v.toFixed(2)).toString() + 's';
}

// 改完时长必须重建动画:lottie 的 totalFrames 在构造时就固定了,只改数据不会生效
function applyDuration(seconds: number) {
  if (!currentData) return;
  applyMainDuration(currentData, seconds);
  updateInfo(currentData);
  reRenderPreservingState();
}

// 二次扫描时长滑块:未合并第二段时直接返回(这一行在 UI 上也是隐藏的)
function syncNextDurationSlider() {
  if (!currentData || !isMergedNext(currentData)) return;
  const fr = currentData.fr ?? 60;
  const nextOp = currentData.__nextOp ?? 0;
  const dur = (nextOp - DURATION_BUFFER) / fr;
  const v = Math.min(10, Math.max(1, dur));
  rngNextDuration.value = String(v);
  nextDurationVal.textContent = Number(v.toFixed(2)).toString() + 's';
}

/* 应用第二段(二次扫描)时长:规则同第一段,只是出点写进 __nextOp;
 * 总出点 data.op = 主段出点 + 第二段出点 —— AE 的 op 是绝对出点,合并后第二段帧号已被平移过。 */
function applyNextDuration(seconds: number) {
  if (!currentData || !isMergedNext(currentData)) return;
  const fr = currentData.fr ?? 60;
  const mainOp = currentData.__mainOp ?? currentData.op;
  applyDurationToSegment(currentData, seconds, 1);
  const newNextOp = Math.max(1, Math.round(seconds * fr)) + DURATION_BUFFER;
  currentData.__nextOp = newNextOp;
  currentData.op = mainOp + newNextOp;
  updateInfo(currentData);
  reRenderPreservingState();
}

/* 时长滑块 input:拖动过程中只更新读数,停 200ms 才真正重建动画(见 durationTimer);
 * 两个时长滑块共用同一个防抖定时器,连续拖动不会把重建排成队。 */
rngDuration.addEventListener('input', () => {
  const v = parseFloat(rngDuration.value);
  durationVal.textContent = Number(v.toFixed(2)).toString() + 's';
  window.clearTimeout(durationTimer);
  durationTimer = window.setTimeout(() => applyDuration(v), 200);
});

rngNextDuration.addEventListener('input', () => {
  const v = parseFloat(rngNextDuration.value);
  nextDurationVal.textContent = Number(v.toFixed(2)).toString() + 's';
  window.clearTimeout(durationTimer);
  durationTimer = window.setTimeout(() => applyNextDuration(v), 200);
});

/* 二次扫描开关:开启时把第二段并入当前数据,关闭时移除第二段 */
/* 「二次扫描」开关:真实状态记在 showNextScan(这个 checkbox 只是 UI)。
 * 开启时把 animation2NextData 合并进主动画(mergeNextInto:第二段整体平移到主段之后,
 * 资源重命名为 image_0_n),关闭时再拆出来(extractMainFrom),最后统一走一次 loadData 重建。 */
chkNextScan.addEventListener('change', () => {
  /* 不支持二次扫描的动画(黑潮爆破默认弹窗)这一行在界面上是隐藏的,但程序化勾选仍可能到达这里:
   * 直接忽略并回写状态,免得把「二次扫描时长」那一行也叫出来。 */
  if (!animDef()?.caps.nextScan) {
    chkNextScan.checked = showNextScan;
    nextDurationRow.hidden = true;
    return;
  }
  showNextScan = chkNextScan.checked;
  nextDurationRow.hidden = !showNextScan;
  if (!currentData) return;
  if (showNextScan) {
    if (!isMergedNext(animation2Data)) {
      animation2Data = mergeNextInto(animation2Data);
      currentData = animation2Data;
    }
    // mergeNextInto 把第二段整体平移到主段末尾,记录的 __nextOp 是"平移后的出点(含主段长度)"。
    // 这里重算为真实二次扫描时长。不调用 applyNextDuration(其内部会 reRenderPreservingState 重建动画),
    // 否则与下方 loadData 双重重建会引发 onAnimReady/updateFrameRange 竞态,导致时间轴上限停在旧长度。
    const fr = currentData.fr ?? 60;
    const mainOp = currentData.__mainOp ?? currentData.op;
    currentData.__nextOp = Math.max(1, Math.round(nextDuration * fr)) + DURATION_BUFFER;
    currentData.op = mainOp + currentData.__nextOp;
  } else {
    if (isMergedNext(animation2Data)) {
      animation2Data = extractMainFrom(animation2Data);
      currentData = animation2Data;
    }
  }
  // 两段图标资源:合并后第二段资源为 image_0_n,取消合并后回到 image_0;这里再按
  // 用户选择对齐一次(mergeNextInto 内部也会覆盖),并刷新选项卡提示(二次扫描是否已开启)
  applyIconsToData();
  syncIconScopeUI(currentData);
  loadData(currentData, currentName);
  // 二次扫描合并/取消后,图片图层列表(百叶窗.png / 百叶窗2.png / 光.png)随之变化,需刷新
  const hasTintImage = (currentAnimKey === 'blast' ? blastTintableLayers(currentData) : tintableImageLayers(currentData)).length > 0;
  imageSection.hidden = !hasTintImage;
  if (hasTintImage) renderImageList(currentData);
  else imageList.innerHTML = '';
});

// 切换渲染器:lottie 的渲染器在构造时确定,只能整段重建
selRenderer.addEventListener('change', () => {
  if (currentData) void loadData(currentData, currentName);
});

// 空格 = 播放/暂停;焦点在输入控件上时不抢按键(否则输入框里打不出空格,按钮也无法用空格触发)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  // 动画画廊打开时焦点可能落在面板空白处,这时空格不应该穿透到播放/暂停
  if (animPickerOpen()) return;
  const t = e.target as HTMLElement | null;
  if (t && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
  e.preventDefault();
  btnPlay.click();
});

/* ---------- 显示适配 / 缩放 / 平移 ---------- */
/* 视图变换模型:previewInner 的尺寸就是动画的原始像素(w×h),用负 margin 把自己居中到 stage;
 * 最终缩放 = baseScale(适配模式决定,1 表示 1 动画像素 = 1 CSS 像素)× viewZoom(用户缩放倍数),
 * 平移 viewPanX/Y 的单位是屏幕像素。三者由 updateViewTransform 一次性写进 transform。 */
let baseScale = 1; // 由适配模式决定的基准缩放
let viewZoom = 1; // 用户缩放倍数
let viewPanX = 0; // 平移偏移(屏幕像素)
let viewPanY = 0;

const zoomInfo = $<HTMLElement>('zoomInfo');
const btnResetView = $<HTMLButtonElement>('btnResetView');
/* 导出面板 DOM:格式下拉、导出/取消按钮与提示、进度遮罩(百分比 + 进度条 + 明细行) */
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
/* 导出分辨率档位:auto = 由本机能力决定(移动端默认降到 1080p 级,桌面端保持原始分辨率) */
const selRes = $<HTMLSelectElement>('selRes');
/* 导出结束后才出现的两个动作按钮:保存/分享(手机把文件落到相册或「文件」)与重新下载(自动下载被拦截时兜底) */
const btnExportSave = $<HTMLButtonElement>('btnExportSave');
const btnExportRedownload = $<HTMLButtonElement>('btnExportRedownload');

/* 按动画数据尺寸设置画布框,并计算适配缩放:
 *  contain 取较小的缩放比(完整装下,四周留白)、cover 取较大的(铺满容器,可能被裁)、none = 1。
 * 尺寸与居中只在这里设置,缩放交给 transform,所以换适配档位不需要重建动画。 */
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

// 合成最终 transform 并刷新缩放读数;zoomInfo 显示的是用户缩放(viewZoom),不含 baseScale
function updateViewTransform() {
  const s = baseScale * viewZoom;
  previewInner.style.transform =
    'translate(' + viewPanX + 'px, ' + viewPanY + 'px) scale(' + s + ')';
  zoomInfo.textContent = Math.round(viewZoom * 100) + '%';
}

// 复位视图:缩放回到 100%、平移归零(双击画布与「重置视图」按钮共用)
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
// 容器尺寸变化(窗口缩放、侧栏折叠)时重算 baseScale,否则 contain 会按旧尺寸失准
new ResizeObserver(applyFit).observe(previewStage);

/* 滚轮缩放(以鼠标位置为中心) */
/* 滚轮缩放:factor = 1.1^(-deltaY/100),即每滚 100 像素(一格)约 ±10%;
 * 缩放范围夹在 0.05×–50×;平移按「鼠标所指的点保持不动」补偿(以 stage 中心为原点算 dx/dy)。
 * 监听必须 passive:false,否则 preventDefault 无效、页面会跟着一起滚。 */
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
// 平移拖拽的临时状态:按下时的指针位置 + 当时的平移基准;pointercancel(触控被系统接管)也要收尾
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panOrigX = 0;
let panOrigY = 0;

// 只响应鼠标左键;setPointerCapture 让指针移出画布后仍能持续收到 move 事件
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
  /* 背景(背景色 / 透明棋盘格)只应用于画布框内(previewInner,尺寸随动画数据:撤离 1920×1080、位置暴露 3840×1080);
   * 框外区域固定为黑底 + 网格 + 平铺「超出区域,不予显示」提示(见 style.css),与导出无关。 */
  previewInner.style.background = chkTransparent.checked
    ? 'repeating-conic-gradient(#2a2d33 0% 25%, #22252a 0% 50%) 50% / 20px 20px'
    : bgColor.value;
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
    exportHint.textContent = '透明 AVI 已采用预乘 alpha,保留真实透明通道(供 AE/PR 合成)';
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
/* 帧指示缓存:上一次写进 DOM 的整数帧号。
 * 初值取 -1 而不是 0:帧号从 0 开始,用 0 初始化会漏掉第 0 帧的刷新。
 * 只在帧号变化时才写 DOM —— 60Hz 的 rAF 里每帧都改 textContent 与滑块值会带来
 * 无谓的样式/布局开销,反而拖慢主动画本身。 */
let lastFrame = -1;
/* 常驻 rAF 心跳:读主动画当前帧号,刷新帧号/时间读数与时间轴滑块,并驱动弹窗叠加层的帧。
 * 不用 lottie 的 enterFrame 回调:它只在播放时触发,暂停、拖动时间轴、重建之后都不再回调,
 * 读数会停在旧值;这里逐帧轮询,任何状态下都能拿到真实帧号。
 * 循环不设退出条件(动画销毁后 anim 为 null,函数体直接跳过),页面隐藏时浏览器会自动降频。 */
function tick() {
  if (anim && anim.isLoaded) {
    const f = Math.round(anim.currentFrame);
    if (f !== lastFrame) {
      lastFrame = f;
      /* 单位换算:frameInfo 显示「当前帧 / 总帧数」(帧号是 0 起的整数,滑块上限由
       * updateFrameRange 设为 totalFrames - 1);timeInfo 显示秒 = 帧号 ÷ 帧率(帧率取 JSON 的 fr)。 */
      frameInfo.textContent = f + ' / ' + Math.round(anim.totalFrames);
      timeInfo.textContent = (f / anim.frameRate).toFixed(2) + 's';
        rngFrame.value = String(f);
    }
  }
  // 弹窗叠加层按帧号跟随主动画(播放/暂停/拖动时间轴均同步)
  /* 弹窗用 goToAndStop 单向跟随主动画帧号,而不是自己 play():两个独立 lottie 实例各自播放
   * 会因启动时刻与加载耗时不同而逐渐漂移,单向驱动才能保证严格同帧。
   * try/catch 兜底:实例可能正好在重建中途被 destroy。 */
  if (popupAnim && anim && anim.isLoaded) {
    const f = Math.round(anim.currentFrame);
    if (f !== popupLastFrame) {
      popupLastFrame = f;
      try { popupAnim.goToAndStop(f, true); } catch { /* ignore */ }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- 信息面板 ---------- */
/* 取文字图层的文字内容(对应 AE 的 source text)。
 * Bodymovin 把文字文档放在 t.d.k:t.d.k 是数组时每个元素是一段文字关键帧(取第一段作代表),
 * 是对象时 k.s 就是唯一的文档。非文字层或结构异常时返回空串。 */
function textOfLayer(l: any): string {
  const td = l.t?.d?.k;
  const s = Array.isArray(td) ? td[0]?.s : td?.s;
  return s?.t ?? '';
}

/* 深度收集所有文字图层(ty === 5),含预合成内部的图层,返回扁平列表 { nm, ind, text }。
 * ind 是同一次导出内唯一的图层 id,侧栏所有编辑控件都用它回查图层(data-ind),
 * 因此藏在预合成里的文字也能被 findLayerByInd 找回来。 */
function collectTextLayers(data: any): { nm: string; ind: number; text: string }[] {
  const out: { nm: string; ind: number; text: string }[] = [];
  walkEditableLayers(data, (l, precompName) => {
    if (l.ty === 5) out.push({ nm: displayLayerName(l.nm, precompName), ind: l.ind, text: textOfLayer(l) });
  });
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

/* #rrggbb → Bodymovin 的 fc 数组,分量为 0~1 的浮点(#ff0000 → [1,0,0])。
 * 传入 originalFc 时保留其第 4 个分量:部分数据里 fc 带额外通道,丢掉会改变渲染结果。
 * 这里不校验输入合法性 —— 取色器只在 /^#[0-9a-fA-F]{6}$/ 通过后才调用(见 bindColorPicker)。 */
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

/* ---------- 图片图层调色(如位置暴露动画的「百叶窗.png」) ----------
 * 采用「保留原图亮度、替换色相/饱和度」的着色方式,保留百叶窗纹理的明暗质感。 */
/* #rrggbb → HSL。三个分量统一归一化到 0~1(色相不是 0~360、饱和度/亮度不是百分数),
 * 与 Bodymovin 的 0~1 颜色分量保持一致,便于直接参与逐像素着色运算。
 * 灰色(max === min)色相无意义,按 0 返回。 */
function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue: number;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return [hue, s, l];
}

/* HSL(0~1)→ RGB,返回 0~255 的三个整数,与 hexToHsl 互为逆变换。
 * hue2rgb 是 W3C 定义的分段线性函数;入参 t 可能越界(±1/3 偏移后),所以先做环绕归一化。 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

/* 图片调色缓存:原始图片(百叶窗.png / 百叶窗2.png,约 10544×250)只解码一次,
 * 后续调色从缓存的 ImageData 复制并快速着色,避免每次拖颜色都重新解码。
 * 按 data URI 分别缓存,支持多张纹理(主段百叶窗 + 二次扫描百叶窗2)。 */
const imageTintCaches = new Map<string, { img: HTMLImageElement; data: ImageData }>();

/* 取(并缓存)调色用的原始位图:首次调用时解码图片,并一次性把像素读进 ImageData。
 * 必须走 canvas.getImageData 而不能直接把 <img> 交给 drawImage —— 着色要在 JS 里逐像素改;
 * 图片是 data: URI,画布不会被跨域污染,getImageData 不会抛 SecurityError。
 * 解码或取像素失败时 reject,由调用方打日志,不阻塞后续交互。 */
function getImageTintSource(uri: string): Promise<{ img: HTMLImageElement; data: ImageData }> {
  const cached = imageTintCaches.get(uri);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建 2D 上下文');
        ctx.drawImage(img, 0, 0);
        const src = { img, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
        imageTintCaches.set(uri, src);
        resolve(src);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = uri;
  });
}

/* 灰度 UI 位图的着色:用「目标色 × 源亮度」逐像素相乘(RGB 分别乘)。
 * 为什么不用 tintImageDataFast(保留亮度、替换色相/饱和度):那套算法保留了源图的饱和度,而这些
 * UI 素材是**纯灰度**的(实测 100% 灰度像素、饱和度 0)—— 灰色的饱和度为 0,换色后仍然是灰的,
 * 表现就是"拖了颜色,画面纹丝不动"。乘色法则天然适配这类"白描边 + 半透明底"的 UI 图:
 *   白色 (255) × 目标色 = 目标色;黑色/暗部保持黑;中间的灰阶变成该色的明暗层次。
 * 换句话说:素材本身的明度层次全部保留,只把"颜色"换成用户选的那个。 */
function tintImageDataMultiply(src: ImageData, hexColor: string): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  const tr = parseInt(hexColor.slice(1, 3), 16) / 255;
  const tg = parseInt(hexColor.slice(3, 5), 16) / 255;
  const tb = parseInt(hexColor.slice(5, 7), 16) / 255;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // 全透明像素不必动
    d[i] = d[i] * tr;
    d[i + 1] = d[i + 1] * tg;
    d[i + 2] = d[i + 2] * tb;
  }
  return out;
}

/* 快速着色:整数运算,保留每个像素亮度(HSL 的 L),替换为所选颜色的色相/饱和度 */
function tintImageDataFast(src: ImageData, hexColor: string): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  const [th, ts] = hexToHsl(hexColor);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const l = (max + min) / 2 / 255; // HSL 公式要求 0-1,否则输出溢出钳成白色
    if (ts === 0) {
      const v = Math.round(l * 255);
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      const q = l < 0.5 ? l * (1 + ts) : l + ts - l * ts;
      const p = 2 * l - q;
      const hue2rgb = (t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      d[i] = Math.round(hue2rgb(th + 1 / 3) * 255);
      d[i + 1] = Math.round(hue2rgb(th) * 255);
      d[i + 2] = Math.round(hue2rgb(th - 1 / 3) * 255);
    }
  }
  return out;
}

/* 记录每个文字图层的原始文字与颜色,供重置使用 */
const originalTextState = new Map<number, { text: string; fc: number[] }>();

/* 快照文字图层的原始文字与颜色,供「重置」还原。
 * 必须在任何编辑动作之前调用一次(载入动画时),且写入的是副本 —— 之后改的是同一份 JSON,
 * 不拷贝会让「原始值」跟着一起变、重置失效。键为图层 ind,缺字段时回落 '' / 白色 [1,1,1]。 */
function captureOriginalState(data: any) {
  originalTextState.clear();
  for (const t of collectTextLayers(data)) {
    const layer = findLayerInData(data, t.ind);
    if (!layer) continue;
    const td = layer.t?.d?.k;
    const s = (Array.isArray(td) ? td[0]?.s : td?.s) || {};
    originalTextState.set(t.ind, {
      text: s.t ?? '',
      fc: s.fc ? [...s.fc] : [1, 1, 1],
    });
  }
}

/* 单字符数字位图层(核电站功率动画的五个数字文字层,改名后为「第 N 位」) */
const SINGLE_DIGIT_TEXT_NAMES = new Set(['第一位', '第二位', '第三位', '第四位', '第五位']);
function isSingleDigitTextName(nm: string | undefined): boolean {
  return !!nm && SINGLE_DIGIT_TEXT_NAMES.has(nm);
}

/* 重建右侧信息面板:文档信息(尺寸/帧率/入出点/时长/图层与资源数/字体状态)加三个
 * 可编辑列表(文字、形状、图片)。
 * 每次整段重写 innerHTML,因为列表项随当前动画变化;代价是其中的事件监听与滑块绑定
 * 必须在本函数末尾全部重新挂一遍(见下方各 querySelectorAll)。
 * 字段名按 Bodymovin 规范:ip / op 为入点与出点帧号、fr 为帧率、v 为导出器版本。 */
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
  /* 字体状态看「注册结果」,而不是「JSON 里有没有 fPath」:
   * 本仓库字体已按体积考虑从 JSON 剥离成 animations/animation_1/fonts/*.ttf,旧写法只查 fPath,
   * 于是永远显示「未内嵌」,与实际渲染能力无关,反而误导排查方向。 */
  const fontStates: FontLoadState[] = fontDefs.flatMap((f: any) =>
    [f.fFamily, f.fName].filter(Boolean).map((n: string) => fontLoadState.get(n) ?? 'pending')
  );
  const fontStatus = !fonts.length
    ? '—'
    : fontStates.includes('failed')
      ? fonts.join('、') + ' · 加载失败(已回退系统字体)'
      : fontStates.includes('pending')
        ? fonts.join('、') + ' · 加载中'
        : fonts.join('、') + (embeddedFontCount > 0 ? ' · JSON 内嵌字体' : ' · 站点字体文件');

  const items: [string, string][] = [
    ['尺寸', data.w + ' × ' + data.h],
    ['帧率', fr + ' fps'],
    ['入点 / 出点', ip + ' / ' + op],
    ['时长', dur.toFixed(2) + ' s'],
    ['图层数', String(data.layers?.length ?? 0)],
    ['资源数', String(assets.length)],
    ['内嵌资源', String(embedded.length)],
    ['字体', fontStatus],
    ['Bodymovin 版本', data.v ?? '—'],
  ];
  /* 信息面板的键值都要过 esc():字体名、版本号等直接来自 JSON,含 < > & 时会破坏表格结构。 */
  infoList.innerHTML = items.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');

  textCount.textContent = '· ' + texts.length + ' 个 · 可编辑';
  /* 五个数字位共用「一个」颜色控件:只有排在最前的那一位带取色器(标注为共用),
   * 其余四位只显示文字框与透明度 —— 改这一个颜色,五位一起变(见 onColorChanged)。 */
  let digitColorHostDone = false;
  textList.innerHTML = texts
    .map((t) => {
      const layer = findLayerInData(data, t.ind);
      const td = layer?.t?.d?.k;
      const s = (Array.isArray(td) ? td[0]?.s : td?.s) || {};
      const hex = fcToHex(s.fc);
      /* AE/Bodymovin 用 \r 作为换行符,textarea 只认 \n,回填前必须先转换;
       * rows 按实际行数设置,避免多行文字挤在一行里编辑。 */
      const displayText = String(t.text).replace(/\r/g, '\n');
      const rows = Math.max(1, displayText.split('\n').length);
      // 「第 N 位」是单字符数字位:输入框限一位数字(输入侧过滤 0-9)
      const digit = isSingleDigitTextName(t.nm);
      const digitColorHost = digit && !digitColorHostDone;
      if (digitColorHost) digitColorHostDone = true;
      const colorHtml = digit && !digitColorHost
        ? ''
        : '<label class="t-color-label">' + (digit ? '数字位颜色(五位共用)' : '颜色') +
          ' <input type="color" class="t-color" data-ind="' + t.ind + '" value="' + hex + '" /><input type="text" class="hex-input" value="' + hex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(t.nm) + '</span>' +
        '<button class="t-reset" data-ind="' + t.ind + '" type="button" title="重置文字与颜色">' + ICON_RESET + '重置</button>' +
        '</div>' +
        '<textarea class="t-input' + (digit ? ' t-digit' : '') + '" rows="' + rows + '" data-ind="' + t.ind + '"' +
        (digit ? ' data-digit="1" maxlength="1" inputmode="numeric"' : '') + ' spellcheck="false"></textarea>' +
        colorHtml +
        opacitySliderHtml(t.ind, layer) +
        '</li>'
      );
    })
    .join('');
  /* 列表 HTML 是整段重写的,所以每次重建后都要为新的 textarea 重新绑定输入处理;
   * 普通文字层与单字符数字位的校验规则在下面的分支里区分。 */
  textList.querySelectorAll<HTMLTextAreaElement>('.t-input').forEach((ta) => {
    const ind = Number(ta.dataset.ind);
    const target = texts.find((t) => t.ind === ind);
    const currentText = target ? String(target.text).replace(/\r/g, '\n') : '';
    if (target) ta.value = currentText;
    if (ta.dataset.digit === '1') {
      /* 单字符数字位:只允许一位数字 0-9,并**允许清空**(把数字删掉)。
       * 非数字字符不接受,回退到上一次有效值;留空则按空文字应用。 */
      let lastVal = currentText;
      ta.addEventListener('input', () => {
        const raw = ta.value;
        if (raw === '') {
          lastVal = '';
          onTextEdited(ind, '');
          return;
        }
        const v = raw.replace(/[^0-9]/g, '').slice(-1);
        if (!v) {
          ta.value = lastVal;
          return;
        }
        if (raw !== v) ta.value = v;
        lastVal = v;
        onTextEdited(ind, v);
      });
      return;
    }
    ta.addEventListener('input', () => onTextEdited(ind, ta.value));
  });
  textList.querySelectorAll<HTMLInputElement>('.t-color').forEach((ci) => {
    bindColorPicker(ci, (hex) => onColorChanged(Number(ci.dataset.ind), hex));
  });
  textList.querySelectorAll<HTMLButtonElement>('.t-reset').forEach((btn) => {
    btn.addEventListener('click', () => onResetText(Number(btn.dataset.ind)));
  });
  bindOpacitySliders(textList);

  renderShapeList(data);

  if (fonts.length) {
    if (fontStates.includes('failed')) {
      setStatus('字体加载失败(' + lastFontWarnings.slice(0, 2).join('; ') + '),预览文字已回退系统字体', true);
    } else if (fontStates.includes('pending')) {
      setStatus('字体加载中…');
    } else {
      setStatus(
        (embeddedFontCount > 0 ? '自定义字体已从 JSON 内嵌文件加载: ' : '自定义字体已加载(站点字体文件): ') + fonts.join('、')
      );
    }
  }
}

/* ---------- 图层查找与「预合成内部图层」的编号 ---------- */
/* 按图层 ind 深度查找图层(含图层自己内嵌的 layers 数组),找不到返回 null。
 * ind 在侧栏 HTML 里以 data-ind 传递(字符串),调用方需先 Number() 转换。
 * 不做 ind → layer 的常驻索引:每次编辑都会改写 JSON 结构,缓存容易失效,而层级本身很浅。 */
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

/* ---------- 预合成内容(data.assets[] 里的合成) ----------
 * Bodymovin 把预合成的内容放在 data.assets[] 里(顶层用 refId 引用),那些图层不在 data.layers 上,
 * 而且它们的 ind 只在**自己那个合成内**唯一 —— 例:任务弹窗动画的预合成「框」里也有 ind 1/2/3,
 * 与顶层 ind 直接撞号。侧栏所有编辑控件都用 data-ind 回查图层,撞号就会改错层。
 * 因此载入时把「被引用到的预合成」内部图层 ind 整体平移到独立号段(PRECOMP_IND_BASE),
 * 同一合成内的 parent(父子关系)与 tp(遮罩源)一起平移:这两者都只在合成内解析,
 * lottie 的渲染结果不受影响(有逐像素对比验证)。平移是幂等的(已平移过就跳过)。 */
const PRECOMP_IND_BASE = 100000;
/* 图层名里标注来源合成,便于在侧栏区分(顶层图层保持原样) */
const PRECOMP_NAME_SEP = ' › ';

/* 被引用的预合成 id(递归:预合成里还能再引用预合成) */
function referencedPrecompIds(data: any): Set<string> {
  const ids = new Set<string>();
  const byId = new Map<string, any>();
  for (const a of data?.assets ?? []) if (Array.isArray(a?.layers)) byId.set(String(a.id), a);
  const queue: any[] = [data?.layers ?? []];
  while (queue.length) {
    const layers = queue.pop() as any[];
    for (const l of layers ?? []) {
      if (Array.isArray(l?.layers)) queue.push(l.layers);
      const ref = l?.refId;
      if (typeof ref === 'string' && byId.has(ref) && !ids.has(ref)) {
        ids.add(ref);
        queue.push(byId.get(ref).layers);
      }
    }
  }
  return ids;
}

/* 被引用的预合成资源对象(顺序与 assets 一致) */
function referencedPrecompAssets(data: any): any[] {
  const ids = referencedPrecompIds(data);
  return (data?.assets ?? []).filter((a: any) => Array.isArray(a?.layers) && ids.has(String(a.id)));
}

/* 平移一个集合内所有图层的 ind / parent / tp(递归图层的 layers 数组)。 */
function offsetCompositionInds(layers: any[], delta: number) {
  const map = new Map<number, number>();
  const collect = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (typeof l?.ind === 'number') map.set(l.ind, l.ind + delta);
      if (Array.isArray(l?.layers)) collect(l.layers);
    }
  };
  collect(layers);
  const apply = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (typeof l?.ind === 'number' && map.has(l.ind)) l.ind = map.get(l.ind) as number;
      if (typeof l?.parent === 'number' && map.has(l.parent)) l.parent = map.get(l.parent) as number;
      if (typeof l?.tp === 'number' && map.has(l.tp)) l.tp = map.get(l.tp) as number;
      if (Array.isArray(l?.layers)) apply(l.layers);
    }
  };
  apply(layers);
}

/* 载入时调用一次:把被引用的预合成内部 ind 挪到独立号段(幂等)。 */
function normalizePrecompInds(data: any) {
  for (const a of referencedPrecompAssets(data)) {
    const layers: any[] = a.layers ?? [];
    if (layers.some((l: any) => (l?.ind ?? 0) >= PRECOMP_IND_BASE)) continue; // 已平移过
    offsetCompositionInds(layers, PRECOMP_IND_BASE);
  }
}

/* ---------- 字形表(chars)兜底 ----------
 * 部分导出会带上「字形轮廓表」(Bodymovin 的 Include Glyphs 选项),里面**只烘焙了导出那一刻用到的字**。
 * lottie 一旦发现有 chars 就走「按字查表、画轮廓」这条路(见 lottie.js 的 usesGlyphs):
 * 查不到的字由 getCharData 返回 emptyChar → 画成空路径 —— 表现就是**用户一改字,新字整段消失**。
 * 站点已经把工程字体注册好了(见 loadEmbeddedFonts),所以这里做一次判定:
 *   • 字表盖得住当前所有文字 → 保留 chars(字形与 AE 完全一致,不改现状);
 *   • 盖不住(用户改了字) → 丢掉 chars,退回浏览器文本引擎(同一套字体,肉眼一致,且随便改字都不会消失)。
 * 每次 loadData 都会重新判定一次:第一次改字丢掉后,后续重建都直接走浏览器文本,不会来回闪。 */
function dropCharsIfUncovered(data: any): boolean {
  const list: any[] = Array.isArray(data?.chars) ? data.chars : [];
  if (!list.length) return false;
  const covered = new Set(list.map((c: any) => c.ch + '|' + c.style + '|' + c.fFamily));
  const styleOf = new Map<string, string>();
  const familyOf = new Map<string, string>();
  for (const f of data?.fonts?.list ?? []) {
    if (f?.fName) { styleOf.set(f.fName, f.fStyle); familyOf.set(f.fName, f.fFamily); }
    if (f?.fFamily && !familyOf.has(f.fFamily)) { familyOf.set(f.fFamily, f.fFamily); styleOf.set(f.fFamily, f.fStyle); }
  }
  let uncovered = false;
  walkEditableLayers(data, (l) => {
    if (uncovered || l.ty !== 5) return;
    const k = l.t?.d?.k;
    const docs = Array.isArray(k) ? k.map((kf: any) => kf?.s) : [k?.s];
    for (const doc of docs) {
      if (!doc || typeof doc.t !== 'string') continue;
      const style = styleOf.get(doc.f) ?? doc.f;
      const family = familyOf.get(doc.f) ?? doc.f;
      for (const ch of doc.t) {
        if (ch === '\r' || ch === '\n' || ch === '\u0003') continue; // 换行符不查表
        if (!covered.has(ch + '|' + style + '|' + family)) { uncovered = true; return; }
      }
    }
  });
  if (!uncovered) return false;
  delete data.chars;
  console.info('[text] 字形表盖不住当前文字,已退回浏览器字体渲染(改字不会再消失)');
  return true;
}

/* 在「顶层 + 被引用的预合成」里按 ind 找图层 —— 侧栏编辑统一走这里。 */
function findLayerInData(data: any, ind: number): any | null {
  const hit = findLayerByInd(data?.layers, ind);
  if (hit) return hit;
  for (const a of referencedPrecompAssets(data)) {
    const found = findLayerByInd(a.layers, ind);
    if (found) return found;
  }
  return null;
}

/* 遍历「顶层 + 被引用的预合成」里的全部图层;回调第二参是该图层所属预合成的名字(顶层为空串)。
 * 为什么必须去重:lottie 的 completeData 会把预合成的图层数组**内联**到引用它的图层上
 * (顶层「框」图层会多出一个 layers 字段,指向 assets 里同一个数组、同一批对象),
 * 不去重的话预合成内容会被走两遍 —— 列表出现重复项,而且一份带前缀一份不带。 */
function walkEditableLayers(data: any, cb: (layer: any, precompName: string) => void) {
  /* 先记录「哪些图层属于哪个预合成」:内联副本与 assets 里是同一批对象,所以按对象身份就能识别来源,
   * 即使列表是从顶层开始遍历的,也能给它们带上正确的合成名前缀。 */
  const precompOf = new Map<any, string>();
  const mark = (layers: any[], id: string) => {
    for (const l of layers ?? []) {
      if (!l) continue;
      if (!precompOf.has(l)) precompOf.set(l, id);
      if (Array.isArray(l.layers)) mark(l.layers, id);
    }
  };
  const assets = referencedPrecompAssets(data);
  for (const a of assets) mark(a.layers ?? [], String(a.id));

  const seen = new Set<any>();
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (!l || seen.has(l)) continue;
      seen.add(l);
      cb(l, precompOf.get(l) ?? '');
      if (Array.isArray(l?.layers)) walk(l.layers);
    }
  };
  walk(data?.layers);
  for (const a of assets) walk(a.layers);
}

/* 列表里显示的图层名:预合成内容加「合成名 › 」前缀,顶层保持原名。 */
function displayLayerName(nm: string | undefined, precompName: string): string {
  const base = nm || '(未命名)';
  return precompName ? precompName + PRECOMP_NAME_SEP + base : base;
}

/* ---------- 文字编辑 ---------- */

/* 文字对齐由动画数据的 j 字段原生处理(lottie 每帧按实际文字宽度对齐):
 * - j=2 居中:文本绕锚点(即父级定位点)居中,任意自定义文字宽度都保持居中;
 * - j=0 左对齐:文本从锚点(固定左边缘)起向右排,任意自定义文字宽度都保持左对齐。
 * 因此编辑文字时不再需要挪动锚点(旧逻辑会让左对齐文字随宽度变化而漂移)。 */
function setLayerText(layer: any, newText: string) {
  const td = layer?.t?.d?.k;
  if (!td) return;
  // 统一换行为 AE/Bodymovin 使用的 \r
  const normalized = newText.replace(/\r\n|\r|\n/g, '\r');
  if (Array.isArray(td)) {
    for (const kf of td) if (kf.s) kf.s.t = normalized;
  } else if (td.s) {
    td.s.t = normalized;
  }
}

let textEditTimer: number | undefined;

/* 文字编辑的写回入口:改 JSON → 同步底框宽度 → 防抖重建动画。
 * 不每次按键都重建:重建要走完整的 loadAnimation 流程(解析 JSON、建 DOM、恢复播放状态),
 * 连续输入会把主线程占满;250ms 无输入才真正重建。
 * 重建由 reRenderPreservingState 负责保留当前帧/播放状态/缩放。 */
function onTextEdited(ind: number, newText: string) {
  if (!currentData) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  setLayerText(layer, newText);
  adaptDikuangWidth(); // 文字宽度变化 → 底框宽度同步
  adaptMaptitlePlateWidth(); // 地图标题动画:底框/描边跟着文字宽度走(只增不减)
  // 防抖后重渲染(保留当前帧/播放状态/缩放)
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => {
    reRenderPreservingState();
  }, 250);
}

/* 写入文字颜色。fc 是 0~1 的三(四)分量数组(见 hexToFc),不能直接存 0~255。
 * 与 setLayerText 一样要兼容「关键帧数组」和「静态文档」两种结构,并写入新拷贝的数组,
 * 避免多个图层共享同一个数组引用。 */
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

/* 五个数字位视为同一组:颜色统一(改其中任意一个 = 五个一起改),文字各自独立 */
function digitTextLayers(data: any): any[] {
  return (data?.layers ?? []).filter((l: any) => l?.ty === 5 && isSingleDigitTextName(l.nm));
}

/* 同步侧栏里其它数字位的颜色控件(拖动取色器时保持显示一致) */
function syncDigitColorInputs(hex: string, exceptInd?: number) {
  for (const ci of textList.querySelectorAll<HTMLInputElement>('.t-color')) {
    const ciInd = Number(ci.dataset.ind);
    if (ciInd === exceptInd) continue;
    const l = currentData ? findLayerInData(currentData, ciInd) : null;
    if (l && isSingleDigitTextName(l.nm)) setColorPickerValue(ci, hex);
  }
}

/* 文字颜色编辑入口。普通文字层只改自己;「第 N 位」数字位视为同一组,改一个五位一起改,
 * 并同步侧栏其余行的取色器显示,否则同一屏上的数字会出现两种颜色。
 * 与文字编辑共用 textEditTimer,两类编辑不会各自排队重复重建。 */
function onColorChanged(ind: number, hex: string) {
  if (!currentData) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  // 数字位:一个改色 → 五个一起改(并同步侧栏其它行的取色器)
  const group = isSingleDigitTextName(layer.nm) ? digitTextLayers(currentData) : [layer];
  for (const l of group) setLayerColor(l, hex);
  if (group.length > 1) syncDigitColorInputs(hex, ind);
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => {
    reRenderPreservingState();
  }, 250);
}

/* 把某个文字图层的文字、颜色、不透明度还原到快照值,并把侧栏控件同步回原始值
 * (textarea 内容、取色器与相邻 HEX 输入框)。数字位连同其余四位一起还原颜色。 */
function onResetText(ind: number) {
  if (!currentData) return;
  const orig = originalTextState.get(ind);
  if (!orig) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  setLayerText(layer, orig.text);
  // 数字位同组:颜色也一起还原,避免「重置一个」后五个颜色不一致
  const resetHex = fcToHex(orig.fc);
  if (isSingleDigitTextName(layer.nm)) {
    for (const l of digitTextLayers(currentData)) setLayerColor(l, resetHex);
    syncDigitColorInputs(resetHex, ind);
  } else {
    setLayerColor(layer, resetHex);
  }
  resetLayerOpacity(ind);
  adaptDikuangWidth(); // 文字恢复原宽 → 底框恢复基准宽
  adaptMaptitlePlateWidth(); // 地图标题动画:文字回到基准宽度 → 衬板也回到基准宽
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

/* ---------- 主题颜色(两个颜色值统一替换) ----------
 * 这套素材的配色归成两族(两个颜色值):A 族出厂 #77B0F0、B 族出厂 #78C5F3。
 * 侧栏给两个色块,改一次就把**当前动画里等于该颜色值的所有出现**(不论它落在填充 fl 还是描边 st)
 * 一起换掉,含预合成内部 —— 用于整体换主题色。
 * 判据是「该族当前的颜色值」而不是写死的出厂值:改过一次之后数据里的颜色已经变了,
 * 下一次替换要从新颜色继续,所以状态记在 themeFillCurrent / themeStrokeCurrent 里。
 * 静态色与带关键帧的颜色都覆盖;文字颜色(fc)与图片调色不在这两族的范围内。 */
const THEME_FILL_DEFAULT = '#77b0f0';
const THEME_STROKE_DEFAULT = '#78c5f3';
let themeFillCurrent = THEME_FILL_DEFAULT;
let themeStrokeCurrent = THEME_STROKE_DEFAULT;

/* 归一化:#RRGGBB → #rrggbb,便于比较(数据里大小写混用) */
function normHex(hex: string | null | undefined): string {
  return String(hex || '').trim().toLowerCase();
}

/* 把一处颜色属性里与 from 相同的静态色/关键帧色换成 to,返回替换次数。 */
function replaceShapeColorValue(c: any, from: string, to: string): number {
  if (!c) return 0;
  let n = 0;
  if (c.a === 0) {
    if (Array.isArray(c.k) && c.k.length >= 3 && normHex(fcToHex(c.k)) === from) {
      c.k = hexToFc(to, c.k);
      n++;
    }
    return n;
  }
  if (Array.isArray(c.k)) {
    for (const kf of c.k) {
      const v = Array.isArray(kf?.s) ? kf.s : Array.isArray(kf?.e) ? kf.e : null;
      if (v && v.length >= 3 && normHex(fcToHex(v)) === from) {
        const next = hexToFc(to, v);
        for (let i = 0; i < 3; i++) v[i] = next[i];
        n++;
      }
    }
  }
  return n;
}

/* 统计当前动画里两族颜色各有多少处(用于显示计数与决定区块是否出现)。
 * 按「颜色值」统计,不区分它落在填充还是描边上 —— 与替换的口径保持一致。 */
function countThemeColors(data: any): { fill: number; stroke: number } {
  let fill = 0;
  let stroke = 0;
  walkEditableLayers(data, (l) => {
    // 蒙版源图层(td=1)不参与:它们不渲染,填充色往往是绿色占位色,扫进来只会在"主题色恰好是绿色"时误伤
    if (l.ty !== 4 || l.td === 1) return;
    const walkItems = (items: any[]) => {
      for (const it of items ?? []) {
        if (it.ty === 'fl' || it.ty === 'st') {
          const c = it.c;
          const vals: string[] = [];
          if (c?.a === 0 && Array.isArray(c.k)) vals.push(normHex(fcToHex(c.k)));
          else if (c?.a === 1 && Array.isArray(c.k)) for (const kf of c.k) { const v = Array.isArray(kf?.s) ? kf.s : null; if (v) vals.push(normHex(fcToHex(v))); }
          for (const v of vals) {
            if (v === themeFillCurrent) fill++;
            else if (v === themeStrokeCurrent) stroke++;
          }
        }
        if (Array.isArray(it.it)) walkItems(it.it);
      }
    };
    walkItems(l.shapes);
  });
  return { fill, stroke };
}

/* 把某一族颜色值整族换掉(kind: 'fill' | 'stroke' 只是标识哪一族),返回替换处数。
 * 注意:替换按**颜色值**匹配,填充与描边都换 —— 同一族颜色在这套素材里两种位置都出现过。 */
function applyThemeColor(kind: 'fill' | 'stroke', hex: string): number {
  if (!currentData) return 0;
  const from = kind === 'fill' ? themeFillCurrent : themeStrokeCurrent;
  const to = normHex(hex);
  if (!/^#[0-9a-f]{6}$/.test(to) || to === from) return 0;
  let n = 0;
  walkEditableLayers(currentData, (l) => {
    if (l.ty !== 4 || l.td === 1) return; // 蒙版源图层不渲染,跳过(理由见 countThemeColors)
    const walkItems = (items: any[]) => {
      for (const it of items ?? []) {
        if (it.ty === 'fl' || it.ty === 'st') n += replaceShapeColorValue(it.c, from, to);
        if (Array.isArray(it.it)) walkItems(it.it);
      }
    };
    walkItems(l.shapes);
  });
  if (kind === 'fill') themeFillCurrent = to;
  else themeStrokeCurrent = to;
  return n;
}

/* 同步两个色块的显示值与计数(切换动画、改色之后都要刷新) */
function syncThemeSection(data: any = currentData) {
  setColorPickerValue(themeFill, themeFillCurrent);
  setColorPickerValue(themeStroke, themeStrokeCurrent);
  const c = data ? countThemeColors(data) : { fill: 0, stroke: 0 };
  themeCount.textContent = '· 默认填充色 ' + c.fill + ' 处 / 描边默认色 ' + c.stroke + ' 处';
  themeSection.hidden = !(c.fill || c.stroke);
  void btnThemeReset;
}

/* 应用并重建(防抖:拖色块会连续触发,和文字/颜色编辑共用 textEditTimer) */
let themeEditTimer: number | undefined;
function onThemeColorChanged(kind: 'fill' | 'stroke', hex: string) {
  const n = applyThemeColor(kind, hex);
  if (!n) { syncThemeSection(); return; }
  syncThemeSection();
  setStatus((kind === 'fill' ? '默认填充颜色' : '描边默认颜色') + '已改为 ' + normHex(hex).toUpperCase() + '(共替换 ' + n + ' 处)');
  window.clearTimeout(themeEditTimer);
  themeEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
}
bindColorPicker(themeFill, (hex) => onThemeColorChanged('fill', hex));
bindColorPicker(themeStroke, (hex) => onThemeColorChanged('stroke', hex));
btnThemeReset.addEventListener('click', () => {
  let n = 0;
  n += applyThemeColor('fill', THEME_FILL_DEFAULT);
  n += applyThemeColor('stroke', THEME_STROKE_DEFAULT);
  syncThemeSection();
  setStatus(n ? '主题颜色已恢复为 #77B0F0 / #78C5F3' : '主题颜色已经是默认值');
  if (n) reRenderPreservingState();
});

/* ---------- 形状图层颜色 ---------- */
/* 深度收集形状图层内的填充项(ty 'fl')与描边项(ty 'st'),含组内嵌套(it.it)。
 * 返回的是 JSON 里的原始对象引用,调用方直接原地改 c.k 即可。 */
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

/* 汇总每个形状图层的可编辑颜色:填充/描边各取第一个,且只接受静态色(c.a === 0)。
 * 带关键帧的颜色不提供编辑 —— 只改单值会破坏整条颜色动画,宁可不显示控件。
 * 返回的 fill / stroke 是原始数组引用,null 表示该图层没有对应属性。 */
function shapeLayerColorInfo(data: any): { ind: number; nm: string; fill: number[] | null; stroke: number[] | null }[] {
  const out: { ind: number; nm: string; fill: number[] | null; stroke: number[] | null }[] = [];
  walkEditableLayers(data, (l, precompName) => {
    if (l.ty !== 4) return;
    if (l.td === 1) return; // 轨道蒙版源图层不渲染,无需编辑颜色(如位置暴露动画的「底框」)
    const { fills, strokes } = collectShapeFillsStrokes(l.shapes);
    const fill = fills.length > 0 && fills[0].c?.a === 0 ? fills[0].c.k : null;
    const stroke = strokes.length > 0 && strokes[0].c?.a === 0 ? strokes[0].c.k : null;
    out.push({ ind: l.ind, nm: displayLayerName(l.nm, precompName), fill, stroke });
  });
  return out;
}

const originalShapeState = new Map<number, { fill: number[] | null; stroke: number[] | null }>();

/* 快照形状图层的原始填充/描边色,供「重置颜色」还原(与文字快照同理,写的是副本)。
 * 属性不存在时存 null,重置时跳过,避免凭空给图层加出一个填充或描边。 */
function captureOriginalShapeState(data: any) {
  originalShapeState.clear();
  for (const s of shapeLayerColorInfo(data)) {
    originalShapeState.set(s.ind, {
      fill: s.fill ? [...s.fill] : null,
      stroke: s.stroke ? [...s.stroke] : null,
    });
  }
}

/* ---------- 图层透明度自定义 ----------
 * 记录每个图层的原始不透明度(含动画关键帧),供滑块修改与重置。
 * 静态不透明度直接改 ks.o.k;动画不透明度按比例缩放关键帧,保留淡入淡出形态。 */
const originalOpacityState = new Map<number, { a: number; k: any }>();

/* 快照每个图层的不透明度:记录 o.a(0 = 静态值、1 = 关键帧数组)与深拷贝的 o.k。
 * 深拷贝是必须的:setLayerOpacity 会按比例改写关键帧里的数值,若没有独立的原始副本,
 * 连续拖动滑块就会在「上一次的结果」上反复缩放,越改越偏。 */
function captureOpacityState(data: any) {
  originalOpacityState.clear();
  // 顶层 + 被引用的预合成内部都要快照:预合成里的图层同样有透明度滑块
  walkEditableLayers(data, (l) => {
    if (l.ks?.o) {
      originalOpacityState.set(l.ind, { a: l.ks.o.a, k: JSON.parse(JSON.stringify(l.ks.o.k)) });
    }
  });
}

/* 读取图层当前的不透明度(0~100 的整数),用作滑块初值。
 * 静态层(o.a === 0)直接读 o.k;带关键帧的层取所有关键帧的最大值 —— 滑块代表
 * 「该图层最亮时的不透明度」,取首帧会把淡入的图层显示成 0%。 */
function getLayerOpacity(layer: any): number {
  const o = layer?.ks?.o;
  if (!o) return 100;
  if (o.a === 0) {
    const v = Number(o.k);
    return isFinite(v) ? Math.round(v) : 100;
  }
  let max = 0;
  for (const kf of Array.isArray(o.k) ? o.k : []) {
    const v = Number(Array.isArray(kf.s) ? kf.s[0] : kf.s);
    if (isFinite(v) && v > max) max = v;
  }
  return Math.round(max);
}

/* 设置图层不透明度(0~100)。
 * 静态层直接赋值;带关键帧的层按 value ÷ 原始峰值 等比缩放每个关键帧,保持淡入淡出的相对
 * 形态,而不是把所有关键帧压成同一个值。
 * 比例始终以 originalOpacityState 里的原始值为基准(而非当前值),反复拖动不会累积误差。 */
function setLayerOpacity(layer: any, value: number) {
  const o = layer?.ks?.o;
  if (!o) return;
  const orig = originalOpacityState.get(layer.ind);
  if (o.a === 0) {
    o.k = value;
  } else if (orig && orig.a === 1) {
    const origArr = Array.isArray(orig.k) ? orig.k : [];
    let maxOrig = 0;
    for (const kf of origArr) {
      const v = Number(Array.isArray(kf.s) ? kf.s[0] : kf.s);
      if (isFinite(v) && v > maxOrig) maxOrig = v;
    }
    const scale = maxOrig > 0 ? value / maxOrig : 1;
    const arr = Array.isArray(o.k) ? o.k : [];
    arr.forEach((kf: any, i: number) => {
      const os = origArr[i]?.s;
      if (os === undefined) return;
      const oNum = Number(Array.isArray(os) ? os[0] : os);
      const nv = isFinite(oNum) ? oNum * scale : oNum;
      if (Array.isArray(kf.s)) kf.s[0] = nv;
      else kf.s = nv;
    });
  }
}

/* 从快照恢复不透明度:o.a 与 o.k 一起还原,并对 o.k 再做一次深拷贝断开与快照的共享引用。
 * 最后回写对应的 .o-slider 与数值标签 —— 列表是动态重建的,这里用 document 全局查询
 * 按 data-ind 定位当前可见的那个滑块。 */
function resetLayerOpacity(ind: number) {
  if (!currentData) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  const orig = originalOpacityState.get(ind);
  if (!orig) return;
  const o = layer.ks?.o;
  if (!o) return;
  o.a = orig.a;
  o.k = JSON.parse(JSON.stringify(orig.k));
  const sl = document.querySelector<HTMLInputElement>('.o-slider[data-ind="' + ind + '"]');
  if (sl) {
    const v = getLayerOpacity(layer);
    sl.value = String(v);
    const valEl = sl.parentElement?.querySelector('.o-val');
    if (valEl) valEl.textContent = v + '%';
  }
}

/* 生成不透明度滑块的一段 HTML(0~100、step 1、带 % 后缀),文字/形状/图片三个列表共用。
 * 初值取 getLayerOpacity(带关键帧的图层即峰值);事件绑定统一由 bindOpacitySliders 完成。 */
function opacitySliderHtml(ind: number, layer: any): string {
  const v = layer ? getLayerOpacity(layer) : 100;
  return (
    '<label class="t-opacity">不透明度 ' +
    '<input type="range" class="o-slider" data-ind="' + ind + '" min="0" max="100" step="1" value="' + v + '" />' +
    '<span class="o-val">' + v + '%</span></label>'
  );
}

/* 给 root 内所有 .o-slider 绑定输入处理(每次重写列表 HTML 后都要重新调用)。
 * 拖动过程中只改 JSON 和数值标签,防抖后才重建动画;与文字/颜色编辑共用 textEditTimer,
 * 避免多个编辑各自排队重建。 */
function bindOpacitySliders(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement>('.o-slider').forEach((sl) => {
    sl.addEventListener('input', () => {
      const ind = Number(sl.dataset.ind);
      const val = Number(sl.value);
      const valEl = sl.parentElement?.querySelector('.o-val');
      if (valEl) valEl.textContent = val + '%';
      if (!currentData) return;
      const layer = findLayerInData(currentData, ind);
      if (!layer) return;
      setLayerOpacity(layer, val);
      window.clearTimeout(textEditTimer);
      textEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
    });
  });
}

/* 写入形状图层所有填充项的静态色;hexToFc 传入原数组以保留第 4 个分量。
 * 只改 c.a === 0 的项,关键帧颜色原样不动(与列表只展示静态色保持一致)。 */
function setShapeFillColor(layer: any, hex: string) {
  const { fills } = collectShapeFillsStrokes(layer.shapes);
  for (const f of fills) if (f.c?.a === 0) f.c.k = hexToFc(hex, f.c.k);
}

/* 写入形状图层所有描边项的静态色,规则同 setShapeFillColor。 */
function setShapeStrokeColor(layer: any, hex: string) {
  const { strokes } = collectShapeFillsStrokes(layer.shapes);
  for (const s of strokes) if (s.c?.a === 0) s.c.k = hexToFc(hex, s.c.k);
}

/* 形状颜色编辑入口:kind 区分填充/描边,改完 250ms 防抖后重建动画。 */
function onShapeColorChanged(ind: number, hex: string, kind: 'fill' | 'stroke') {
  if (!currentData) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  if (kind === 'fill') setShapeFillColor(layer, hex);
  else setShapeStrokeColor(layer, hex);
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
}

/* 重置形状图层的填充/描边与不透明度,并把两个取色器及其 HEX 输入框同步回原始色。 */
function onShapeReset(ind: number) {
  if (!currentData) return;
  const orig = originalShapeState.get(ind);
  if (!orig) return;
  const layer = findLayerInData(currentData, ind);
  if (!layer) return;
  if (orig.fill) setShapeFillColor(layer, fcToHex(orig.fill));
  if (orig.stroke) setShapeStrokeColor(layer, fcToHex(orig.stroke));
  resetLayerOpacity(ind);
  const fi = shapeList.querySelector<HTMLInputElement>('.s-fill[data-ind="' + ind + '"]');
  if (fi && orig.fill) setColorPickerValue(fi, fcToHex(orig.fill));
  const si = shapeList.querySelector<HTMLInputElement>('.s-stroke[data-ind="' + ind + '"]');
  if (si && orig.stroke) setColorPickerValue(si, fcToHex(orig.stroke));
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 250);
}

/* 「形状图层」列表里隐藏颜色取色器的规则 —— 判据都是「这个颜色在这套素材里是占位色,不是设计色」,
 * 给用户一个改了也看不出效果的入口只会误导,所以干脆不展示(描边与填充各判各的):
 *  ① 填充为**纯红 #ff0000**:AE 里常用来做「不可见底 / 遮罩占位」,不是设计色;判定用纯红而非红系,
 *     红系里的 #d92c36 这类真正的设计红不受影响;
 *  ② 描边为**纯白 #ffffff**:本套素材里的白描边是 AE 默认描边(渲染上被填充盖住 / 只是占位),
 *     同理不展示;描边为**#5400ff**(任务弹窗动画预合成「框 › 形状图层 5」的紫色描边,全仓库只有这一层)
 *     同样只作占位、不参与画面配色,也不展示;
 *  ③ 核电站功率动画里几个形状图层的填充只是给描边/纹理垫底的占位色 —— 按图层名(去空格)排除;
 *  ④ 【例外】地图标题动画的「描边」图层反过来:白描边是设计色要放开,黑填充才是衬底要隐藏
 *     (与上面按颜色值的规则不同,这条按「动画 + 图层名」判定,详见 isMaptitleStrokeLayer)。 */
const HIDE_FILL_SHAPE_NAMES = new Set(['形状图层2', '形状图层3', '形状图层8', '形状图层6', '形状图层4']);
/* 占位色(0~1 归一化写进 JSON 时:#ff0000 → [1,0,0,1],#ffffff → [1,1,1,1]) */
const PLACEHOLDER_FILL_HEX = '#ff0000';
/* 不作为可编辑属性展示的描边色:#ffffff(AE 默认白描边)、#5400ff(预合成里的紫色占位描边) */
const PLACEHOLDER_STROKE_HEXES = new Set(['#ffffff', '#5400ff']);
function hideShapeFill(nm: string, fillHex: string | null = null, shape?: { nm: string; fill: number[] | null; stroke: number[] | null }): boolean {
  // 纯红填充:所有动画通用(不区分当前是哪套动画)
  if (fillHex === PLACEHOLDER_FILL_HEX) return true;
  // 地图标题动画的「描边」图层:只保留描边入口(原因见 isMaptitleStrokeLayer)
  if (shape && isMaptitleStrokeLayer(shape)) return true;
  if (currentAnimKey !== 'blinds') return false;
  return HIDE_FILL_SHAPE_NAMES.has(String(nm || '').replace(/\s+/g, ''));
}
/* 【特例图层】地图标题动画的「描边」图层:黑白两层同尺寸矩形,黑填充做衬底、
 * 1.5 宽的白色轮廓才是真正的视觉效果(两层靠「描边」图层多出来的 tm 修剪路径错开,
 * 白框才露得出来)。因此这一个图层上:
 *   • 白描边要**放开**编辑 —— 它沿用全局「纯白 = 占位描边」规则会被隐藏,侧栏就只剩填充入口;
 *   • 黑填充要**反过来隐藏** —— 它只是衬底,改它看不太出效果,露出来反而误导
 *     (与全局唯一会隐藏的「纯红占位填充」不是一回事,所以单独走一条规则)。
 * 判据必须同时限定「当前动画 + 图层名 + 该图层确实同时有填充与描边」:
 * 同动画的「底框」图层也有白描边,但它的白描边与黑填充完全重合(被黑填充盖住),
 * 把它露出来同样是个改了没效果的入口 —— 「有填充」正是区分这两层的依据。 */
function isMaptitleStrokeLayer(s: { nm: string; fill: number[] | null; stroke: number[] | null }): boolean {
  return currentAnimKey === 'maptitle'
    && String(s.nm || '').replace(/\s+/g, '') === '描边'
    && !!s.fill && !!s.stroke;
}
/* 白描边 / 紫色占位描边同样不作为可编辑属性展示(原因见上;地图标题动画的「描边」图层例外)。
 * 统一转小写再比对,免得数据里写成 #FFFFFF 或 #5400FF 时漏判。 */
function hideShapeStroke(strokeHex: string | null = null, shape?: { nm: string; fill: number[] | null; stroke: number[] | null }): boolean {
  if (shape && isMaptitleStrokeLayer(shape)) return false;
  return !!strokeHex && PLACEHOLDER_STROKE_HEXES.has(strokeHex.toLowerCase());
}

/* 渲染「形状图层」列表 HTML 并绑定控件(颜色、重置、图层不透明度)。
 * 矩形不透明度滑块只挂在该动画各段的「底框(可见)」图层上(dikuangVisibleInds 命中):
 * 它调的是底框内「矩形 1」形状组自己的 tr.o,与图层级不透明度不是一回事,
 * 所以走 dr-slider / dr-reset 这套独立类名与独立状态(见「底框黑色矩形独立透明度」区)。 */
function renderShapeList(data: any) {
  const shapes = shapeLayerColorInfo(data);
  shapeCount.textContent = '· ' + shapes.length + ' 个';
  shapeList.innerHTML = shapes
    .map((s) => {
      const fillHex = s.fill ? fcToHex(s.fill) : null;
      const strokeHex = s.stroke ? fcToHex(s.stroke) : null;
      let colorHtml = '';
      if (fillHex && !hideShapeFill(s.nm, fillHex, s)) colorHtml += '<label class="t-color-label">填充 <input type="color" class="s-fill" data-ind="' + s.ind + '" value="' + fillHex + '" /><input type="text" class="hex-input" value="' + fillHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      if (strokeHex && !hideShapeStroke(strokeHex, s)) colorHtml += '<label class="t-color-label">描边 <input type="color" class="s-stroke" data-ind="' + s.ind + '" value="' + strokeHex + '" /><input type="text" class="hex-input" value="' + strokeHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      const rectOpacityHtml =
        dikuangVisibleInds.includes(s.ind)
          ? '<label class="t-opacity">矩形不透明度 <input type="range" class="dr-slider" data-ind="' + s.ind + '" min="0" max="100" step="1" value="' + getDikuangRectOpacity(s.ind) + '" /><span class="o-val">' + getDikuangRectOpacity(s.ind) + '%</span><button class="t-reset dr-reset" data-ind="' + s.ind + '" type="button" title="重置矩形不透明度">' + ICON_RESET + '</button></label>'
          : '';
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(s.nm) + '</span>' +
        '<button class="t-reset s-reset" data-ind="' + s.ind + '" type="button" title="重置颜色">' + ICON_RESET + '重置</button>' +
        '</div>' +
        '<div class="shape-colors">' + colorHtml + '</div>' +
        opacitySliderHtml(s.ind, findLayerInData(data, s.ind)) +
        rectOpacityHtml +
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
  bindOpacitySliders(shapeList);
  // 底框黑色矩形透明度滑块
  shapeList.querySelectorAll<HTMLInputElement>('.dr-slider').forEach((sl) => {
    sl.addEventListener('input', () => {
      const v = Number(sl.value);
      const ind = Number(sl.dataset.ind);
      const valEl = sl.parentElement?.querySelector('.o-val');
      if (valEl) valEl.textContent = v + '%';
      setDikuangRectOpacity(v, ind);
    });
  });
  shapeList.querySelectorAll<HTMLButtonElement>('.dr-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ind = Number(btn.dataset.ind);
      resetDikuangRectOpacity(ind);
      const sl = shapeList.querySelector<HTMLInputElement>('.dr-slider[data-ind="' + ind + '"]');
      if (sl) {
        sl.value = String(getDikuangRectOpacity(ind));
        const valEl = sl.parentElement?.querySelector('.o-val');
        if (valEl) valEl.textContent = getDikuangRectOpacity(ind) + '%';
      }
    });
  });
}

/* ---------- 图片图层调色(百叶窗.png / 百叶窗2.png / 光.png / 叠加序列) ---------- */
/* 图片序列图层(带 ks.src 逐帧关键帧):核电站功率动画的两条叠加序列属于这一类。
 * 纹理图按名字识别、叠加序列按 ks.src 识别,两者在侧栏「图片图层」里统一调色/调透明度,
 * 但调色实现不同:纹理图逐张着色后替换资源 data URI,叠加序列用滤镜即时着色(见 syncSeqTintFilters)。 */
function isSeqLayer(l: any): boolean {
  return !!(l && l.ty === 2 && l.ks && l.ks.src && Array.isArray(l.ks.src.k) && l.ks.src.k.length >= 2);
}

/* 侧栏「图片图层」要列的图层(可调色的纹理图 + 可调色的叠加序列)。
 * 顶层与被引用的预合成内部都收 —— 预合成里的纹理图同样可以调色/调透明度。 */
function tintableImageLayers(data: any): any[] {
  const out: any[] = [];
  walkEditableLayers(data, (l) => {
    if (l.ty === 2 && (l.nm === '百叶窗.png' || l.nm === '百叶窗2.png' || l.nm === '光.png' || isSeqLayer(l))) out.push(l);
  });
  return out;
}
/* 该动画要列在「图片图层」里的图层(黑潮爆破默认弹窗):
 *  · **普通位图**(提示条 / 图标 / HUD 底条 / 两张整幅图)—— 按资源(refId)去重后列出:
 *    同一个资源常被多层引用(提示条 image_1 被 6 层引用、HUD 底条 image_0 被 4 层引用),它们共享同一个
 *    asset.p,而调色本身就是"换资源",所以列一项就够,改一次所有引用处一起变;
 *  · **遮罩源图层**(被 tt>=1 的图层用 tp 指向)—— 它只提供遮罩形状,但自身颜色同样影响画面
 *    (遮罩是拿它的亮度/alpha 去切别的图层),所以照样列出来;
 *  · **逐帧序列**(AE 视频素材导出成的 image sequence:696 帧)—— 藏在「预合成 1」里,顶层遍历走不到,
 *    单独找引用 sequence_0 的那条图层当代表;它按图层 ind 记色、走 SVG 滤镜,不逐帧重编码。 */
function blastTintableLayers(data: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  /* 必须走 walkEditableLayers 而不是自己遍历 data.layers:HUD 底条(image_0)在「预合成 2」里、
   * 两张整幅图(image_4 / image_5)在「形状图层 3 合成 1 / 1 合成 2」里 —— 只走顶层会漏掉它们。
   * 该函数同时处理了「预合成内联副本」的去重(lottie 会把预合成的图层数组内联到引用它的图层上),
   * 所以同一个资源不会被列两次。 */
  let seqHost: any = null;
  walkEditableLayers(data, (l) => {
    if (!l) return;
    /* 逐帧序列的宿主:一条引用 sequence_0 的预合成图层(ty:0)。它内部那 696 条序列帧(lottie 会把
     * 预合成图层数组内联进来)refId 是 imgSeq_*,既没有 ks.src 也不是静态位图,不能当成"图片图层"列出,
     * 所以只认宿主、跳过 imgSeq_*。 */
    if (String(l.refId) === 'sequence_0' && !seqHost) { seqHost = l; return; }
    if (String(l.refId).startsWith('imgSeq_')) return;
    if (l.ty === 2 && typeof l.refId === 'string' && !isSeqLayer(l) && !seen.has(l.refId)) {
      seen.add(l.refId);
      out.push(l);
    }
  });
  /* 调色按宿主图层的 ind 记录,与 696 帧共用一份滤镜(见 syncSeqTintFilters / onImageColorChanged) */
  if (seqHost) out.push(seqHost);
  return out;
}

/* 图片图层在侧栏显示的图层名(预合成内容加「合成名 ›」前缀) */
function imageLayerDisplayName(data: any, layer: any): string {
  let name = layer?.nm || '(未命名)';
  for (const a of referencedPrecompAssets(data)) {
    if (findLayerByInd(a.layers, layer.ind)) return String(a.id) + PRECOMP_NAME_SEP + name;
  }
  return name;
}

/* 叠加序列在列表里的取色标识:用 'seq:<ind>' 与纹理图的资源 id 区分开 */
const SEQ_REF_PREFIX = 'seq:';
/* 叠加序列的出厂色(默认即挂这个颜色的滤镜):BLINDS_SEQUENCES 在文件后面的「载入来源」区声明,
 * 这里用函数按需查,避免模块初始化顺序问题 */
function sequenceDefaultHex(nm: string): string {
  return BLINDS_SEQUENCES.find((s) => s.name === nm)?.defaultHex ?? '#d82f28';
}
/* 解析列表用的 'seq:<ind>' 键;不带该前缀(即纹理图的资源 id)时返回 null,
 * 调用方据此回落到逐像素着色分支。 */
function seqIndOfRef(ref: string): number | null {
  if (!ref.startsWith(SEQ_REF_PREFIX)) return null;
  const n = Number(ref.slice(SEQ_REF_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}
/* 当前渲染器里该序列图层的元素(用于立刻套用/撤销调色滤镜)。
 * 按**图层名**找:黑潮爆破的序列宿主是预合成内的图层,它的渲染元素不在顶层 elements 里,
 * 但引用同一份预合成的顶层图层带着同样的名字?—— 不对,顶层那条名字是「预合成 1」。
 * 所以这里同时支持两种查找:按名字(核电站的叠加序列在顶层)与按"承载该序列的预合成元素"。 */
function seqLayerElementOf(nameOrInd: string | number): any {
  const els = (anim as any)?.renderer?.elements ?? [];
  if (typeof nameOrInd === 'string') {
    for (const el of els) if (el && el.data && el.data.nm === nameOrInd) return el;
    /* 宿主在预合成内(黑潮爆破的序列宿主在「预合成 1」里):找**承载它的那个预合成元素**,
     * 对它套滤镜等效于覆盖整条序列。判定分两层:
     *  ① 元素的 data.refId 指向的 assets 预合成里含该名字的图层(权威);
     *  ② 退一步:元素内联的 layers 里有该名字(lottie 会把预合成图层内联进来)。 */
    for (const el of els) {
      const refId = el && el.data ? String(el.data.refId) : '';
      if (refId) {
        const comp = (currentData?.assets ?? []).find((a: any) => String(a.id) === refId);
        if (comp && Array.isArray(comp.layers) && comp.layers.some((l: any) => l && l.nm === nameOrInd)) return el;
      }
    }
    for (const el of els) {
      if (el && el.data && Array.isArray(el.layers)) {
        const hit = el.layers.some((l: any) => l && l.nm === nameOrInd);
        if (hit) return el;
      }
    }
    return null;
  }
  for (const el of els) if (el && el.data && el.data.ind === nameOrInd) return el;
  return null;
}
/* 按核电站叠加序列的 ind 反查图层名(那边的键仍是 'seq:<ind>') */
function seqNameByInd(ind: number): string | null {
  for (const entry of seqEntries) if (entry.ind === ind) return entry.nm;
  return null;
}
/* 按名字取序列元素(语义化包装) */
function seqLayerElementByName(nm: string): any {
  return seqLayerElementOf(nm);
}

/* 渲染「图片图层」列表。两类图层的取色键不同:
 *  - 纹理图(百叶窗.png / 百叶窗2.png / 光.png)的 refId 就是 assets 里的资源 id,
 *    调色方式是替换该资源的 data URI,所以键用 refId;
 *  - 叠加序列逐帧换图(ks.src),没有单一资源可替换,调色走 SVG 滤镜,状态只按图层 ind
 *    记在 seqTints 里,所以键用 'seq:<ind>'。
 * 键通过 data-ref 传给回调,重置按钮复用同一个键。 */
function renderImageList(data: any) {
  /* 三套动画的「图片图层」来源不同:
   *  · 核电站功率:两条叠加序列(逐帧换图,走滤镜着色);
   *  · 位置暴露:百叶窗.png / 百叶窗2.png / 光.png 三张纹理(换资源 data URI);
   *  · 黑潮爆破默认弹窗:提示条 / 图标 / HUD 底条 / 遮罩源 / 两张整幅图 + 一段 696 帧序列(见下)。 */
  const layers = currentAnimKey === 'blast' ? blastTintableLayers(data) : tintableImageLayers(data);
  imageCount.textContent = '· ' + layers.length + ' 个';
  imageList.innerHTML = layers
    .map((l: any) => {
      /* 黑潮爆破的逐帧序列在数据里是一条引用 sequence_0 的 ty:0 图层(不是 ty:2,也没有 ks.src),
       * 对侧栏来说它就是"一条可调色的序列",所以这里统一按「引用 sequence_0」判定,
       * 键用 'seq:<ind>' —— 与核电站的叠加序列共用同一套滤镜着色机制。 */
      /* 黑潮爆破的逐帧序列用「宿主图层名」作键(见 seqNameKey 的注释:预合成内 ind 会被重新编号,不可用作键);
       * 核电站的叠加序列仍在顶层、ind 可靠,继续用 'seq:<ind>'。 */
      const blastSeq = currentAnimKey === 'blast' && String(l.refId) === 'sequence_0';
      const seq = blastSeq || isSeqLayer(l);
      const ref = blastSeq ? seqNameKey(String(l.nm ?? '')) : seq ? SEQ_REF_PREFIX + l.ind : String(l.refId);
      const asset = (data.assets ?? []).find((a: any) => a.id === l.refId);
      // 默认色:百叶窗.png 红色,百叶窗2.png 与 光.png 金色(#ffca5e),叠加序列为源纹理色
      /* 黑潮爆破的逐帧序列出厂不调色(未选过色时不生成滤镜,画面保持素材原样);
       * 其余序列(核电站)出厂即挂自己的默认色。 */
      const defaultHex = seq
        ? (blastSeq ? '' : sequenceDefaultHex(l.nm))
        : l.nm === '百叶窗.png' ? '#e23b3b' : '#ffca5e';
      /* 黑潮爆破的位图取色器的初值,按优先级:
       *  ① 用户已经改过的色;
       *  ② 该图层带 AE「填充」效果 → 显示**填充色**(画面里看到的就是它,改的也该是它);
       *  ③ 否则显示白色占位(素材是白色描边 + 半透明底,取色器代表"当前染色")。 */
      const blastFillTarget = currentAnimKey === 'blast' && !seq ? findFillTarget(data, l) : null;
      const blastFill = blastFillTarget && blastFillTarget.colorParam?.v
        ? { color: fcToHex(blastFillTarget.colorParam.v.k), alpha: 1 } : null;
      /* 采集「填充」原始色(只采一次):重置时要还原到动画原值,而不是硬编码一个色。 */
      if (blastFill && !blastFillOriginalColor.has(blastTintKey(String(l.refId)))) {
        const ck = blastFillTarget?.colorParam?.v?.k;
        if (Array.isArray(ck)) blastFillOriginalColor.set(blastTintKey(String(l.refId)), ck.slice());
      }
      const blastHex = currentAnimKey === 'blast' && !seq
        ? (blastTintHex.get(blastTintKey(String(l.refId))) ?? (blastFill ? blastFill.color : '#ffffff')) : null;
      const hex = blastHex ?? (seq
        ? (seqTints.get(seqTintKey(String(l.nm ?? ''))) ?? defaultHex ?? '')
        : asset && typeof asset.p === 'string' && asset.p.startsWith('data:image') ? defaultHex : '#ffffff');
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(imageLayerDisplayName(data, l)) + '</span>' +
        '<button class="t-reset i-reset" data-ref="' + esc(ref) + '" type="button" title="重置颜色">' + ICON_RESET + '重置</button>' +
        '</div>' +
        '<div class="shape-colors">' +
        '<label class="t-color-label">颜色 <input type="color" class="i-color" data-ref="' + esc(ref) + '" value="' + hex + '" /><input type="text" class="hex-input" value="' + hex + '" spellcheck="false" placeholder="#rrggbb" /></label>' +
        '</div>' +
        opacitySliderHtml(l.ind, l) +
        '</li>'
      );
    })
    .join('');
  imageList.querySelectorAll<HTMLInputElement>('.i-color').forEach((ci) => {
    bindColorPicker(ci, (hex) => onImageColorChanged(ci.dataset.ref || '', hex));
  });
  imageList.querySelectorAll<HTMLButtonElement>('.i-reset').forEach((btn) => {
    btn.addEventListener('click', () => onImageColorReset(btn.dataset.ref || ''));
  });
  bindOpacitySliders(imageList);
}

function findAssetByRef(data: any, refId: string): any {
  return (data.assets ?? []).find((a: any) => a.id === refId);
}

/* 百叶窗调色:拖动颜色时只记录目标色(防抖),停止后一次性着色并重建动画(保留当前帧)。
 * 从原始图片缓存着色,避免多次调色叠加偏差;着色本身也走缓存+快速循环,不再卡顿。 */
let imageTintTimer: number | undefined;
let pendingTintHex: string | null = null;

/* 调色的原始图:image_2_n 为二次扫描段百叶窗2、image_1_n 为二次扫描段光.png(合并后资源),image_1 为主段百叶窗 */
function baiyechuangOriginalUriOf(refId: string): string | null {
  if (refId === 'image_2_n') return baiyechuang2OriginalData;
  if (refId === 'image_1_n') return guangOriginalData;
  return baiyechuangOriginalData;
}

/* 图片颜色编辑入口,两条路径完全不同:
 *  - 叠加序列(seq: 前缀)只改滤镜,立即生效,不重建动画;
 *  - 纹理图从缓存的原始位图重新着色,再替换 assets 里的 data URI。
 * 纹理图拖取色器会连续触发,这里 200ms 防抖且只记最后一个颜色:着色加 toDataURL
 * (上万像素宽)是重活,每次都做会卡住拖动;每次都从原始位图着色(而不是在上次结果上
 * 再着色),避免多次调色的累计偏差。 */
/* 找出**决定该图片图层画面颜色**的 AE「填充」效果。
 * 关键:填充不一定挂在这张图自己身上 —— 黑潮爆破的 HUD 底条把填充挂在**引用它的预合成**
 * (「预合成 2」,ind 8)上,由整个预合成把内部内容统一刷色。所以两层都要查:
 *   ① 图层自身有填充 → 用它;
 *   ② 否则找「引用了本图层所在预合成的那个顶层图层」,它有填充就用它的。 */
function findFillTarget(data: any, layer: any): { layer: any; colorParam: any } | null {
  const own = (layer?.ef ?? []).find((e: any) => e.ty === 21 && e.en !== 0);
  if (own) {
    const colorParam = (own.ef ?? []).find((x: any) => x.ix === 3);
    if (colorParam?.v) return { layer, colorParam };
  }
  /* 本图层在哪份预合成里 → 谁引用了这份预合成 */
  const ownerId = referencedPrecompAssets(data)
    .find((a: any) => findLayerByInd(a.layers, layer?.ind))?.id;
  if (ownerId === undefined) return null;
  let hit: { layer: any; colorParam: any } | null = null;
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (hit) return;
      if (l && String(l.refId) === String(ownerId)) {
        const fe = (l.ef ?? []).find((e: any) => e.ty === 21 && e.en !== 0);
        const cp = fe ? (fe.ef ?? []).find((x: any) => x.ix === 3) : null;
        if (cp?.v) { hit = { layer: l, colorParam: cp }; return; }
      }
      if (Array.isArray(l?.layers)) walk(l.layers);
    }
  };
  walk(data?.layers);
  return hit;
}

function onImageColorChanged(refId: string, hex: string) {
  /* 黑潮爆破的位图:把资源换成"从原始位图重新着色"的 data URI。
   * 两条纪律:① 原始地址只在**尚未着色**时记录(着色后 p 已是 data URI,再记就把着色结果当原图了);
   * ② 着色完把按地址的位图缓存清掉,否则重建时会命中旧图、表现为"拖了颜色画面不动"。 */
  if (currentAnimKey === 'blast' && seqIndOfRef(refId) === null && !isSeqNameRef(refId)) {
    /* 该图层带 AE「填充」效果时,改的是**填充色**(画面里看到的颜色就是它,见 getFillEffect)——
     * 改完直接更新效果参数并重建,不碰底图素材。 */
    const entryLayer = blastTintableLayers(currentData).find((x: any) => String(x.refId) === refId) ?? null;
    const fillTarget = entryLayer ? findFillTarget(currentData, entryLayer) : null;
    if (fillTarget && fillTarget.colorParam?.v) {
      const fc = fillTarget.colorParam.v.k;
      if (!blastFillOriginalColor.has(blastTintKey(refId))) {
        blastFillOriginalColor.set(blastTintKey(refId), Array.isArray(fc) ? fc.slice() : [1, 1, 1]);
      }
      /* 参数与位图一起改:参数保证"重置/再次读列表"能拿到当前色,位图才是画面真正在读的东西
       * (见 bakeFillColor 的说明:导出走独立文档,滤镜不可靠)。 */
      fillTarget.colorParam.v.k = hexToFc(hex, Array.isArray(fc) ? fc : undefined);
      blastTintHex.set(blastTintKey(refId), hex);
      const alpha = getFillEffect(fillTarget.layer)?.alpha ?? 1;
      window.clearTimeout(imageTintTimer);
      imageTintTimer = window.setTimeout(() => {
        void bakeFillColor(fillTarget.layer, hex, alpha).then(() => {
          reRenderPreservingState();
          setStatus('填充颜色已改为 ' + hex);
        });
      }, 150);
      return;
    }
    const asset = findAssetByRef(currentData, refId);
    if (!asset) return;
    if (typeof asset.p === 'string' && !isBlastTintedUri(asset.p)) {
      blastOriginalImageUri.set(blastTintKey(refId), asset.p);
    }
    const original = blastOriginalImageUri.get(blastTintKey(refId));
    if (!original) return;
    blastTintHex.set(blastTintKey(refId), hex);
    pendingTintHex = hex;
    window.clearTimeout(imageTintTimer);
    imageTintTimer = window.setTimeout(() => {
      const h = pendingTintHex;
      if (!h) return;
      void getImageTintSource(original)
        .then((src) => {
          const tinted = tintImageDataMultiply(src.data, h);
          const canvas = document.createElement('canvas');
          canvas.width = src.img.width;
          canvas.height = src.img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.putImageData(tinted, 0, 0);
          asset.p = canvas.toDataURL('image/png');
          invalidateBitmapCaches(asset, original);
          reRenderPreservingState();
          setStatus('图片图层已着色 ' + h);
        })
        .catch((e) => console.error('[图片图层着色失败]', e));
    }, 200);
    return;
  }
  // 叠加序列:滤镜着色,立即生效(无需重建动画、无需逐帧重新编码 359×2 张 PNG)
  /* 序列调色两种键:黑潮爆破用 'seqname:<图层名>',核电站用 'seq:<ind>' —— 都归到图层名上记录,
   * 因为滤镜按名字生成/挂载(见 seqTintHexOfLayer 的注释:预合成内 ind 会被重新编号)。 */
  if (isSeqNameRef(refId) || seqIndOfRef(refId) !== null) {
    const nm = isSeqNameRef(refId) ? refId.slice(SEQ_NAME_PREFIX.length) : seqNameByInd(seqIndOfRef(refId) as number);
    if (!nm) return;
    seqTints.set(seqTintKey(nm), hex);
    syncSeqTintFilters();
    const el = seqLayerElementByName(nm);
    if (el) applySeqTintToSvg(el);
    setStatus('序列已着色 ' + hex);
    return;
  }
  const originalUri = baiyechuangOriginalUriOf(refId);
  if (!currentData || !originalUri) return;
  const asset = findAssetByRef(currentData, refId);
  if (!asset) return;
  pendingTintHex = hex;
  window.clearTimeout(imageTintTimer);
  imageTintTimer = window.setTimeout(() => {
    const h = pendingTintHex;
    if (!h) return;
    void getImageTintSource(originalUri)
      .then((src) => {
        const tinted = tintImageDataFast(src.data, h);
        const canvas = document.createElement('canvas');
        canvas.width = src.img.width;
        canvas.height = src.img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(tinted, 0, 0);
        asset.p = canvas.toDataURL('image/png');
        // 纹理透明度较低(如百叶窗2 34%、光 40%)时,着色后的颜色会被透明度压暗,
        // 看起来"选了颜色却看不出颜色"。调色时自动把该图层透明度提升到 100%,
        // 让所选颜色立即可见;用户随后可在下方透明度滑块手动调整。
        const layer = (currentData.layers ?? []).find((l: any) => l.ty === 2 && l.refId === refId);
        if (layer) {
          const maxV = getLayerOpacity(layer);
          if (maxV > 0 && maxV < 100) {
            const o = layer.ks?.o;
            const scale = 100 / maxV;
            const arr = Array.isArray(o?.k) ? o.k : [];
            arr.forEach((kf: any) => {
              const ov = Array.isArray(kf.s) ? kf.s[0] : kf.s;
              if (isFinite(Number(ov))) {
                const nv = Number(ov) * scale;
                if (Array.isArray(kf.s)) kf.s[0] = nv; else kf.s = nv;
              }
            });
            const sl = imageList.querySelector<HTMLInputElement>('.o-slider[data-ind="' + layer.ind + '"]');
            if (sl) {
              sl.value = '100';
              const valEl = sl.parentElement?.querySelector('.o-val');
              if (valEl) valEl.textContent = '100%';
            }
            setStatus('纹理透明度已自动提升到 100%(使颜色可见),可在下方滑块调整');
          }
        }
        reRenderPreservingState();
      })
      .catch((e) => console.error('[百叶窗着色失败]', e));
  }, 200);
}

/* 图片颜色重置:
 *  - 叠加序列删除手动着色记录回到出厂色,滤镜保持挂着(序列本身靠滤镜着色),同时恢复该
 *    图层的不透明度,立即生效不重建;
 *  - 纹理图把资源 data URI 换回缓存的原始图,取色器与滑块同步回默认色,并重建预览。 */
function onImageColorReset(refId: string) {
  /* 黑潮爆破的位图:把资源换回原始地址、清缓存、清掉记录 —— 相当于"从没调过色" */
  if (currentAnimKey === 'blast' && seqIndOfRef(refId) === null && !isSeqNameRef(refId)) {
    /* 带 AE「填充」效果的图层:重置 = 把填充色还原成动画原始值(记在 fillOriginalColor 里) */
    const entryLayer2 = blastTintableLayers(currentData).find((x: any) => String(x.refId) === refId) ?? null;
    const fillTarget2 = entryLayer2 ? findFillTarget(currentData, entryLayer2) : null;
    const orig = blastFillOriginalColor.get(blastTintKey(refId));
    if (fillTarget2?.colorParam?.v && orig) {
      fillTarget2.colorParam.v.k = orig.slice();
      blastTintHex.delete(blastTintKey(refId));
      /* 位图也要还原:烘焙是写进 asset.p 的,不改回来画面不会变 */
      for (const rid of gatherImageRefIds(currentData, fillTarget2.layer)) {
        const uri = fillBakeOriginalUri.get(blastTintKey(rid));
        const asset0 = (currentData.assets ?? []).find((a: any) => String(a.id) === rid);
        if (uri && asset0) { asset0.p = uri; invalidateBitmapCaches(asset0, uri); }
      }
      const ci0 = imageList.querySelector<HTMLInputElement>('.i-color[data-ref="' + refId + '"]');
      if (ci0) setColorPickerValue(ci0, fcToHex(orig));
      reRenderPreservingState();
      setStatus('填充颜色已还原为 ' + fcToHex(orig));
      return;
    }
    const asset = findAssetByRef(currentData, refId);
    const original = blastOriginalImageUri.get(blastTintKey(refId));
    if (!asset || !original) return;
    asset.p = original;
    blastTintHex.delete(blastTintKey(refId));
    invalidateBitmapCaches(asset, original);
    const ci = imageList.querySelector<HTMLInputElement>('.i-color[data-ref="' + refId + '"]');
    if (ci) setColorPickerValue(ci, '#ffffff');
    reRenderPreservingState();
    setStatus('图片图层已恢复原始素材色');
    return;
  }
  // 叠加序列:撤销手动着色,回到出厂色 #d82f28(滤镜仍然挂着),不重建动画
  if (isSeqNameRef(refId) || seqIndOfRef(refId) !== null) {
    const nm = isSeqNameRef(refId) ? refId.slice(SEQ_NAME_PREFIX.length) : seqNameByInd(seqIndOfRef(refId) as number);
    if (!nm) return;
    seqTints.delete(seqTintKey(nm));
    syncSeqTintFilters();
    const el = seqLayerElementByName(nm);
    if (el) applySeqTintToSvg(el);
    /* 恢复该序列的不透明度(调色时自动提到 100%,重置时一并还原) */
    const layer = findLayerInData(currentData, (currentData?.layers ?? []).find((l: any) => l.nm === nm)?.ind ?? -1)
      ?? (currentData?.layers ?? []).find((l: any) => l.nm === nm);
    if (layer && typeof layer.ind === 'number') resetLayerOpacity(layer.ind);
    const ci = imageList.querySelector<HTMLInputElement>('.i-color[data-ref="' + refId + '"]');
    const fallback = isBlindsSequenceName(nm) ? sequenceDefaultHex(nm) : '#ffffff';
    if (ci) setColorPickerValue(ci, fallback);
    setStatus(isBlindsSequenceName(nm) ? '叠加序列已恢复默认色 ' + fallback : '序列已恢复原始素材色');
    return;
  }
  const originalUri = baiyechuangOriginalUriOf(refId);
  if (!currentData || !originalUri) return;
  const asset = findAssetByRef(currentData, refId);
  if (!asset) return;
  asset.p = originalUri;
  // 默认色:主段百叶窗红色,百叶窗2/光金色
  const defaultHex = refId === 'image_1' ? '#e23b3b' : '#ffca5e';
  const ci = imageList.querySelector<HTMLInputElement>('.i-color[data-ref="' + refId + '"]');
  if (ci) setColorPickerValue(ci, defaultHex);
  const layer = (currentData.layers ?? []).find((l: any) => l.ty === 2 && l.refId === refId);
  if (layer) resetLayerOpacity(layer.ind);
  reRenderPreservingState();
}

/* ---------- AE 投影效果(ADBE Drop Shadow)渲染 ----------
 * lottie-web 不渲染 AE 效果,这里手动解析「投影」参数并渲染:
 * - SVG 渲染器:对图层 <g> 应用 CSS drop-shadow filter;
 * - Canvas 渲染器:双次绘制(先带阴影画内容,再清晰覆盖)。 */
/* 从图层效果列表里读出 AE「投影」(ADBE Drop Shadow)参数。
 * lottie-web 不渲染任何 AE 效果(ef 字段),必须自己解析:
 *  - e.ty === 25 是投影类型,e.mn 是效果名,e.en === 0 表示效果被关掉,跳过;
 *  - 参数按 ix 索引取:1 颜色、2 不透明度、3 角度、4 距离、5 柔化。
 * 三处单位换算的坑:
 *  - 不透明度是 0~255(不是 0~1),要除 255 再钳到 [0,1];
 *  - 角度是度且 0° 指向上方,而屏幕 y 轴向下,所以 dy 取负、dx 用 cos;
 *  - 柔化值到 CSS blur 半径是经验换算 /2,直接当半径会明显糊成一片。
 * 参数缺失或结构异常时返回 null,调用方保持原样渲染。 */
function getDropShadow(layer: any): { color: string; alpha: number; dx: number; dy: number; blur: number } | null {
  const ef = layer?.ef;
  if (!Array.isArray(ef)) return null;
  const ds = ef.find((e: any) => e.ty === 25 && e.mn === 'ADBE Drop Shadow' && e.en !== 0);
  if (!ds || !Array.isArray(ds.ef)) return null;
  const getVal = (ix: number) => {
    const p = ds.ef.find((x: any) => x.ix === ix);
    return p ? p.v?.k : undefined;
  };
  const color = getVal(1);
  const opacity = getVal(2);
  const angle = getVal(3);
  const distance = getVal(4);
  const softness = getVal(5);
  if (!Array.isArray(color) || typeof opacity !== 'number' || typeof angle !== 'number' || typeof distance !== 'number') return null;
  const rad = (angle * Math.PI) / 180;
  return {
    color: fcToHex([color[0], color[1], color[2]]),
    alpha: Math.max(0, Math.min(1, opacity / 255)),
    dx: distance * Math.cos(rad),
    dy: -distance * Math.sin(rad),
    blur: (typeof softness === 'number' ? softness : 0) / 2,
  };
}

/* 拼出 SVG 渲染器用的 filter 字符串:drop-shadow(dx dy blur #rrggbbaa)。
 * CSS 的 8 位十六进制颜色把 alpha 直接写在颜色里,这里由 0~1 的 alpha 换算成两位。 */
function dropShadowCss(ds: { color: string; alpha: number; dx: number; dy: number; blur: number }): string {
  const a = Math.round(ds.alpha * 255).toString(16).padStart(2, '0');
  return 'drop-shadow(' + ds.dx.toFixed(2) + 'px ' + ds.dy.toFixed(2) + 'px ' + ds.blur.toFixed(2) + 'px ' + ds.color + a + ')';
}

/* 拼出 Canvas 渲染器用的 rgba() 颜色字符串(0~255 的整数分量 + 0~1 的 alpha)。 */
function dropShadowRgba(ds: { color: string; alpha: number; dx: number; dy: number; blur: number }): string {
  return 'rgba(' + parseInt(ds.color.slice(1, 3), 16) + ',' + parseInt(ds.color.slice(3, 5), 16) + ',' + parseInt(ds.color.slice(5, 7), 16) + ',' + ds.alpha + ')';
}

/* 给 SVG 渲染器里的单个图层挂投影:直接写 layerElement(即图层的 <g>)的 style.filter。
 * 由 patchSvgRendererTree 在动画载入/重建时逐层调用;重复调用是幂等的(整串赋值),
 * 不会叠加出双重阴影。 */
function patchSvgDropShadow(el: any) {
  if (!el.layerElement) return;
  /* 只处理投影。AE「填充」不在这里实现 —— 见 bakeFillColor 的说明:
   * 导出把当帧 SVG 序列化成**独立文档**用 <img> 加载,该环境下 CSS/SVG filter 不可靠,
   * 挂滤镜会导致导出画面缺层。填充改为"烘焙进位图资源",预览与导出走同一条位图路径。 */
  const ds = getDropShadow(el.data);
  el.layerElement.style.filter = ds ? dropShadowCss(ds) : '';
}

/* ---------- AE「填充」的落地方式:烘焙进位图 ----------
 * 为什么不用 CSS/SVG filter:导出走「SVG 逐帧光栅化」——把当帧 SVG 序列化成**独立文档**再用 <img> 加载;
 * 实测该环境里 CSS filter 与 SVG <filter>(feFlood+feComposite、feColorMatrix 都试过)**均不产出像素**
 * (滤镜定义内联或外链都一样),结果是导出画面直接缺掉整层,而预览正常(预览里滤镜在同文档内、能解析)。
 * 所以改成站点最擅长的那条路:**把颜色烘焙进位图资源**(与「百叶窗.png」调色完全同一套):
 *   · 填充挂在**图片图层**上 → 着色该图层的资源;
 *   · 填充挂在**预合成**上(HUD 底条就是这样) → 着色该预合成内部的位图资源。
 * 预览与导出读的都是同一个 asset.p,两边天然一致,且不依赖任何滤镜。 */
const fillBakeOriginalUri = new Map<string, string>(); // '动画key:refId' → 该资源的原始地址

/* 该图层(或它引用的预合成)覆盖到的所有位图资源 id */
function gatherImageRefIds(data: any, layer: any): string[] {
  const out: string[] = [];
  const push = (id: unknown) => {
    const s = String(id);
    if (s && s !== 'undefined' && out.indexOf(s) < 0) out.push(s);
  };
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l?.ty === 2 && typeof l.refId === 'string') push(l.refId);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  if (layer?.ty === 2 && typeof layer.refId === 'string') push(layer.refId);
  const refId = typeof layer?.refId === 'string' ? layer.refId : '';
  if (refId) {
    const comp = (data?.assets ?? []).find((a: any) => String(a.id) === refId);
    if (comp && Array.isArray(comp.layers)) walk(comp.layers);
  }
  if (Array.isArray(layer?.layers)) walk(layer.layers);
  return out;
}

/* 按当前填充参数把颜色烘焙到相关位图:目标色与**原素材像素**按 alpha 混合。 */
async function bakeFillColor(layer: any, color: string, alpha: number): Promise<void> {
  if (!currentData) return;
  for (const refId of gatherImageRefIds(currentData, layer)) {
    const asset = (currentData.assets ?? []).find((a: any) => String(a.id) === refId);
    if (!asset || typeof asset.p !== 'string') continue;
    const key = blastTintKey(refId);
    if (!fillBakeOriginalUri.has(key) && !isBlastTintedUri(asset.p)) {
      fillBakeOriginalUri.set(key, asset.p);
    }
    const original = fillBakeOriginalUri.get(key);
    if (!original) continue;
    try {
      const src = await getImageTintSource(original);
      const canvas = document.createElement('canvas');
      canvas.width = src.img.width;
      canvas.height = src.img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const tinted = tintImageDataMultiply(src.data, color);
      const out = new ImageData(new Uint8ClampedArray(src.data.data), src.data.width, src.data.height);
      const d0 = src.data.data, d1 = tinted.data, d2 = out.data;
      for (let i = 0; i < d2.length; i += 4) {
        for (let c = 0; c < 3; c++) d2[i + c] = Math.round(d0[i + c] * (1 - alpha) + d1[i + c] * alpha);
      }
      ctx.putImageData(out, 0, 0);
      asset.p = canvas.toDataURL('image/png');
      invalidateBitmapCaches(asset, original);
    } catch (e) {
      console.error('[填充烘焙失败]', e);
    }
  }
}

/* ---------- AE 填充效果(ADBE Fill)解析 ----------
 * lottie-web 不渲染 AE 效果,所以「填充」要自己补:它把图层内容整体刷成指定颜色(保留 alpha 形状),
 * 画面里那条青色 HUD 底条就是这么来的 —— 「预合成 2」上挂着 ty:21「填充」,颜色 #81CAF6。
 * 这里只负责**解析参数**;真正落地见 bakeFillColor(烘焙进位图,预览与导出同一份数据)。
 * 参数:ix 1=填充蒙版、2=所有蒙版、3=颜色、4=反转、5=水平羽化、6=垂直羽化、7=不透明度。
 * 只支持无蒙版约束、无羽化、无反转的常见形态(本项目数据就是这种);其余形态返回 null 不处理,
 * 免得画出与 AE 不一致的东西。 */
type FillEffect = { color: string; alpha: number };
function getFillEffect(layer: any): FillEffect | null {
  const ef = layer?.ef;
  if (!Array.isArray(ef)) return null;
  const fill = ef.find((e: any) => e.ty === 21 && e.mn === 'ADBE Fill' && e.en !== 0);
  if (!fill || !Array.isArray(fill.ef)) return null;
  const getVal = (ix: number) => {
    const p = fill.ef.find((x: any) => x.ix === ix);
    return p ? p.v?.k : undefined;
  };
  const color = getVal(3);
  if (!Array.isArray(color)) return null;
  // 带蒙版约束 / 羽化 / 反转的形态不支持(会与 AE 结果不一致,宁可不画)
  if (Number(getVal(1)) !== 0 || Number(getVal(2)) !== 0) return null;
  if (Number(getVal(4)) !== 0) return null;
  if (Number(getVal(5)) !== 0 || Number(getVal(6)) !== 0) return null;
  const opacity = getVal(7);
  /* Bodymovin 对「填充」的不透明度有两种写法:0~1 的小数(实测本项目是 0.5 / 1)或 0~100 的百分数。
   * 早期按百分数一律 /100,把 0.5 变成了 0.005 —— 填充几乎全透明,表现为"改了颜色画面没反应"。
   * 判据:值 > 1 才当百分数。 */
  let alpha = 1;
  if (typeof opacity === 'number' && isFinite(opacity)) {
    alpha = opacity > 1 ? opacity / 100 : opacity;
    alpha = Math.max(0, Math.min(1, alpha));
  }
  return { color: fcToHex([color[0], color[1], color[2]]), alpha };
}

/* 填充滤镜的 CSS filter 串:colorize(换成目标色) + 可选的 alpha 缩放。
 * alpha 用站点既有的离屏滤镜(df-fill-alpha-*),由 ensureFillAlphaFilter 懒创建。 */
/* 注:AE「填充」不再用 SVG 滤镜实现 —— 导出把当帧 SVG 序列化成独立文档用 <img> 加载,
 * 该环境下 CSS/SVG filter 实测不产出像素(会缺层)。改走 bakeFillColor 的位图烘焙。 */


/* 给 Canvas 渲染器里的图层补投影:包装该图层的 renderFrame,一帧画两次 ——
 * 第一次设好 shadowColor/Blur/Offset 后照常画(内容被盖住,只留下外扩的阴影),
 * restore 之后再清晰地画一遍覆盖上去。
 * 必须画两次:ctx 的阴影会作用于每一笔画出来的内容,单次绘制会把文字、图标本身糊掉。
 * 代价是该图层每帧多画一遍,只有带投影的图层才走这条路径。 */
function patchCanvasDropShadow(el: any) {
  const ds = getDropShadow(el.data);
  if (!ds) return;
  const orig = el.renderFrame ? el.renderFrame.bind(el) : null;
  if (!orig) return;
  el.renderFrame = function (this: any, forceRender: boolean) {
    const ctx = this.canvasContext;
    if (!ctx) return orig(forceRender);
    ctx.save();
    ctx.shadowColor = dropShadowRgba(ds);
    ctx.shadowBlur = ds.blur;
    ctx.shadowOffsetX = ds.dx;
    ctx.shadowOffsetY = ds.dy;
    orig(forceRender);
    ctx.restore();
    orig(forceRender);
  };
}

/* ---------- 弹窗叠加层(windows_animation) ----------
 * windows_animation.json 与主动画同尺寸(1920×1080@60fps),作为可选叠加层显示:
 * - 由「显示弹窗」复选框控制显隐;
 * - 与主动画按帧号同步(goToAndStop),播放/暂停/拖动时间轴/渲染器切换都跟随主动画;
 * - 文字图层可改文字/颜色/对齐(默认居中,即文档数据 j=2,lottie 每帧按实际文字
 *   宽度原生居中,参考 renderInnerContent 中 doc.j 的对齐分支);
 * - 颜色图层可改填充/描边,但名称含「蒙版」的图层不可改色。 */
/* 弹窗叠加层状态:popupData 是解析后的 JSON(编辑文字/颜色改的是它,不是动画实例),
 * popupAnim 是独立于主动画的第二个 lottie 实例,popupLastFrame 与 tick 里的 lastFrame
 * 同理(初值 -1 保证首帧一定同步)。popupEditTimer 是弹窗文字编辑的防抖句柄。 */
let popupData: any = null;
let popupVisible = false; // 弹窗默认关闭,由「显示弹窗」复选框开启
let popupAnim: AnimationItem | null = null;
let popupLastFrame = -1;
let popupEditTimer: number | undefined;

/* 销毁弹窗实例并清空容器:destroy() 会移除 lottie 自己创建的 SVG/Canvas 节点。
 * 用 try/catch 兜底 —— 实例尚未加载完(或已被销毁过)时 destroy 可能抛错,
 * 重建流程不该因此中断。 */
function destroyPopupAnim() {
  if (popupAnim) {
    try { popupAnim.destroy(); } catch { /* ignore */ }
    popupAnim = null;
  }
  popupLayer.innerHTML = '';
}

/* 重建弹窗叠加层:渲染器切换、文字/形状编辑、重置后都要整体重建 —— 改 JSON 不会自动生效,
 * lottie 只在 loadAnimation 时读一次数据。
 * 两个关键点:
 *  - loop 与 autoplay 都关:弹窗帧号完全由 tick 按主动画帧号驱动(goToAndStop),
 *    自己播放会与主动画漂移;
 *  - 新实例要挂上与主动画相同的渲染补丁(patch*RendererTree),否则弹窗里的投影、
 *    文字兜底渲染等行为与主动画不一致。 */
function rebuildPopupOverlay() {
  destroyPopupAnim();
  // destroyAnim() 会清空 previewInner,弹窗层可能被移除,先重新挂回(即使当前隐藏也要保持挂载)
  if (!popupLayer.isConnected) previewInner.appendChild(popupLayer);
  if (!popupVisible || !popupData) {
    popupLayer.hidden = true;
    return;
  }
  popupLayer.hidden = false;
  popupLayer.style.width = popupData.w + 'px';
  popupLayer.style.height = popupData.h + 'px';
  try {
    const renderer = selRenderer.value === 'canvas' ? 'canvas' : 'svg';
    popupAnim = lottie.loadAnimation({
      container: popupLayer,
      renderer,
      loop: false,
      autoplay: false,
      animationData: popupData,
      audioFactory,
    });
    if (renderer === 'canvas') patchCanvasRendererTree((popupAnim as any).renderer);
    else patchSvgRendererTree((popupAnim as any).renderer);
    popupLastFrame = -1; // 下一帧 tick 自动同步到主动画当前帧
  } catch (e) {
    setStatus('弹窗载入失败: ' + (e as Error).message, true);
  }
}

/* 保留当前帧地重建弹窗:先取出帧号(新实例会从第 0 帧开始),重建成功后再 goToAndStop 回去,
 * 并同步 popupLastFrame,避免 tick 下一帧再做一次多余的跳帧。
 * popupAnim 为空(弹窗未显示或上次重建失败)时无事可做,直接返回。 */
function rebuildPopupPreservingState() {
  if (!popupAnim) return;
  const frame = popupAnim.currentFrame;
  rebuildPopupOverlay();
  if (popupAnim && typeof frame === 'number' && isFinite(frame)) {
    popupAnim.goToAndStop(frame, true);
    popupLastFrame = frame;
  }
}

/* 写入文字对齐方式 j(0 = 左、1 = 右、2 = 居中,取值同 AE/Bodymovin)。
 * 与 setLayerText 一样兼容关键帧数组与静态文档两种结构;j = 2 时 lottie 每帧按实际文字宽度
 * 重新居中,所以改完文字不需要挪锚点。 */
function setLayerAlign(layer: any, j: number) {
  const td = layer?.t?.d?.k;
  if (!td) return;
  if (Array.isArray(td)) {
    for (const kf of td) if (kf.s) kf.s.j = j;
  } else if (td.s) {
    td.s.j = j;
  }
}

/* 取文字图层的文档对象(t.d.k → s):关键帧写法取第一段,静态写法直接取 s。
 * 与 textOfLayer 的区别是返回整个文档(含字号 s、字距 tr、对齐 j、字体 f),
 * 改对齐和量文字宽度都要用它。 */
function textDocOf(layer: any): any | null {
  const td = layer?.t?.d?.k;
  return (Array.isArray(td) ? td[0]?.s : td?.s) ?? null;
}

/* ---------- 弹窗宽度自适应文字宽度 ----------
 * 弹窗底板(「弹窗用的底板」「弹窗底部」)以锚点(合成 x=960)为中心,文字以自身
 * 锚点(x=975.11)为中心,j=2 居中排列。两者锚点距离固定,因此只要底板宽度增量
 * 与文字宽度增量一致,左右留白就保持恒定:
 *   新底板X缩放 = 原X缩放 × (底板原宽 + 文字增量) / 底板原宽
 * 文字增量按文字图层自身缩放折算为合成单位(本例 40.215%)。 */
/* 量文字宽度用的离屏 canvas 2D 上下文:懒创建后常驻复用。
 * measureText 只需要一个 ctx,不必挂进 DOM;若每次测量都新建 canvas,防抖后的每次编辑
 * (要量多行文字、两段底框与弹窗)都会持续分配。 */
let popupMeasureCtx: CanvasRenderingContext2D | null = null;

function getPopupMeasureCtx(): CanvasRenderingContext2D | null {
  if (!popupMeasureCtx) {
    popupMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  return popupMeasureCtx;
}

/* 用真实内嵌字体测量一段文字的最大行宽(文字空间 px,字号 = doc.s) */
function measurePopupTextWidth(text: string, doc: any): number {
  const ctx = getPopupMeasureCtx();
  if (!ctx || !doc || !doc.s) return 0;
  const fontDef = (popupData?.fonts?.list ?? []).find((f: any) => f.fName === doc.f || f.fFamily === doc.f);
  const family = (fontDef && fontDef.fFamily) || doc.f || 'sans-serif';
  ctx.font = doc.s + 'px "' + family + '"';
  const tracking = (doc.tr || 0) * 0.001 * (doc.s || 0); // 每字母字距(与 lottie 渲染一致)
  /* 多行文字取最长一行的宽度:底板/图标是按最长行居中的,只量第一行会算窄。 */
  let maxW = 0;
  for (const line of String(text).split('\r')) {
    const w = ctx.measureText(line).width + tracking * line.length;
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/* 弹窗文字图层的原始文字(用于计算增量) */
const popupOrigTexts = new Map<number, string>();

/* 弹窗底板几何:名称匹配的图层,记录基准 X 缩放与形状基准宽度 */
const POPUP_PANEL_NAMES = ['弹窗用的底板', '弹窗底部'];
let popupPanelBaseScaleX = 0;
let popupPanelBaseShapeW = 0;

/* 递归(含预合成)按名称找弹窗底板图层。名称是 AE 里的图层名,硬编码在 POPUP_PANEL_NAMES 里,
 * 换一份 AE 导出就要同步修改。返回原始图层对象引用,调用方就地改 ks.s。 */
function findPanelLayers(): any[] {
  if (!popupData) return [];
  const out: any[] = [];
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (POPUP_PANEL_NAMES.includes(l.nm)) out.push(l);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(popupData.layers);
  return out;
}

/* 弹窗文字图层缩放(本例 40.215%,静态) */
function popupTextLayerScale(): number {
  if (!popupData) return 1;
  for (const t of collectTextLayers(popupData)) {
    const layer = findLayerByInd(popupData.layers, t.ind);
    const s = layer?.ks?.s;
    if (s && s.a === 0 && Array.isArray(s.k) && s.k[0]) return s.k[0] / 100;
  }
  return 1;
}

/* 弹窗蒙版几何:记录其 X 缩放动画关键帧的基准值(终值 276.8) */
const POPUP_MASK_NAMES = ['蒙版'];
let popupMaskBaseKeys: { s: number[] }[] = [];

/* 找弹窗的「蒙版」图层:它的 X 缩放带关键帧(起始 0 → 终值),底板加宽时整条关键帧都要
 * 按同一个系数放大,否则动画中途会露出底板边缘。 */
function findMaskLayers(): any[] {
  if (!popupData) return [];
  const out: any[] = [];
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (POPUP_MASK_NAMES.includes(l.nm)) out.push(l);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(popupData.layers);
  return out;
}

/* 弹窗图标几何:感叹号字形(锚点右偏 204.8)与菱形底座(中心=锚点) */
const POPUP_ICON_NAMES = ['感叹号', '感叹号的底'];
const ICON_GAP = 4;      // 图标右缘与文字左缘的间距(合成单位,越小越靠右)
const ICON_HALF_W = 11.3; // 菱形底座包围盒半宽(18.25×0.87408×√2/2)

/* 找感叹号图标的两层(字形「感叹号」+ 菱形底座「感叹号的底」)。
 * 它们必须一起改 X 位置才能保持相对关系,见 positionPopupIcon。 */
function findIconLayers(): any[] {
  if (!popupData) return [];
  const out: any[] = [];
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (POPUP_ICON_NAMES.includes(l.nm)) out.push(l);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(popupData.layers);
  return out;
}

/* NULL CONTROL 父级原点合成X(= NULL_p.x - NULL_a.x,本例 789.136) */
function popupNullOriginX(): number {
  const nullLayer = (popupData?.layers ?? []).find((l: any) => l.nm === 'NULL CONTROL' || l.ind === 7);
  const p = nullLayer?.ks?.p, a = nullLayer?.ks?.a;
  if (p && a && p.a === 0 && a.a === 0) return p.k[0] - a.k[0];
  return 789.136;
}

/* 弹窗文字图层锚点的合成X(固定,j=2 居中中心) */
function popupTextAnchorCompX(): number {
  for (const t of collectTextLayers(popupData)) {
    const layer = findLayerByInd(popupData.layers, t.ind);
    const s = layer?.ks?.s, p = layer?.ks?.p, a = layer?.ks?.a;
    if (s && p && a && s.a === 0 && p.a === 0 && a.a === 0) {
      return popupNullOriginX() + p.k[0] - (s.k[0] / 100) * a.k[0];
    }
  }
  return 975.11;
}

/* 弹窗原始文字宽度(合成单位,测量 × 文字图层缩放) */
function popupOrigTextWidthComp(): number {
  let w = 0;
  for (const t of collectTextLayers(popupData)) {
    const layer = findLayerByInd(popupData.layers, t.ind);
    const doc = layer ? textDocOf(layer) : null;
    if (!doc) continue;
    const m = measurePopupTextWidth(popupOrigTexts.get(t.ind) ?? '', doc) * popupTextLayerScale();
    if (m > w) w = m;
  }
  return w;
}

/* 感叹号图标中心合成X:始终位于文字左缘左侧固定间距 */
function popupIconCenterCompX(deltaComp: number): number {
  const textLeft = popupTextAnchorCompX() - (popupOrigTextWidthComp() + deltaComp) / 2;
  return textLeft - ICON_GAP - ICON_HALF_W;
}

/* 定位感叹号图标(字形 + 菱形底座)到文字左侧,随文字左缘移动 */
function positionPopupIcon(deltaComp: number) {
  const cxNull = popupIconCenterCompX(deltaComp) - popupNullOriginX();
  for (const layer of findIconLayers()) {
    const p = layer?.ks?.p;
    if (!(p && p.a === 0 && Array.isArray(p.k))) continue;
    if (layer.nm === '感叹号的底') {
      p.k[0] = cxNull; // 菱形中心即锚点
    } else if (layer.nm === '感叹号') {
      p.k[0] = cxNull + 204.8; // 字形在锚点右侧 204.8(形状空间)
    }
  }
}

/* 文字宽度变化 → 同步调整底板/蒙版宽度与图标位置(增量一致,两侧留白不变) */
function adaptPopupPanelWidth() {
  /* 这里只改 popupData 里的几何数值,不碰动画实例 —— 调用方随后用 rebuildPopupPreservingState
   * 重建才会显示出来;两段基准几何未捕获(基准缩放/基准宽为 0)时直接放弃,避免除零。 */
  if (!popupData || popupPanelBaseScaleX <= 0 || popupPanelBaseShapeW <= 0) return;
  // 取所有文字图层中"增长最多"的增量(负数=整体变短,面板同样收窄)
  let deltaText: number | null = null;
  for (const t of collectTextLayers(popupData)) {
    const layer = findLayerByInd(popupData.layers, t.ind);
    const doc = layer ? textDocOf(layer) : null;
    if (!doc) continue;
    const cur = measurePopupTextWidth(doc.t ?? '', doc);
    const orig = measurePopupTextWidth(popupOrigTexts.get(t.ind) ?? '', doc);
    const d = cur - orig;
    if (deltaText === null || d > deltaText) deltaText = d;
  }
  if (deltaText === null) return;
  const deltaComp = deltaText * popupTextLayerScale(); // 折算合成单位
  // 注意:popupPanelBaseScaleX 是百分数(如 280.202),换算小数后才是底板原宽
  const panelW = popupPanelBaseShapeW * (popupPanelBaseScaleX / 100);
  const k = (panelW + deltaComp) / panelW;
  // 1) 底板宽度
  const newScale = popupPanelBaseScaleX * k;
  for (const layer of findPanelLayers()) {
    const s = layer?.ks?.s;
    if (s && s.a === 0 && Array.isArray(s.k)) {
      s.k[0] = newScale;
    }
  }
  // 2) 蒙版宽度(动画关键帧 X 同比例,0 与终值都 ×k)
  for (const layer of findMaskLayers()) {
    const s = layer?.ks?.s;
    if (!s || !Array.isArray(s.k)) continue;
    s.k.forEach((kf: any, i: number) => {
      const base = popupMaskBaseKeys[i];
      if (base && Array.isArray(kf.s) && base.s) kf.s[0] = base.s[0] * k;
    });
  }
  // 3) 感叹号图标:定位到文字左侧,随文字左缘移动
  positionPopupIcon(deltaComp);
}

/* ---------- 底框宽度自适应文字(主段 + 二次扫描段) ----------
 * 位置暴露动画的「底框」「底框(可见)」是文字底下的黑色框(矩形 235.143×56)。
 * 当文字超过 4 字时,底框 X 缩放按文字宽度增量同比例放大,保持左右留白不变;
 * ≤4 字时保持原始大小。二次扫描段(ind≥100)采用同样的自适应规则(其底框默认
 * 缩放基准为 160.164%,适配 8 字「即将扫描移动单位」)。每段独立记录基准几何。 */
const DIKUANG_NAMES = ['底框', '底框(可见)', '底框 可见']; // 第二段 AE 导出名为「底框 可见」(空格)
const DIKUANG_RECT_NM = '矩形 1'; // 底框中的黑色主矩形形状组

/* 底框可见副本的图层名:第一段「底框(可见)」、第二段「底框 可见」 */
function isDikuangVisibleName(nm: string): boolean {
  return nm === '底框(可见)' || nm === '底框 可见';
}

interface DikuangSeg {
  seg: 'main' | 'next';
  textInd: number;   // 文字图层 ind:4 / 104
  iconInd: number;   // 图标图层 ind:5 / 105
  parentInd: number; // 父级空 2 ind:3 / 103
  inSeg: (ind: number) => boolean; // ind < 100 / >= 100
  baseScaleKeys: { s: number[] }[];
  baseShapeW: number;
  origText: string;
  textScale: number;   // 文字图层终态缩放(小数)
  frameScale: number;  // 底框图层终态 X 缩放(小数)
  parentScale: number; // 父级空 2 终态缩放(小数)
  parentScaleKeys: { t: number; s0: number; ox: number; oy: number; ix: number; iy: number }[];
  iconBasePosKeys: { t: number; s: number }[]; // 图标位置 X 关键帧基准(空 2 空间,含时刻 t)
  visibleInd: number;      // 底框(可见)图层 ind:8 / 108
  rectBaseOpacity: number; // 「矩形 1」形状组原始不透明度
  /* 「光.png」是绝对层(不属于空 2 组),底框加宽时它不会跟着走,必须按同一仿射变换
   * 手动改写它的位移关键帧,否则光带只扫到加宽前的位置。 */
  lightInd: number;        // 光.png 图层 ind(该段没有则为 -1)
  lightBasePosKeys: { t: number; s: number }[]; // 光.png 位移 X 关键帧基准(合成空间,含时刻 t)
  platePivotX: number | null; // 底框缩放枢轴(合成空间 X):仿射变换的定点
}
/* 当前动画的底框段表:载入时由 captureDikuangBaseState 重建。
 * 「主段」一定存在,「二次扫描段」只在该动画是两段合并(见 isMergedNext)时才追加。 */
let dikuangSegs: DikuangSeg[] = [];

/* 用「底框(可见)」图层的 ind 反查所属段:矩形不透明度滑块的 data-ind 只有图层 ind,
 * 靠它能定位到所属段,进而拿到该段「矩形 1」的基准不透明度。 */
function dikuangSegByVisibleInd(ind: number): DikuangSeg | null {
  return dikuangSegs.find((s) => s.visibleInd === ind) ?? null;
}

/* 贝塞尔缓动:lottie 用 getBezierEasing(o.x,o.y,i.x,i.y) 作关键帧间插值,这里用二分求解还原 */
/* 为什么要自己实现:lottie-web 内部的 getBezierEasing 不对外导出,而这里需要在
 * 「不启动动画」的前提下按关键帧求某个时刻的值(改写图标位移时要按该时刻的父级缩放折算)。
 * 精度:24 次二分把 t 收敛到 1/2^24 以内,远超预览所需。 */
function bezierEasingValue(x1: number, y1: number, x2: number, y2: number, p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (x1 === y1 && x2 === y2) return p; // 线性
  const X = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (X(mid) < p) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

/* 父级空 2 在指定帧的缩放(小数),按动画关键帧间贝塞尔插值 */
/* 关键帧之间用 k0 的出手柄(ox/oy)与 k1 的入手柄(ix/iy)做三次贝塞尔插值,与 lottie 一致。
 * 关键帧的 s0 是百分数缩放(需 /100),frame 为整帧号;区间外按端点值钳位。 */
function getParentScaleAtFrame(seg: DikuangSeg, frame: number): number {
  const keys = seg.parentScaleKeys;
  if (keys.length === 0) return seg.parentScale;
  if (frame <= keys[0].t) return keys[0].s0 / 100;
  if (frame >= keys[keys.length - 1].t) return keys[keys.length - 1].s0 / 100;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (frame >= k0.t && frame <= k1.t) {
      const p = (frame - k0.t) / (k1.t - k0.t);
      const e = bezierEasingValue(k0.ox, k0.oy, k1.ix, k1.iy, p);
      return (k0.s0 + (k1.s0 - k0.s0) * e) / 100;
    }
  }
  return seg.parentScale;
}

/* 找某一段里的底框图层(含预合成内部),用 seg.inSeg 把两段分开:
 * 主段 ind < 100,二次扫描段 ind ≥ 100(合并时第二段图层的 ind 被整体加了 100,见 prepareNextData)。 */
function findDikuangLayers(seg: DikuangSeg): any[] {
  if (!currentData) return [];
  const out: any[] = [];
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (DIKUANG_NAMES.includes(l.nm) && seg.inSeg(l.ind)) out.push(l);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(currentData.layers);
  return out;
}

/* 用真实内嵌字体测量文字宽度(文字空间 px,字号 = doc.s)。
 * 注意:lottie 渲染时每字母 advance = 字形宽 + 字距 tr(公式 tr×0.001×字号),
 * 居中对齐的总宽也包含全部字母的字距;仅量字形宽会导致适配计算偏小,
 * 文字变长后底框/图标位移不足。这里把字距一并计入(与 lottie 渲染一致)。 */
/* 与 measurePopupTextWidth 的实现相同,但字体表取自 currentData(主动画)而不是 popupData ——
 * 主段与弹窗是两个独立 JSON,混用会量出错误宽度。 */
function measureDikuangTextWidth(text: string, doc: any): number {
  const ctx = getPopupMeasureCtx();
  if (!ctx || !doc || !doc.s) return 0;
  const fontDef = (currentData?.fonts?.list ?? []).find((f: any) => f.fName === doc.f || f.fFamily === doc.f);
  const family = (fontDef && fontDef.fFamily) || doc.f || 'sans-serif';
  ctx.font = doc.s + 'px "' + family + '"';
  const tracking = (doc.tr || 0) * 0.001 * (doc.s || 0); // 每字母字距(与 Canvas 文字兜底一致)
  let maxW = 0;
  for (const line of String(text).split('\r')) {
    const w = ctx.measureText(line).width + tracking * line.length;
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/* 取属性在「静态值」或「首个关键帧」处的分量(用于求底框缩放枢轴) */
/* 只用于取「基准几何」(求缩放枢轴、求图标基准位置),不做逐帧插值:
 * 动画属性取第一个关键帧的值,静态属性直接取数组分量,取不到返回 null。 */
function propBaseValue(prop: any, index = 0): number | null {
  if (!prop) return null;
  if (prop.a === 1 && Array.isArray(prop.k)) {
    const first = prop.k[0];
    if (first && Array.isArray(first.s) && typeof first.s[index] === 'number') return first.s[index];
    return null;
  }
  if (Array.isArray(prop.k) && typeof prop.k[index] === 'number') return prop.k[index];
  return null;
}

/* 图层「位置 X」的关键帧数组。数据里有两种写法,lottie 两种都支持:
 *   ① 分离维度:ks.p.x.k(图标、空对象等)
 *   ② 整体位置:ks.p.k[i].s = [x, y, z](光.png 这种没有 split 的写法)
 * 两者的 X 分量都落在 s[0],因此统一返回关键帧数组、统一读写 s[0] 即可。 */
function posXKeyframesOf(layer: any): any[] | null {
  /* 返回的是数据里的关键帧数组本体(不是副本),因此就地改 s[0] 就等于改动画数据;
   * 数组元素形如 { t: 时刻帧号, s: [x, y, z] }。 */
  const p = layer?.ks?.p;
  if (!p) return null;
  if (p.x && Array.isArray(p.x.k)) return p.x.k;
  if (Array.isArray(p.k)) return p.k;
  return null;
}

/* 图层锚点在合成空间的 X —— 即该图层「自身 X 缩放」的定点(枢轴)。
 * 沿 parent 链逐级映射:v → p(该级) + s(该级) × (v − a(该级))。
 * 空对象(空 2 / 空 3)的锚点与其位置重合,父级缩放动画不会移动该点,因此用各级
 * 基准值求一次即可(实测二次扫描段底框枢轴在整段内恒为 1890)。 */
function layerAnchorCompX(layer: any): number | null {
  if (!currentData || !layer) return null;
  let vx = propBaseValue(layer.ks?.p, 0);
  if (vx === null) return null;
  /* visited 用于防 parent 成环:AE 工程里手工构造的父子引用可能互相指向,
   * 不加保护这里会死循环卡死主线程。 */
  const visited = new Set<number>();
  let cur: any = layer;
  while (cur && typeof cur.parent === 'number' && !visited.has(cur.parent)) {
    visited.add(cur.parent);
    const parent = findLayerByInd(currentData.layers, cur.parent);
    if (!parent) break;
    const px = propBaseValue(parent.ks?.p, 0);
    const ax = propBaseValue(parent.ks?.a, 0);
    const sx = propBaseValue(parent.ks?.s, 0);
    if (px === null || ax === null || sx === null) break;
    vx = px + (sx / 100) * (vx - ax);
    cur = parent;
  }
  return vx;
}

/* 捕获底框基准几何(两段独立):文字原始内容/终态缩放、底框 X 缩放关键帧、矩形基准宽、父级缩放 */
function captureDikuangBaseState() {
  dikuangSegs = [];
  dikuangVisibleInds = [];
  dikuangRectBaseOpacity = 100;
  if (!currentData) return;
  /* 这套自适应只对「位置暴露动画」成立:段定义里的文字/图标/父级图层号(4 / 5 / 3)与「底框」
   * 都是那段数据里写死的,位移量 PLATE_PARENT_X_SHIFT 也是按它的静止帧实测标定的。
   * 其它动画即使恰好有同名图层也不该套用 —— 例如地图标题动画的「底框」,它旁边还有一层
   * 同样尺寸的「描边」衬板,而 DIKUANG_NAMES 只认「底框」,套用后会出现「底框变宽、描边没变」
   * 的错位;它的文字层缩放是静态值,capture 到的 textScale 也取不到 22.094% 这个真实比例。
   * 这里显式收窄到 exposed,避免新动画继承这套按图层号硬编码的假设。 */
  if (currentAnimKey !== 'exposed') return;
  /* 段定义:二次扫描段固定用 ind 104 / 105 / 103,是合并时把第二段图层的 ind 整体 +100 得到的;
   * 未合并的动画没有这一段,只建主段。 */
  const defs: { seg: 'main' | 'next'; textInd: number; iconInd: number; parentInd: number; inSeg: (ind: number) => boolean }[] = [
    { seg: 'main', textInd: 4, iconInd: 5, parentInd: 3, inSeg: (ind) => ind < 100 },
  ];
  if (isMergedNext(currentData)) {
    defs.push({ seg: 'next', textInd: 104, iconInd: 105, parentInd: 103, inSeg: (ind) => ind >= 100 });
  }
  for (const def of defs) {
    const seg: DikuangSeg = {
      seg: def.seg,
      textInd: def.textInd,
      iconInd: def.iconInd,
      parentInd: def.parentInd,
      inSeg: def.inSeg,
      baseScaleKeys: [],
      baseShapeW: 0,
      origText: '',
      textScale: 1,
      frameScale: 1,
      parentScale: 1,
      parentScaleKeys: [],
      iconBasePosKeys: [],
      visibleInd: -1,
      rectBaseOpacity: 100,
      lightInd: -1,
      lightBasePosKeys: [],
      platePivotX: null,
    };
    /* 记录文字图层的终态缩放 textScale:measureText 量到的是文字空间 px,折算成合成单位要乘它。
     * 取关键帧数组最后一帧的值(文字带放大动画时以终态为准);静态缩放 ks.s.k = [100,100,100]
     * 取不到关键帧结构,回落为 1(即 100%)。 */
    const textLayer = findLayerByInd(currentData.layers, seg.textInd);
    const doc = textLayer ? textDocOf(textLayer) : null;
    if (doc) seg.origText = doc.t ?? '';
    const ts = textLayer?.ks?.s;
    if (ts && Array.isArray(ts.k)) {
      const last = ts.k[ts.k.length - 1];
      if (Array.isArray(last.s) && last.s[0]) seg.textScale = last.s[0] / 100;
    }
    /* 取底框 X 缩放的关键帧基准(原样拷贝三个分量,后面按系数 k 放大),并从形状组里量出矩形
     * 基准宽:'rc'(矩形)且尺寸是静态值时才计,取最大值是因为底框里可能有多层矩形。
     * 同一段里可能有「底框」与「底框(可见)」两个图层,基准几何取第一个命中的(两者缩放一致),
     * 所以循环末尾 break。 */
    for (const layer of findDikuangLayers(seg)) {
      const s = layer?.ks?.s;
      if (!s || !Array.isArray(s.k)) continue;
      seg.baseScaleKeys = s.k
        .filter((kf: any) => Array.isArray(kf.s))
        .map((kf: any) => ({ s: [kf.s[0], kf.s[1], kf.s[2]] }));
      /* 遍历该图层（含嵌套形状组）里所有静态圆角矩形（rc），取最大宽度作为底框「基准矩形宽」。
       * 只认静态值 a=0：被做成关键帧的尺寸无法作为缩放基准，直接跳过。 */
      const walk = (items: any[]) => {
        for (const it of items ?? []) {
          if (it.ty === 'rc' && it.s?.a === 0 && Array.isArray(it.s.k) && it.s.k[0] > 0) {
            seg.baseShapeW = Math.max(seg.baseShapeW, it.s.k[0]);
          }
          if (Array.isArray(it.it)) walk(it.it);
        }
      };
      walk(layer.shapes);
      const last = s.k[s.k.length - 1];
      if (Array.isArray(last.s) && last.s[0]) seg.frameScale = last.s[0] / 100;
      break;
    }
    /* 记录父级「空 2」的缩放关键帧（取 X 分量 s[0]，百分比）以及该级的出/入缓动
     * 控制点 o/i（维度缺省时 o=0、i=1，即等价线性），供 adaptDikuangWidth 用
     * getParentScaleAtFrame 在任意帧插值还原父缩放——图标位移必须按当时的父缩放折算。 */
    const parent = findLayerByInd(currentData.layers, seg.parentInd);
    const ps = parent?.ks?.s;
    if (ps && Array.isArray(ps.k)) {
      for (const kf of ps.k) {
        if (kf.t === undefined || !Array.isArray(kf.s)) continue;
        const o = kf.o, i = kf.i;
        const dim = (v: any, def: number) => {
          if (Array.isArray(v)) return typeof v[0] === 'number' ? v[0] : def;
          return typeof v === 'number' ? v : def;
        };
        seg.parentScaleKeys.push({
          t: kf.t,
          s0: kf.s[0],
          ox: dim(o && o.x, 0), oy: dim(o && o.y, 1),
          ix: dim(i && i.x, 1), iy: dim(i && i.y, 1),
        });
      }
      const last = ps.k[ps.k.length - 1];
      if (Array.isArray(last.s) && last.s[0]) seg.parentScale = last.s[0] / 100;
    }
    // 图标位置 X 关键帧基准值(空 2 空间,含时刻 t,随文字左缘移动)
    const icon = findLayerByInd(currentData.layers, seg.iconInd);
    const px = icon?.ks?.p?.x;
    if (px && Array.isArray(px.k)) {
      seg.iconBasePosKeys = px.k
        .filter((kf: any) => Array.isArray(kf.s))
        .map((kf: any) => ({ t: kf.t, s: kf.s[0] }));
    }
    /* 光.png(仅二次扫描段存在):记录位移 X 关键帧基准,以及底框缩放枢轴。
     * 它是绝对层(不在空 2 组内),底框加宽不会带动它,需按同一仿射变换手动改写。 */
    const light = (() => {
      const walk = (layers: any[]): any | null => {
        for (const l of layers ?? []) {
          if (l.nm === '光.png' && seg.inSeg(l.ind)) return l;
          if (Array.isArray(l.layers)) {
            const hit = walk(l.layers);
            if (hit) return hit;
          }
        }
        return null;
      };
      return walk(currentData.layers);
    })();
    if (light) {
      seg.lightInd = light.ind;
      const lkeys = posXKeyframesOf(light);
      if (lkeys) {
        seg.lightBasePosKeys = lkeys
          .filter((kf: any) => Array.isArray(kf.s))
          .map((kf: any) => ({ t: kf.t, s: kf.s[0] }));
      }
      const plateLayers = findDikuangLayers(seg);
      if (plateLayers.length > 0) seg.platePivotX = layerAnchorCompX(plateLayers[0]);
    }
    // 记录底框(可见)图层的 ind 与「矩形 1」形状组原始不透明度
    const vis = (() => {
      const walk = (layers: any[]): any | null => {
        for (const l of layers ?? []) {
          if (isDikuangVisibleName(l.nm) && seg.inSeg(l.ind)) return l;
          if (Array.isArray(l.layers)) {
            const r = walk(l.layers);
            if (r) return r;
          }
        }
        return null;
      };
      return walk(currentData.layers);
    })();
    if (vis) {
      seg.visibleInd = vis.ind;
      const rectTr = getDikuangRectTr(vis);
      const base = rectTr?.o;
      if (base && isFinite(Number(base.k))) seg.rectBaseOpacity = Number(base.k);
    }
    dikuangSegs.push(seg);
    if (seg.visibleInd >= 0) dikuangVisibleInds.push(seg.visibleInd);
  }
  // 底框矩形基准不透明度:取主段(第一段)的值,两段合并时已统一为 55
  const mainSeg = dikuangSegs.find((s) => s.seg === 'main');
  if (mainSeg) dikuangRectBaseOpacity = mainSeg.rectBaseOpacity;
}

/* 文字宽度变化 → 同步调整每段底框 X 缩放(仅宽度,高度不变;≤4 字恢复原始大小)
 * 图标:文字居中,变长时左缘向左移 deltaComp/2 合成单位,图标同步左移保持固定间距。
 * 图标位置关键帧落在父级空 2 的缩放动画区间内,必须按每个关键帧时间点的父缩放折算,
 * 否则动画缩放过程中图标位移不足导致间距逐帧收窄。 */
function adaptDikuangWidth() {
  if (!currentData) return;
  for (const seg of dikuangSegs) {
    if (seg.baseShapeW <= 0 || seg.baseScaleKeys.length === 0) continue;
    const textLayer = findLayerByInd(currentData.layers, seg.textInd);
    const doc = textLayer ? textDocOf(textLayer) : null;
    if (!doc) continue;
    const curText = String(doc.t ?? '');
    // 字数按去掉换行符后的字符数统计（Bodymovin 文本里换行存为 \r），「>4 字」规则据此判断
    const charCount = curText.replace(/\r/g, '').length;
    // 文字宽度增量始终计算(可正可负),图标距离随文字左缘自适应;
    // 底框缩放沿用第一段规则:>4 字且变宽才放大,≤4 字或变窄保持当前。
    const cur = measureDikuangTextWidth(curText, doc);
    const orig = measureDikuangTextWidth(seg.origText, doc);
    /* 文字宽度增量：measureDikuangTextWidth 返回的是文字空间 px，乘文字层终态缩放
     * textScale（已除 100）后即为合成单位，与底框宽度同一坐标系；可正可负。 */
    const deltaComp = (cur - orig) * seg.textScale;
    // k = 底框 X 缩放倍数：1 表示保持基准宽（≤4 字或文字变窄时都不放大）
    let k = 1;
    if (charCount > 4 && deltaComp > 0) {
      /* frameW = 可见基准宽度（合成单位）= 形状基准宽 × 底框终态缩放 × 父级空 2 终态缩放；
       * 新增的宽度按同一比例放大，因此缩放系数 =（frameW + deltaComp）/ frameW。 */
      const frameW = seg.baseShapeW * seg.frameScale * seg.parentScale;
      if (frameW > 0) k = (frameW + deltaComp) / frameW;
    }
    for (const layer of findDikuangLayers(seg)) {
      const s = layer?.ks?.s;
      if (!s || !Array.isArray(s.k)) continue;
      /* 关键帧按「捕获的基准值 × k」整体重写，而不是在当前值上累乘 ——
       * 反复改文字长度、再改回原文都不会产生误差漂移。 */
      s.k.forEach((kf: any, i: number) => {
        const base = seg.baseScaleKeys[i];
        if (base && Array.isArray(kf.s) && base.s) kf.s[0] = base.s[0] * k;
      });
    }
    if (seg.iconBasePosKeys.length > 0) {
      const icon = findLayerByInd(currentData.layers, seg.iconInd);
      const px = icon?.ks?.p?.x;
      if (px && Array.isArray(px.k)) {
        px.k.forEach((kf: any, i: number) => {
          const base = seg.iconBasePosKeys[i];
          if (!base || !Array.isArray(kf.s)) return;
          /* 末关键帧通常没有 t 字段，回退到捕获时记录的基准时刻；
           * 除以父缩放前先判 > 0.01：空 2 缩放动画的起始处缩放接近 0，直接除会把位移放大到无穷。 */
          const frame = typeof kf.t === 'number' ? kf.t : base.t;
          const parentScaleAtFrame = getParentScaleAtFrame(seg, frame);
          if (parentScaleAtFrame > 0.01) kf.s[0] = base.s - (deltaComp / 2) / parentScaleAtFrame;
        });
      }
    }
    /* 光.png:绝对层(不属于空 2 组),底框加宽不会带动它 —— 不处理的话光带只会扫到
     * 「加宽前」的位置(关键帧仍是原值)。这里对它的 X 位移关键帧施加与底框完全相同的
     * 仿射变换(以底框缩放枢轴为定点,倍数即底框的 X 缩放 k):
     *   x' = pivot + (x − pivot) × k
     * 文字恢复原宽时 k = 1,关键帧自动回到基准值。 */
    if (seg.lightBasePosKeys.length > 0 && seg.platePivotX !== null) {
      const light = findLayerByInd(currentData.layers, seg.lightInd);
      const lkeys = posXKeyframesOf(light);
      const pivot = seg.platePivotX;
      if (lkeys) {
        lkeys.forEach((kf: any, i: number) => {
          const base = seg.lightBasePosKeys[i];
          if (!base || !Array.isArray(kf.s)) return;
          kf.s[0] = pivot + (base.s - pivot) * k;
        });
      }
    }
  }
}


/* ---------- 地图标题动画:「底框 / 描边」随文字宽度自适应 ----------
 * 该动画的底框与描边是一对**同尺寸**圆角矩形(描边图层多一条 tm 修剪路径,白轮廓才露得出来),
 * 两者必须一起变宽,否则黑白两层会错位 —— 这也是不能直接复用 adaptDikuangWidth 的原因之一
 * (那套只认「底框」这一个图层名,而这里的描边同样要跟着动)。
 * 与位置暴露动画那套的另外两点差异:
 *   ① 那段文字改成了**左对齐**,底框必须「左边缘钉死、只向右生长」;
 *      位置暴露的底框是居中的,加宽时向两侧同时生长。
 *   ② 实现上**不动图层缩放**,而是直接改形状里的圆角矩形 rc:宽度 +Δ、矩形位置 x = Δ/2。
 *      矩形在形状空间里是「以 pos 为中心、宽 w」,于是左边缘恒为 −w/2 + Δ/2 = 原左边缘,
 *      天然实现「左边缘不动」,不必再去补偿锚点/缩放带来的位移(该图层的锚点在 −644.54,
 *      一旦用缩放实现,加宽会把左边缘推着往右跑,还得反解回移量)。
 * 规则:**只增不减** —— 文字变长才变宽,改短不回缩(与位置暴露动画一致)。 */
/* 描边图层比底框多一条「修剪路径(tm)」:它把矩形轮廓只保留 67.2%→100% 一段,
 * 也就是**只留下顶边那条横线**(矩形路径按 AE 的顺时针约定从右上角起画:右边→底边→左边→顶边,
 * 顶边恰好在 67.1% 处开始)—— 白描边靠它才露得出来。
 * 麻烦在于修剪的 s/e 是**周长百分比**:矩形一加宽,周长变长,同样 67.2% 就切得更靠里,
 * 白线的左端会跟着往右跑(实测底框左边缘钉在 102.4px 不动,描边却漂到了 433.2px)。
 * 因此加宽时必须重算 s —— 但**不能**简单换成「顶边起点所占比例」(2h+w)/2(h+w):
 * 原始导出是 67.2%,比顶边起点 67.101% 多出约 0.086 个单位的内缩,那是白线左端相对转角的留白。
 * 把这个内缩抹掉、让 s 正好压在转角上,线帽就会落在矩形拐角处并向外溢出半个描边宽度
 * (实测描边左端从 102 跑到 81,左边「多出来几个像素」)。
 * 正确做法是**保留原始内缩量**:s = (2h + w + inset) / 2(w + h),Δ=0 时与原始值逐位一致。 */
type MaptitlePlateRect = {
  rc: any;          // 形状组里的圆角矩形项(JSON 本体,就地改)
  baseW: number;    // 基准宽度(形状空间)
  basePosX: number; // 基准矩形位置 x(形状空间)
  baseH: number;    // 基准高度(形状空间,算修剪比例要用)
  ratio: number;    // 文字空间增量 → 形状空间增量的换算系数
  trims: { tm: any; inset: number }[]; // 该图层里的修剪路径项(底框没有,描边有一条)及其「起点内缩量」
};
let maptitlePlateBase: { textInd: number; baseAdv: number; rects: MaptitlePlateRect[] } | null = null;

/* 采集基准:文字层当前的前进宽度 + 两个衬板图层里每个圆角矩形的原始尺寸与位置。
 * 与其它 capture* 一样只在 loadData(切动画)时跑一次,重建动画不会重采,
 * 否则「基准」会被用户改过的宽度覆盖掉,自适应就永远不生效了。 */
function captureMaptitlePlateBase() {
  maptitlePlateBase = null;
  if (!currentData || currentAnimKey !== 'maptitle') return;
  const top = currentData.layers ?? [];
  const textLayer = top.find((l: any) => l.ty === 5 && l.nm === '地图地点');
  const plates = top.filter((l: any) => l.ty === 4 && (l.nm === '底框' || l.nm === '描边'));
  if (!textLayer || !plates.length) return;
  const doc = textDocOf(textLayer);
  if (!doc) return;
  const rects: MaptitlePlateRect[] = [];
  for (const plate of plates) {
    /* 文字层与两个衬板图层同属一个父级链(都在 ind3 之下),所以两者换算到合成空间时
     * 公共的祖先缩放会约掉,只剩「文字层自身缩放 ÷ 衬板自身缩放」这一项。 */
    const textScale = (textLayer.ks?.s?.k?.[0] ?? 100) / 100;
    const plateScale = (plate.ks?.s?.k?.[0] ?? 100) / 100;
    if (!plateScale) continue;
    const ratio = textScale / plateScale;
    /* 先定位该图层的基准圆角矩形(尺寸 static),修剪路径的「起点内缩量」要用它算 */
    let rect0: { w: number; h: number } | null = null;
    const findRect = (items: any[]) => {
      for (const it of items ?? []) {
        if (!rect0 && it.ty === 'rc' && it.s?.a === 0 && Array.isArray(it.s.k) && it.p?.a === 0) {
          const w = Number(it.s.k[0]), h = Number(it.s.k[1]);
          if (w > 0 && h > 0) rect0 = { w, h };
        }
        if (Array.isArray(it.it)) findRect(it.it);
      }
    };
    findRect(plate.shapes);
    /* 修剪路径是形状组的兄弟节点,单独收集一次。
     * 只认「终点在路径末端(e=100%)」的静态修剪 —— 也就是地图标题动画里那条「只保留顶边」的写法。
     * 起点相对「顶边起点」的**内缩量必须原样保留**:原始导出 s=67.2%,而顶边起点是 67.101%,
     * 多出的约 0.086 个单位就是白线左端相对转角的留白。若把它当成「正好压在角上」重算,
     * 线帽会正好落在矩形转角上、笔画端头向外溢出半个描边宽度(实测 21px)——
     * 看起来就是「描边左边多出来几个像素」。 */
    const trims: { tm: any; inset: number }[] = [];
    const br = rect0 as { w: number; h: number } | null;
    if (br) {
      const perim0 = 2 * (br.w + br.h);
      const collectTrims = (items: any[]) => {
        for (const it of items ?? []) {
          if (it.ty === 'tm' && it.s?.a === 0 && it.e?.a === 0 && Math.abs((it.e.k ?? 100) - 100) < 0.01) {
            trims.push({ tm: it, inset: ((it.s.k ?? 0) / 100) * perim0 - (2 * br.h + br.w) });
          }
          if (Array.isArray(it.it)) collectTrims(it.it);
        }
      };
      collectTrims(plate.shapes);
    }
    const walk = (items: any[]) => {
      for (const it of items ?? []) {
        // 只认静态尺寸的圆角矩形:做成关键帧的尺寸没法当基准
        if (it.ty === 'rc' && it.s?.a === 0 && Array.isArray(it.s.k) && it.p?.a === 0) {
          const baseW = Number(it.s.k[0]);
          const baseH = Number(it.s.k[1]);
          const basePosX = Number(it.p.k?.[0] ?? 0);
          if (baseW > 0 && baseH > 0 && isFinite(basePosX)) rects.push({ rc: it, baseW, basePosX, baseH, ratio, trims });
        }
        if (Array.isArray(it.it)) walk(it.it);
      }
    };
    walk(plate.shapes);
  }
  if (!rects.length) return;
  maptitlePlateBase = { textInd: textLayer.ind, baseAdv: measureDikuangTextWidth(String(doc.t ?? ''), doc), rects };
}

/* 按当前文字宽度重算两个衬板的矩形宽度。文字变短时 Δ 取 0(只增不减),
 * 因此「改短 → 没变化」,点重置把文字改回原样时会精确回到基准宽度。 */
function adaptMaptitlePlateWidth() {
  const base = maptitlePlateBase;
  if (!base || !currentData) return;
  const textLayer = findLayerInData(currentData, base.textInd);
  const doc = textLayer ? textDocOf(textLayer) : null;
  if (!doc) return;
  const cur = measureDikuangTextWidth(String(doc.t ?? ''), doc);
  if (!cur || !base.baseAdv) return;
  const grow = Math.max(0, cur - base.baseAdv); // 只增不减
  for (const r of base.rects) {
    const delta = grow * r.ratio;
    const w = r.baseW + delta;
    r.rc.s.k[0] = w;
    r.rc.p.k[0] = r.basePosX + delta / 2; // 中心右移半个增量 → 左边缘不动
    /* 有修剪路径的图层(描边):把 s 锁在「顶边起点」的比例上,白线才会跟着矩形一起变宽、
       而不是因为周长变长而往右缩。e 保持原值(100%)。 */
    for (const { tm, inset } of r.trims) {
      const perimeter = 2 * (w + r.baseH);
      // 顶边起点 + 原样的内缩量 → 再换算成周长百分比;Δ=0 时结果与原始导出值完全一致
      if (perimeter > 0) tm.s.k = +(((2 * r.baseH + w + inset) / perimeter) * 100).toFixed(4);
    }
  }
}

/* ---------- 底框黑色矩形独立透明度(两段) ----------
 * 底框(可见) = 两个竖条 + 黑色主矩形(形状组「矩形 1」)。矩形有自己的
 * 形状组不透明度(tr.o),可被独立于「两个竖条」单独调整。主段与二次扫描段
 * 各自的「底框(可见)」都可独立调整。 */
let dikuangVisibleInds: number[] = []; // 各段底框(可见)图层的 ind
let dikuangRectBaseOpacity = 100; // 「矩形 1」形状组基准不透明度(主段)

/* 按图层名递归查找图层(可选按段过滤) */
function findLayerByName(layers: any[], nm: string, inSeg?: (ind: number) => boolean): any | null {
  for (const l of layers ?? []) {
    if (l.nm === nm && (!inSeg || inSeg(l.ind))) return l;
    if (Array.isArray(l.layers)) {
      const r = findLayerByName(l.layers, nm, inSeg);
      if (r) return r;
    }
  }
  return null;
}

/* 取某图层内的「矩形 1」形状组 transform(该组的不透明度在 tr.o 上) */
function getDikuangRectTr(layer: any): any | null {
  if (!layer?.shapes) return null;
  const gr = (layer.shapes ?? []).find((g: any) => g.ty === 'gr' && g.nm === DIKUANG_RECT_NM);
  if (!gr?.it) return null;
  return gr.it.find((x: any) => x.ty === 'tr') ?? null;
}

/* 读取「矩形 1」形状组的不透明度（0..100）；取不到时按 100（完全不透明）兜底。
 * 不传 ind 时作用于第一段（主段）的底框可见层。 */
function getDikuangRectOpacity(ind?: number): number {
  if (!currentData) return 100;
  if (ind === undefined) {
    ind = dikuangVisibleInds[0] ?? -1;
  }
  const layer = findLayerByInd(currentData.layers, ind);
  const tr = layer ? getDikuangRectTr(layer) : null;
  const o = tr?.o;
  if (!o) return 100;
  const v = Number(o.k);
  return isFinite(v) ? Math.round(v) : 100;
}

/* 设置「矩形 1」形状组不透明度（0..100，四舍五入并 clamp）。只接受静态值属性
 * （a=0）：该属性若被做成了关键帧则直接忽略，避免改坏动画。改完防抖 200ms 重建动画。 */
function setDikuangRectOpacity(val: number, ind?: number) {
  if (!currentData) return;
  if (ind === undefined) {
    ind = dikuangVisibleInds[0] ?? -1;
  }
  const layer = findLayerByInd(currentData.layers, ind);
  const tr = layer ? getDikuangRectTr(layer) : null;
  if (!tr?.o || tr.o.a !== 0) return;
  tr.o.k = Math.round(Math.max(0, Math.min(100, val)));
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 200);
}

/* 恢复该段「矩形 1」的基准不透明度：优先取这一段捕获的基准值（主段与二次扫描段
 * 各自独立），查不到段时退回全局基准（主段的值，默认 100）。 */
function resetDikuangRectOpacity(ind?: number) {
  if (!currentData) return;
  if (ind === undefined) {
    ind = dikuangVisibleInds[0] ?? -1;
  }
  const layer = findLayerByInd(currentData.layers, ind);
  const tr = layer ? getDikuangRectTr(layer) : null;
  if (!tr?.o || tr.o.a !== 0) return;
  const seg = dikuangSegByVisibleInd(ind);
  tr.o.k = seg ? seg.rectBaseOpacity : dikuangRectBaseOpacity;
  window.clearTimeout(textEditTimer);
  textEditTimer = window.setTimeout(() => reRenderPreservingState(), 200);
}


/* ---------- 弹窗图层编辑：原始状态快照与底板基准几何 ----------
 * 弹窗叠加层（windows_animation.json）的编辑方式是「改数据 + 整体重建 lottie 实例」，
 * 因此每次数据就绪后都要先把原始状态存下来：侧栏「重置」按钮靠它还原文字/颜色/对齐，
 * 底板宽度自适应靠它拿到基准几何（底板形状基准宽、X 缩放、蒙版 X 缩放关键帧）。
 * 键都是图层 ind：主动画与弹窗各有一套编号，互不冲突。 */
const originalPopupTextState = new Map<number, { text: string; fc: number[]; j: number }>();
const originalPopupShapeState = new Map<number, { fill: number[] | null; stroke: number[] | null }>();

/* 捕获弹窗原始状态：文本（内容 / 填充色 fc / 对齐 j）与形状（填充、描边颜色）按 ind
 * 存档，同时记录底板基准几何。fc 是 0..1 归一化 RGB（见 hexToFc / fcToHex），不是 0..255。 */
function capturePopupOriginalState() {
  originalPopupTextState.clear();
  originalPopupShapeState.clear();
  popupOrigTexts.clear();
  popupPanelBaseScaleX = 0;
  popupPanelBaseShapeW = 0;
  popupMaskBaseKeys = [];
  if (!popupData) return;
  for (const t of collectTextLayers(popupData)) {
    const layer = findLayerByInd(popupData.layers, t.ind);
    const s = layer ? textDocOf(layer) : null;
    if (!s) continue;
    originalPopupTextState.set(t.ind, {
      text: s.t ?? '',
      fc: s.fc ? [...s.fc] : [1, 1, 1],
      j: typeof s.j === 'number' ? s.j : 2,
    });
    popupOrigTexts.set(t.ind, s.t ?? '');
  }
  for (const s of shapeLayerColorInfo(popupData)) {
    originalPopupShapeState.set(s.ind, {
      fill: s.fill ? [...s.fill] : null,
      stroke: s.stroke ? [...s.stroke] : null,
    });
  }
  // 底板基准几何:形状基准宽(rc 宽度)× X 缩放
  for (const layer of findPanelLayers()) {
    const s = layer?.ks?.s;
    if (!(s && s.a === 0 && Array.isArray(s.k) && s.k[0])) continue;
    const walk = (items: any[]) => {
      for (const it of items ?? []) {
        if (it.ty === 'rc' && it.s?.a === 0 && Array.isArray(it.s.k) && it.s.k[0] > 0) {
          popupPanelBaseShapeW = Math.max(popupPanelBaseShapeW, it.s.k[0]);
        }
        if (Array.isArray(it.it)) walk(it.it);
      }
    };
    walk(layer.shapes);
    popupPanelBaseScaleX = s.k[0];
    break;
  }
  // 蒙版基准几何:记录 X 缩放动画关键帧(0 与终值,供宽度自适应同比例缩放)
  for (const layer of findMaskLayers()) {
    const s = layer?.ks?.s;
    if (!s || !Array.isArray(s.k)) continue;
    popupMaskBaseKeys = s.k
      .filter((kf: any) => Array.isArray(kf.s))
      .map((kf: any) => ({ s: [kf.s[0], kf.s[1], kf.s[2]] }));
    break;
  }
}

/* 弹窗文字编辑回调（输入框每次 input 都触发，250ms 防抖）。
 * 顺序不能颠倒：先 await 内嵌字体加载完成再测量宽度 —— 字体未就绪时 measureText 用的是
 * 后备字体，量出的宽度偏小，底板会窄一截；之后才是底板适配 + 整体重建。 */
function onPopupTextEdited(ind: number, text: string) {
  if (!popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  setLayerText(layer, text); // 居中由 j=2 原生保持,不挪锚点
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => {
    void (async () => {
      await loadEmbeddedFonts(popupData); // 保证测量用真实字体
      adaptPopupPanelWidth(); // 文字宽度变化 → 底板宽度同步
      rebuildPopupPreservingState();
    })();
  }, 250);
}

/* 弹窗文字改色：写入文本 doc 的 fc（hex → 0..1 三元组），防抖后重建弹窗 */
function onPopupColorChanged(ind: number, hex: string) {
  if (!popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  setLayerColor(layer, hex);
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => rebuildPopupPreservingState(), 250);
}

/* 弹窗文字对齐：j 用 Bodymovin 编码 0=左、1=右、2=居中（注意 1/2 与直觉顺序相反） */
function onPopupAlignChanged(ind: number, j: number) {
  if (!popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  setLayerAlign(layer, j);
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => rebuildPopupPreservingState(), 250);
}

/* 弹窗形状改色：kind='fill' 写 fl.c，'stroke' 写 st.c，同样防抖后重建 */
function onPopupShapeColorChanged(ind: number, hex: string, kind: 'fill' | 'stroke') {
  if (!popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  if (kind === 'fill') setShapeFillColor(layer, hex);
  else setShapeStrokeColor(layer, hex);
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => rebuildPopupPreservingState(), 250);
}

/* 重置单个弹窗文本：文字 / 颜色 / 对齐都写回原始快照。数据写回后必须同步刷新侧栏控件值，
 * 否则输入框还显示用户改过的内容，与画面不一致；随后按与编辑相同的流程适配底板宽并重建。 */
function onPopupTextReset(ind: number) {
  const orig = originalPopupTextState.get(ind);
  if (!orig || !popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  setLayerText(layer, orig.text);
  setLayerColor(layer, fcToHex(orig.fc));
  setLayerAlign(layer, orig.j);
  const ta = popupTextList.querySelector<HTMLTextAreaElement>('.pt-input[data-ind="' + ind + '"]');
  if (ta) ta.value = String(orig.text).replace(/\r/g, '\n');
  const ci = popupTextList.querySelector<HTMLInputElement>('.pt-color[data-ind="' + ind + '"]');
  if (ci) setColorPickerValue(ci, fcToHex(orig.fc));
  const al = popupTextList.querySelector<HTMLSelectElement>('.t-align[data-ind="' + ind + '"]');
  if (al) al.value = String(orig.j);
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => {
    void (async () => {
      await loadEmbeddedFonts(popupData);
      adaptPopupPanelWidth(); // 文字恢复原宽 → 底板恢复基准宽
      rebuildPopupPreservingState();
    })();
  }, 250);
}

/* 重置单个弹窗形状颜色：原始快照里缺 fill/stroke 说明该图层本来就没有这一项，跳过不写 */
function onPopupShapeReset(ind: number) {
  const orig = originalPopupShapeState.get(ind);
  if (!orig || !popupData) return;
  const layer = findLayerByInd(popupData.layers, ind);
  if (!layer) return;
  if (orig.fill) setShapeFillColor(layer, fcToHex(orig.fill));
  if (orig.stroke) setShapeStrokeColor(layer, fcToHex(orig.stroke));
  const fi = popupShapeList.querySelector<HTMLInputElement>('.pt-fill[data-ind="' + ind + '"]');
  if (fi && orig.fill) setColorPickerValue(fi, fcToHex(orig.fill));
  const si = popupShapeList.querySelector<HTMLInputElement>('.pt-stroke[data-ind="' + ind + '"]');
  if (si && orig.stroke) setColorPickerValue(si, fcToHex(orig.stroke));
  window.clearTimeout(popupEditTimer);
  popupEditTimer = window.setTimeout(() => rebuildPopupPreservingState(), 250);
}

/* 渲染弹窗侧栏的「文字」与「颜色图层」两个列表（每次数据变更后整体重绘）。要点：
 *   ①名称含「蒙版」的图层不列入可改色项，改色会破坏蒙版形状与配对；
 *   ②textarea 的 rows 按文本里的换行数给足，避免多行内容被折叠；
 *   ③控件用 data-ind 关联图层 ind，事件在重绘时逐个重新绑定（列表很小，代价可忽略）。 */
function renderPopupLists() {
  if (!popupData) return;
  const texts = collectTextLayers(popupData);
  popupTextCount.textContent = '· ' + texts.length + ' 个';
  popupTextList.innerHTML = texts
    .map((t) => {
      const layer = findLayerByInd(popupData.layers, t.ind);
      const s = layer ? textDocOf(layer) : null;
      const isMask = /蒙版/.test(t.nm); // 蒙版图层不可改色
      const hex = fcToHex(s?.fc);
      const j = typeof s?.j === 'number' ? s.j : 2;
      const displayText = String(t.text).replace(/\r/g, '\n');
      const rows = Math.max(1, displayText.split('\n').length);
      const colorHtml = isMask
        ? ''
        : '<label class="t-color-label">颜色 <input type="color" class="pt-color" data-ind="' + t.ind + '" value="' + hex + '" /><input type="text" class="hex-input" value="' + hex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(t.nm) + '</span>' +
        '<button class="t-reset pt-reset" data-ind="' + t.ind + '" type="button" title="重置文字与颜色">' + ICON_RESET + '重置</button>' +
        '</div>' +
        '<textarea class="t-input pt-input" rows="' + rows + '" data-ind="' + t.ind + '" spellcheck="false"></textarea>' +
        '<div class="t-row">' +
        colorHtml +
        '<label class="t-color-label">对齐 <select class="t-align" data-ind="' + t.ind + '" title="文字对齐方式(默认居中 j=2)">' +
        '<option value="0"' + (j === 0 ? ' selected' : '') + '>左</option>' +
        '<option value="2"' + (j === 2 ? ' selected' : '') + '>居中</option>' +
        '<option value="1"' + (j === 1 ? ' selected' : '') + '>右</option>' +
        '</select></label>' +
        '</div>' +
        '</li>'
      );
    })
    .join('');
  popupTextList.querySelectorAll<HTMLTextAreaElement>('.pt-input').forEach((ta) => {
    const target = texts.find((t) => t.ind === Number(ta.dataset.ind));
    if (target) ta.value = String(target.text).replace(/\r/g, '\n');
    ta.addEventListener('input', () => onPopupTextEdited(Number(ta.dataset.ind), ta.value));
  });
  popupTextList.querySelectorAll<HTMLInputElement>('.pt-color').forEach((ci) => {
    bindColorPicker(ci, (hex) => onPopupColorChanged(Number(ci.dataset.ind), hex));
  });
  popupTextList.querySelectorAll<HTMLSelectElement>('.t-align').forEach((al) => {
    al.addEventListener('change', () => onPopupAlignChanged(Number(al.dataset.ind), Number(al.value)));
  });
  popupTextList.querySelectorAll<HTMLButtonElement>('.pt-reset').forEach((btn) => {
    btn.addEventListener('click', () => onPopupTextReset(Number(btn.dataset.ind)));
  });

  // 颜色图层:名称含「蒙版」的图层不列入,不可改色
  const shapes = shapeLayerColorInfo(popupData).filter((s) => !/蒙版/.test(s.nm));
  popupCount.textContent = '· ' + (texts.length + shapes.length) + ' 项可编辑';
  popupShapeCount.textContent = '· ' + shapes.length + ' 个';
  popupShapeList.innerHTML = shapes
    .map((s) => {
      const fillHex = s.fill ? fcToHex(s.fill) : null;
      const strokeHex = s.stroke ? fcToHex(s.stroke) : null;
      let colorHtml = '';
      if (fillHex) colorHtml += '<label class="t-color-label">填充 <input type="color" class="pt-fill" data-ind="' + s.ind + '" value="' + fillHex + '" /><input type="text" class="hex-input" value="' + fillHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      if (strokeHex) colorHtml += '<label class="t-color-label">描边 <input type="color" class="pt-stroke" data-ind="' + s.ind + '" value="' + strokeHex + '" /><input type="text" class="hex-input" value="' + strokeHex + '" spellcheck="false" placeholder="#rrggbb" /></label>';
      return (
        '<li class="text-item">' +
        '<div class="text-item-head">' +
        '<span class="t-name">' + esc(s.nm) + '</span>' +
        '<button class="t-reset pt-reset" data-ind="' + s.ind + '" type="button" title="重置颜色">' + ICON_RESET + '重置</button>' +
        '</div>' +
        '<div class="shape-colors">' + colorHtml + '</div>' +
        '</li>'
      );
    })
    .join('');
  popupShapeList.querySelectorAll<HTMLInputElement>('.pt-fill').forEach((ci) => {
    bindColorPicker(ci, (hex) => onPopupShapeColorChanged(Number(ci.dataset.ind), hex, 'fill'));
  });
  popupShapeList.querySelectorAll<HTMLInputElement>('.pt-stroke').forEach((ci) => {
    bindColorPicker(ci, (hex) => onPopupShapeColorChanged(Number(ci.dataset.ind), hex, 'stroke'));
  });
  popupShapeList.querySelectorAll<HTMLButtonElement>('.pt-reset').forEach((btn) => {
    btn.addEventListener('click', () => onPopupShapeReset(Number(btn.dataset.ind)));
  });
}

/* 「显示弹窗」开关:显隐叠加层(字体先加载,避免首帧回退系统字体) */
chkPopup.addEventListener('change', () => {
  popupVisible = chkPopup.checked;
  if (popupVisible && popupData) {
    void loadEmbeddedFonts(popupData).then(() => rebuildPopupOverlay());
  } else {
    destroyPopupAnim();
    popupLayer.hidden = true;
  }
});

/* ---------- 重渲染单飞队列 ----------
 * 重渲染(重建整段动画)是异步过程(loadAnimation → DOMLoaded → 恢复播放)。若用户
 * 点击过快,在上一轮还没结束时又发起新重建,lottie 新旧实例会在同一容器上交错构建,
 * 可能留下“只剩一个图标的半成品”。这里把所有重渲染请求串行化:同一时间只执行一次
 * 重建,期间的新请求合并为一次,待当前结束再补跑,任意点击速度都安全。 */
let rerenderBusy = false;
let rerenderQueued = false;

/* 请求一次「保留状态的重渲染」：忙时只置排队标记（多次点击被合并成一次重建），
 * 当前这轮结束后补跑。调用方不需要等待，也不返回 Promise。 */
function reRenderPreservingState() {
  if (!currentData || !anim) {
    rerenderBusy = false;
    rerenderQueued = false;
    return;
  }
  if (rerenderBusy) {
    rerenderQueued = true;
    return;
  }
  rerenderBusy = true;
  /* 结束回调：清忙标记；有排队请求则推迟到下一帧补跑（用 rAF 而不是同步递归，
   * 避免在深层调用栈里继续重建，也给浏览器一次渲染机会）。 */
  const finish = () => {
    rerenderBusy = false;
    if (rerenderQueued) {
      rerenderQueued = false;
      requestAnimationFrame(() => reRenderPreservingState());
    }
  };
  reRenderPreservingStateCore(finish);
}

/* 单飞队列的执行体：记录状态 → 销毁旧实例 → 重新 loadAnimation → 恢复帧号与播放状态
 * → 放行队列。全程用 buildSerial 序号识别「自己是否已被更新的重建顶替」，被顶替时只放行
 * 队列、不再动画面。settle 幂等，保证正常路径、DOMLoaded、看门狗超时、异常分支都恰好放行
 * 一次队列，否则单飞标记会永久卡住、之后所有重建请求都被丢弃。 */
function reRenderPreservingStateCore(onSettled?: () => void) {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled?.();
  };
  if (!currentData || !anim) {
    settle();
    return;
  }
  // 记录重建前的状态：当前帧号（lottie 的 currentFrame，与合成帧号同一坐标系，0 为首帧）、
  // 是否处于暂停、倍速与渲染器；重建后原样恢复，让用户察觉不到动画被整体换掉
  const frame = anim.currentFrame;
  const wasPaused = anim.isPaused;
  const speed = parseFloat(rngSpeed.value);
  const renderer = selRenderer.value;

  // 重建期间隐藏预览区:lottie 新实例就绪前会短暂呈现“半成品帧(只建出图标等)”,造成闪烁。
  previewInner.style.visibility = 'hidden';
  const serial = ++buildSerial;
  destroyAnim();
  // 看门狗:若被 loadData(切换动画等)顶替,实例可能不再触发 DOMLoaded,需放行队列
  const watchdog = window.setTimeout(() => {
    if (serial !== buildSerial) settle();
  }, 900);
  /* 改字触发的重建走的是这条路径(不经过 loadData),所以字形表判定必须在这里也做一次:
   * 用户改成表外的字时丢掉 chars、退回浏览器文本引擎,否则新字会被渲染成空路径(文字消失)。 */
  dropCharsIfUncovered(currentData);
  let newAnim: AnimationItem;
  /* loadAnimation 也可能同步抛错（数据异常 / 容器异常）：这条路径必须清掉看门狗并放行
   * 单飞队列，否则后续所有重建请求都会被 rerenderBusy 挡住。 */
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
    window.clearTimeout(watchdog);
    if (serial === buildSerial) previewInner.style.visibility = 'visible';
    setStatus('载入失败: ' + (e as Error).message, true);
    settle();
    return;
  }
  anim = newAnim;
  (window as any).__anim = newAnim;
  (window as any).__lottie = lottie;
  // 渲染器补丁要在实例刚建好时立刻挂上：loadAnimation 可能已同步构建好元素，
  // 补丁内部会对已构建元素补做处理（图片序列层调色、投影、SVG 裁剪等两套渲染器的差异）
  if (renderer === 'canvas') patchCanvasRendererTree(newAnim.renderer as any);
  else patchSvgRendererTree(newAnim.renderer as any);
  rebuildPopupOverlay();
  newAnim.addEventListener('DOMLoaded', onAnimReady);
  newAnim.addEventListener('config_ready', onAnimReady);
  newAnim.setSpeed(speed);
  // 兜底刷新时间轴帧范围上限：改时长/开关二次扫描都会重建动画，而 DOMLoaded 可能在本监听绑定前就已触发
  scheduleFrameRangeRefresh(); // 调整时长等会重建动画,DOMLoaded 可能已错过,这里兜底刷新时间轴上限
  // 恢复播放位置/播放状态必须等动画真正就绪(DOMLoaded)后再执行:
  // lottie 元素在就绪前只完成了创建(变换未应用、文字未排版),此时若 goToAndStop
  // 且之前处于暂停,画面会停在“只剩一个图标的半成品帧”,必须重新播放才恢复。
  let restorePlayback = true;
  const restorePlaybackState = () => {
    if (!restorePlayback) return;
    restorePlayback = false;
    requestAnimationFrame(() => {
      if (serial !== buildSerial) { settle(); return; } // 已有更新的重建/切换,交给最新实例
      try { newAnim.goToAndStop(frame, true); } catch { settle(); return; } // 已被销毁则放弃
      if (!wasPaused) newAnim.play();
      updateTransport();
      previewInner.style.visibility = 'visible'; // 就位后才显示,避免半成品帧闪烁
      window.clearTimeout(watchdog);
      settle();
    });
  };
  newAnim.addEventListener('DOMLoaded', restorePlaybackState);
  newAnim.addEventListener('config_ready', restorePlaybackState);
  requestAnimationFrame(() => {
    // DOMLoaded 可能先于本帧触发(同步数据):已就绪则立即恢复
    if (newAnim.isLoaded) restorePlaybackState();
  });
  // 兜底:若极端情况下(如实例被外部销毁且未触发任何事件)未完成,超时后放行队列
  window.setTimeout(() => {
    if (restorePlayback) {
      restorePlayback = false;
      settle();
    }
  }, 1500);
}

/* ---------- 载入来源(按需加载) ----------
 * 两个动画的 JSON 体积很大(撤离动画内嵌 613 帧序列图等),以独立静态资源
 * (?url)打包,不进首屏 JS:页面打开只拉默认动画;切换动画时才按需下载另一份
 * 数据包,并弹出加载浮层 + 实时进度条(浏览器缓存,二次切换不再下载)。
 * 音频已在启动时预载(prefetchAudios);音频不使用 JSON 内嵌版本。 */
import animationDataUrl from '../animations/animation_1/animation_data.json?url';
import windowsAnimationUrl from '../animations/animation_1/windows animation/windows_animation.json?url';
import animation2DataUrl from '../animations/animation_2/animation_data.json?url';
import animation2NextUrl from '../animations/animation_2/animation_data_next_fixed.json?url';
import animation3DataUrl from '../animations/animation_3/animation_data.json?url';
import missionDataUrl from '../animations/animation_4/animation_data.json?url';
import mapTitleDataUrl from '../animations/animation_5/animation_data.json?url';
import blastDataUrl from '../animations/animation_6/animation_data.json?url';
/* 黑潮爆破默认弹窗动画的位图素材(animations/animation_6/images/*.png):
 * JSON 里是相对路径(u:"images/"),站点产物里没有 images/ 目录,必须按静态资源打包后改写资源地址
 * (见 ensureBlastData)。目录里同时还有一份 AE 视频图层的素材(.gif / .mp4),它们随 ty:9 视频图层一起被丢掉。
 * 用 glob 而不是逐个写死路径:重导出换素材名时不用改代码,缺图也只是那张图 404 而不是构建失败。
 * ?url&no-inline 不能省:这套动画的 images/ 里有 700 多个小 PNG(重新导出后视频素材变成了逐帧图),
 * Vite 默认会把小于 4KB 的静态资源内联成 data URI —— 700 张 2KB 的图内联进主 chunk 会把首屏 JS 从
 * 613KB 顶到 2.1MB(实测),而这些帧只有切到本动画时才用得上。加 no-inline 让它们照常产出独立文件,
 * 主 chunk 只保留 700 条 URL 字符串,帧图仍旧按需加载。 */
const blastImageModules = import.meta.glob('../animations/animation_6/images/*.png', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
}) as Record<string, string>;
/* 任务弹窗动画自带的哈夫币图标:JSON 里是相对路径(u:"images/", p:"MallIcon_HafuCoins.png"),
 * 站点里没有 images/ 目录,必须把它按静态资源打包后改写资源地址(见 ensureMissionData)。
 * 它同时是「图标选择」列表里的默认/内置图标,所以这里导入一次、两处共用。 */
import missionIconUrl from '../animations/animation_4/images/MallIcon_HafuCoins.png?url';

/* 任务弹窗动画的「图标选择」列表:用 animations/animation_4/icon/ 下的图标(MallIcon_*.png),
 * 与 animations/animation_2/icon/ 的干员技能图标分开 —— 两套动画的图标素材不同,不能混在同一个列表里。
 * 目录不存在/为空时回落到打包的动画自带图标(见 MISSION_ICON_OPTIONS 的合并逻辑)。 */
const missionIconModules = import.meta.glob('../animations/animation_4/icon/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/* 核电站功率动画的叠加序列:animations/animation_3/png resources/ 下的两个文件夹,各 359 帧 1920×1080 透明 PNG。
 * (README.txt:两条都是 60fps 图像序列,直接叠加使用,默认开启,且可更改颜色。)
 * 文件名形如「99999_00000.png」「百叶窗_00000.png」,帧号补零到 5 位,按文件名升序即帧序。
 * 用 ?url 打包:dev 由站点直接提供,build 时随构建产出静态资源(与 animations/animation_2/icon 同做法)。 */
const blindsSeqModules: Record<string, string>[] = [
  import.meta.glob('../animations/animation_3/png resources/99999/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  import.meta.glob('../animations/animation_3/png resources/百叶窗/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
];
/* 把 glob 得到的「路径 → url」映射按键名升序取出 url 数组：文件名帧号补零到 5 位，字典序即帧序 */
const seqUrlsOf = (mods: Record<string, string>): string[] => Object.keys(mods).sort().map((k) => mods[k]);
/* place:'top' = 叠在最上层;'belowDigits' = 紧跟在五个数字位(第一~第五位)之下 */
const BLINDS_SEQUENCES: { name: string; urls: string[]; defaultHex: string; place: 'top' | 'belowDigits' }[] = [
  { name: '模糊效果', urls: seqUrlsOf(blindsSeqModules[0]), defaultHex: '#d82f28', place: 'belowDigits' },
  { name: '百叶窗', urls: seqUrlsOf(blindsSeqModules[1]), defaultHex: '#d82f28', place: 'top' },
];
const dataLoadingEl = $<HTMLDivElement>('dataLoading');
const dataLoadingFill = $<HTMLDivElement>('dataLoadingFill');
const dataLoadingPct = $<HTMLSpanElement>('dataLoadingPct');
const dlTitle = $<HTMLElement>('dlTitle');

/* 数据加载浮层：大体积 JSON 按需下载时显示，进度条支持确定/不确定两种形态
 *（.indet class = 拿不到 Content-Length 时来回滑动的动画）。 */
function showDataLoading(label: string) {
  dlTitle.textContent = '正在加载「' + label + '」数据…';
  dataLoadingFill.classList.remove('indet');
  dataLoadingFill.style.width = '0%';
  dataLoadingPct.textContent = '0%';
  dataLoadingEl.hidden = false;
}
/* p 为 0..1 的下载比例；null / undefined / NaN 表示总长度未知（HEAD 未返回 Content-Length），
 * 此时切到不确定进度样式并显示「…」。 */
function setDataLoadingProgress(p: number | null | undefined) {
  if (dataLoadingEl.hidden) return;
  if (p === null || p === undefined || !isFinite(p)) {
    // 拿不到总长度时显示不确定进度动画
    dataLoadingFill.classList.add('indet');
    dataLoadingPct.textContent = '…';
    return;
  }
  dataLoadingFill.classList.remove('indet');
  const v = Math.max(0, Math.min(100, Math.round(p * 100)));
  dataLoadingFill.style.width = v + '%';
  dataLoadingPct.textContent = v + '%';
}
function hideDataLoading() {
  dataLoadingEl.hidden = true;
}

/* 流式读取单个 JSON 资源:按 Content-Length 回报真实下载进度 */
async function fetchJsonText(url: string, onProgress?: (p: number | null) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('数据加载失败(HTTP ' + res.status + ')');
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body) {
    const t = await res.text();
    if (onProgress) onProgress(1);
    return t;
  }
  /* 手动读流：res.text() 拿不到中途进度。分片先累积再统一解码，TextDecoder 用 stream:true
   * 保证多字节字符被切在两个分片之间时不会解出乱码。 */
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (onProgress) onProgress(total ? got / total : null);
  }
  if (onProgress) onProgress(1);
  let text = '';
  for (const part of parts) text += decoder.decode(part, { stream: true });
  text += decoder.decode();
  return text;
}

/* 顺序下载多个 JSON 并合并为同一进度(如撤离数据 + 弹窗数据) */
/* 先逐个发 HEAD 取各文件的 Content-Length 作为权重，再串行 GET：进度因此是单调的，
 * 不会因并发完成顺序而回退，也避免多个大 JSON 同时驻留内存。
 * 任一长度缺失（响应无 Content-Length）时整体退化为不确定进度。 */
async function fetchJsonBundle(urls: string[], onProgress?: (p: number | null) => void): Promise<string[]> {
  const lens: number[] = [];
  let total = 0;
  for (const u of urls) {
    let len = 0;
    try {
      const head = await fetch(u, { method: 'HEAD' });
      len = Number(head.headers.get('Content-Length') || 0);
    } catch { /* 拿不到长度时退化为不确定进度 */ }
    lens.push(len);
    total += len;
  }
  const outs: string[] = [];
  let base = 0;
  for (let i = 0; i < urls.length; i++) {
    const text = await fetchJsonText(urls[i], (p) => {
      if (!onProgress) return;
      onProgress(total ? (base + (p === null ? 0 : lens[i] * p)) / total : null);
    });
    base += lens[i];
    outs.push(text);
  }
  if (onProgress) onProgress(1);
  return outs;
}

/* 位置暴露动画可选图标:animations/animation_2/icon/*.webp(仓库现以 WebP 存放,体积约为 PNG 的 43%;
 * 用 PNG 存放同样识别)。打包进网站,供用户选择替换图标图层;两种扩展名都收,
 * 避免素材换格式后列表变空 */
const iconModules = import.meta.glob('../animations/animation_2/icon/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
/* 图标选项列表（{name, url}）：同名 PNG/WebP 只保留 WebP（素材换格式后列表不出现重复项），
 * 再按名称自然序排序 —— numeric:true 让 Hero_Sp_2 排在 Hero_Sp_10 前面。 */
const ICON_OPTIONS = (() => {
  // 同名图标同时存在 PNG 与 WebP 时只保留 WebP(体积约为 PNG 的 40%),避免列表出现重名重复项
  const byBase = new Map<string, { name: string; url: string }>();
  for (const [path, url] of Object.entries(iconModules)) {
    const name = path.split('/').pop() ?? '';
    const base = name.replace(/\.[^.]+$/, '');
    const prev = byBase.get(base);
    const isWebp = /\.webp$/i.test(name);
    if (prev && !(isWebp && !/\.webp$/i.test(prev.name))) continue;
    byBase.set(base, { name, url });
  }
  return [...byBase.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
})();
const DEFAULT_ICON_BASE = 'Hero_Sp_03'; // 默认图标(不含扩展名,PNG/WebP 均可)
/* 默认图标文件名：优先精确匹配 DEFAULT_ICON_BASE（扩展名不限），素材缺失时退化为列表首项，
 * 再退化为约定的 .png 文件名 —— 保证任何情况下都有非空值可用。 */
const DEFAULT_ICON_NAME =
  ICON_OPTIONS.find((o) => o.name.replace(/\.[^.]+$/, '') === DEFAULT_ICON_BASE)?.name ??
  ICON_OPTIONS[0]?.name ??
  DEFAULT_ICON_BASE + '.png';

/* 撤离动画数据缓存 + 「进行中的加载」Promise：并发调用（切动画 / 导出 / 改时长）复用同一次
 * 下载与解析，避免同一份大 JSON 被重复拉取。 */
let bootAnimation: any = null;
let bootDataPromise: Promise<void> | null = null;

/* 撤离动画(animation_data.json)+ 弹窗动画(windows_animation.json)数据加载 */
/* 数据按需加载：每个入口都可能被并发调用，因此用 bootDataPromise 合流 ——正在加载就复用
 *（进度以不确定态显示），失败则置空以便下次重试。撤离动画与弹窗动画打包在同一次 bundle 里
 * 下载，两者都就绪才算成功。 */
async function ensureExtractionData(onProgress?: (p: number | null) => void): Promise<void> {
  if (bootAnimation && popupData) return;
  if (bootDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return bootDataPromise;
  }
  bootDataPromise = (async () => {
    try {
      if (!bootAnimation) {
        const [animationDataJson, windowsAnimationRaw] = await fetchJsonBundle(
          [animationDataUrl, windowsAnimationUrl],
          onProgress,
        );
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
        /* 弹窗动画(windows_animation.json):不含音频/图片资源,剥离字体后仅剩图层文本 */
        popupData = JSON.parse(windowsAnimationRaw);
      } else if (!popupData) {
        const windowsAnimationRaw = await fetchJsonText(windowsAnimationUrl, onProgress);
        popupData = JSON.parse(windowsAnimationRaw);
      }
    } catch (e) {
      console.error('[内置动画数据解析失败]', e);
      setStatus('内置动画数据解析失败: ' + (e as Error).message, true);
    }
    // 若仍有未加载部分,允许下次重试
    if (!bootAnimation || !popupData) bootDataPromise = null;
  })();
  return bootDataPromise;
}

/* 位置暴露动画：主段数据、二次扫描段数据，以及用于并发合流的「进行中」Promise */
let animation2Data: any = null;
let animation2NextData: any = null;
let exposedDataPromise: Promise<void> | null = null;
/* 核电站功率动画(animations/animation_3):底层动画数据 + 两条逐帧 PNG 叠加序列(默认开启,无开关) */
let blindsData: any = null;
let blindsDataPromise: Promise<void> | null = null;
/* 任务弹窗动画(animations/animation_4):单段数据 + 一张哈夫币位图,没有音频/叠加序列 */
let missionData: any = null;
let missionDataPromise: Promise<void> | null = null;
/* 地图标题动画(animations/animation_5):纯文字 + 形状,没有图片资源/音频/叠加序列 */
let mapTitleData: any = null;
let mapTitleDataPromise: Promise<void> | null = null;
let baiyechuangOriginalData: string | null = null; // 百叶窗原始图片 data URI,供调色重置
let baiyechuang2OriginalData: string | null = null; // 百叶窗2(二次扫描)原始图片 data URI,供调色重置
let guangOriginalData: string | null = null; // 光.png(二次扫描)原始图片 data URI,供调色重置

/* 位置暴露动画(animation_data.json + 二次扫描 animation_data_next_fixed.json)数据加载。
 * 其内嵌音频为 Bodymovin 导出的坏占位符(data:audio/mp3;base64,undefined),
 * 剥离后注入独立的 WAV 音效资源(音频层 refId=audio_0 指向打包的 WAV 文件)。 */
/* 同 ensureExtractionData：并发合流 + 失败可重试。主段与二次扫描段在同一个 bundle 里下载，
 * 缺任何一个都视为未就绪（exposedDataPromise 置空后可重来）。 */
async function ensureExposedData(onProgress?: (p: number | null) => void): Promise<void> {
  if (animation2Data && animation2NextData) return;
  if (exposedDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return exposedDataPromise;
  }
  exposedDataPromise = (async () => {
    try {
      if (!animation2Data) {
        const [animation2DataJson, animation2NextRaw] = await fetchJsonBundle(
          [animation2DataUrl, animation2NextUrl],
          onProgress,
        );
        const stripped2 = animation2DataJson.replace(/"data:audio[^"]*"/g, '""');
        animation2Data = JSON.parse(stripped2);
        // 注入音效资源:音频层 refId=audio_0 使用打包的 WAV 文件(预览播放与导出均使用它)。
        // 原始 JSON 已存在 audio_0 资源,但其 p 为坏占位符(剥离后为空),需覆盖其路径。
        animation2Data.assets = animation2Data.assets ?? [];
        const audioAsset = animation2Data.assets.find((a: any) => a.id === 'audio_0');
        if (audioAsset) {
          audioAsset.p = exposedAudioUrl;
          audioAsset.u = '';
          audioAsset.e = 1;
        } else {
          animation2Data.assets.push({ id: 'audio_0', p: exposedAudioUrl, u: '', e: 1 });
        }
        // 修复音频层音量:au.lv 为 [0,0] 会被 lottie 当作静音,改为满音量并按 AUDIO_VOLUME 调低
        /* 递归修复音频层音量（ty=6，预合成内嵌套的图层也要处理）：
         * 原 JSON 的 au.lv 是 [0,0]，lottie 会把它当成静音；这里改写为
         * AUDIO_VOLUME（0..1）× 100 取整后的值（lottie 的音量按 0..100 解释）。 */
        const fixAudioVol = (layers: any[]) => {
          for (const l of layers ?? []) {
            if (l.ty === 6 && l.au && l.au.lv) l.au.lv.k = [Math.round(AUDIO_VOLUME * 100)];
            if (Array.isArray(l.layers)) fixAudioVol(l.layers);
          }
        };
        fixAudioVol(animation2Data.layers);
        // 记录百叶窗.png 引用的原始图片资源
        const baiyechuangLayer = (animation2Data.layers ?? []).find((l: any) => l.ty === 2 && l.nm === '百叶窗.png');
        if (baiyechuangLayer) {
          const asset = (animation2Data.assets ?? []).find((a: any) => a.id === baiyechuangLayer.refId);
          if (asset && typeof asset.p === 'string') baiyechuangOriginalData = asset.p;
        }
        // 默认图标:把图标图层(image_0)资源指向 Hero_Sp_03.webp,保证默认一致
        const defIcon = ICON_OPTIONS.find((o) => o.name === DEFAULT_ICON_NAME);
        const iconAsset = (animation2Data?.assets ?? []).find((a: any) => a.id === 'image_0');
        if (defIcon && iconAsset) {
          iconAsset.p = defIcon.url;
          iconAsset.u = '';
          iconAsset.e = 1;
        }
        // 二次扫描数据
        animation2NextData = JSON.parse(animation2NextRaw);
        // 记录百叶窗2.png / 光.png 引用的原始图片资源(合并后资源 id 分别为 image_2_n / image_1_n)
        const recordOrigImage = (nm: string, setter: (p: string) => void) => {
          const layer = (animation2NextData?.layers ?? []).find((l: any) => l.ty === 2 && l.nm === nm);
          if (!layer) return;
          const asset = (animation2NextData?.assets ?? []).find((a: any) => a.id === layer.refId);
          if (asset && typeof asset.p === 'string') setter(asset.p);
        };
        recordOrigImage('百叶窗2.png', (p: string) => { baiyechuang2OriginalData = p; });
        recordOrigImage('光.png', (p: string) => { guangOriginalData = p; });
      } else if (!animation2NextData) {
        const animation2NextRaw = await fetchJsonText(animation2NextUrl, onProgress);
        animation2NextData = JSON.parse(animation2NextRaw);
      }
    } catch (e) {
      console.error('[位置暴露动画数据解析失败]', e);
      setStatus('位置暴露动画数据解析失败: ' + (e as Error).message, true);
    }
    // 若仍有未加载部分,允许下次重试
    if (!animation2Data || !animation2NextData) exposedDataPromise = null;
  })();
  return exposedDataPromise;
}
/* ---------- 核电站功率动画(animations/animation_3)----------
 * 数据 = animations/animation_3/animation_data.json(底层 HUD 动画,1920×1080 / 60fps / 359 帧)
 *      + animations/animation_3/png resources/ 下的两条 359 帧透明 PNG 序列(99999 / 百叶窗),叠在最上层。
 * 为什么叠加而不是直接渲染 JSON:AE 的「百叶窗(Venetian Blinds)」效果 lottie-web 不支持
 * (JSON 里只有效果参数 ADBE Venetian Blinds,渲染不出纹理),所以纹理在 AE 里逐帧渲染成
 * PNG 序列,这里按「图片序列图层」叠回动画之上——底层 JSON 里的百叶窗效果层保持原样
 * (其描边透明度为 0,不产生可见内容)。
 * 复用站点既有的「图片序列图层」通路(图层 ks.src 逐帧关键帧 + assets[] 逐帧图片):
 * 预览(SVG / Canvas)与视频导出(H.264 MP4/AVI、无压缩 AVI)都自动包含叠加层,无需另写合成代码。
 * 两条序列按 README.txt 默认开启、不设开关;颜色在侧栏「图片图层」里改(见 syncSeqTintFilters)。 */
/* 在底层动画数据上叠加两条逐帧 PNG 序列：图层改名 → 微调「形状图层 6」的 Y 缩放 →
 * 为每一帧 PNG 建一条资源和一个图片层（src 逐帧关键帧）→ 按 place 插进图层数组。
 * 注意：原地修改并返回传入的 base（不深拷贝），且不做去重 —— 对同一份数据重复调用会重复
 * 追加图层与资源，因此只允许执行一次（由 ensureBlindsData 的缓存保证）。 */
function buildBlindsComposite(
  base: any,
  seqs: { name: string; urls: string[]; place?: 'top' | 'belowDigits' }[],
  audioUrl: string,
): any {
  const data = base;
  data.assets = data.assets ?? [];
  data.layers = data.layers ?? [];
  /* 图层改名(图层名不参与渲染,改名无副作用):
   *   「图层 1」实际是核辐射标志图形;897/898/899/900/9 是五个纯数字文字图层,按位次显示为「第 N 位」 */
  const renameMap: Record<string, string> = {
    '图层 1': '核辐射标志',
    '897': '第一位',
    '898': '第二位',
    '899': '第三位',
    '900': '第四位',
    '9': '第五位',
  };
  for (const l of data.layers) {
    if (l && typeof l.nm === 'string' && renameMap[l.nm]) l.nm = renameMap[l.nm];
  }
  /* 形状图层 6:Y 轴缩放略调大(1.1 = +10%,视觉微调)。要再调只改这个系数即可。 */
  const SHAPE6_Y_SCALE = 1.3;
  for (const l of data.layers) {
    if (!l || l.nm !== '形状图层 6' || !l.ks?.s) continue;
    const s = l.ks.s;
    const bump = (arr: any) => {
      for (const kf of arr) {
        if (Array.isArray(kf?.s) && kf.s.length >= 2) kf.s[1] = Math.round(kf.s[1] * SHAPE6_Y_SCALE * 1000) / 1000;
        if (Array.isArray(kf?.e) && kf.e.length >= 2) kf.e[1] = Math.round(kf.e[1] * SHAPE6_Y_SCALE * 1000) / 1000;
      }
    };
    if (s.a === 0 && Array.isArray(s.k)) {
      s.k = [s.k[0], Math.round(s.k[1] * SHAPE6_Y_SCALE * 1000) / 1000, s.k[2] ?? 100];
    } else if (Array.isArray(s.k)) {
      bump(s.k);
    }
  }
  /* 注入的资源 id 与图层 ind 必须全局唯一：资源 id 用 taken 集合避让冲突（重名时尾部补 '_'），
   * 图层 ind 从现有最大值继续递增，避免与内置图层撞号。 */
  const taken = new Set<string>(data.assets.map((a: any) => a.id));
  let maxInd = data.layers.reduce((m: number, l: any) => Math.max(m, l.ind ?? 0), 0);
  /* 音效:animations/animation_3 的 JSON 里原本没有音频层,这里注入「音频资源 + 音频层」——
   * 结构与另外两套动画一致(资源 t:2 / 层 ty:6 + cl + refId),音量统一按站点音量 AUDIO_VOLUME。 */
  if (audioUrl) {
    data.assets.push({ id: 'audio_0', u: '', p: audioUrl, e: 1, t: 2 });
    data.layers.push({
      ddd: 0,
      ind: ++maxInd,
      ty: 6,
      nm: '反应堆音效.wav',
      cl: 'wav',
      refId: 'audio_0',
      sr: 1,
      ao: 0,
      au: { lv: { a: 0, k: [Math.round(AUDIO_VOLUME * 100)], ix: 1 } },
      ip: data.ip ?? 0,
      op: data.op ?? 359,
      st: 0,
      bm: 0,
    });
  }
  const injectedTop: any[] = [];       // 叠在最上层
  const injectedBelowDigits: any[] = []; // 紧跟五个数字位之下
  seqs.forEach((seq, si) => {
    if (!seq.urls.length) return;
    const seqIds: string[] = [];
    seq.urls.forEach((url, i) => {
      let id = 'seq' + si + '_' + i;
      while (taken.has(id)) id += '_';
      taken.add(id);
      // e:1 让 lottie 直接把 p 当完整地址(不做 u/p 拼接),与站点其它注入资源一致
      data.assets.push({ id, w: data.w, h: data.h, u: '', p: url, e: 1 });
      seqIds.push(id);
    });
    /* 图片序列的标准写法：把图片源属性 src 做成关键帧，第 i 帧指向第 i 个资源 id。
     * 关键帧时刻 t 直接用帧号（合成 60fps，一帧 = 1），所以 seqIds 的顺序必须与帧序一致。 */
    const srcKeyframes = seqIds.map((id, i) => ({ t: i, s: [id] }));
    (seq.place === 'belowDigits' ? injectedBelowDigits : injectedTop).push({
      ddd: 0,
      ind: ++maxInd,
      ty: 2,
      nm: seq.name,
      refId: seqIds[0],
      sr: 1,
      ks: {
        o: { a: 0, k: 100, ix: 11 },
        r: { a: 0, k: 0, ix: 10 },
        // 图片以左上角为原点绘制:位置/锚点归零即与 1920×1080 合成区 1:1 对齐
        p: { a: 0, k: [0, 0, 0], ix: 2 },
        a: { a: 0, k: [0, 0, 0], ix: 1 },
        s: { a: 0, k: [100, 100, 100], ix: 6 },
        src: { a: 1, k: srcKeyframes },
      },
      ao: 0,
      ip: data.ip ?? 0,
      op: data.op ?? srcKeyframes.length,
      st: 0,
      bm: 0,
    });
  });
  /* lottie 图层数组:下标越小越靠上,数组末尾 = 最下层。
   * 「模糊效果」(原 99999 叠加序列)要求紧跟五个数字位之下 —— 数字压在它上面,
   * 但不再压到最底层(它下面还有 HAAVK / MW 等图层);
   * 「百叶窗」保持叠在最上层。 */
  /* 定位「紧贴数字位之下」的插入点：lottie 图层数组下标越小越靠上，取最后一个数字位图层的
   * 下标 +1 即它的正下方；数据被改过、找不到数字位图层时退化为插到数组末尾（即最下层）。 */
  let digitEnd = -1;
  data.layers.forEach((l: any, i: number) => {
    if (l?.ty === 5 && isSingleDigitTextName(l.nm)) digitEnd = i;
  });
  const insertAt = digitEnd >= 0 ? digitEnd + 1 : data.layers.length;
  data.layers = [
    ...injectedTop,
    ...data.layers.slice(0, insertAt),
    ...injectedBelowDigits,
    ...data.layers.slice(insertAt),
  ];
  return data;
}

/* 核电站功率动画数据加载(JSON 按需下载,叠加序列帧由打包资源提供) */
async function ensureBlindsData(onProgress?: (p: number | null) => void): Promise<void> {
  if (blindsData) return;
  if (blindsDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return blindsDataPromise;
  }
  blindsDataPromise = (async () => {
    try {
      // 音效与数据包并行预取(不放到启动预载里:1.1MB,只有切到本动画才需要)
      void audioFactory(blindsAudioUrl);
      const [raw] = await fetchJsonBundle([animation3DataUrl], onProgress);
      blindsData = buildBlindsComposite(JSON.parse(raw), BLINDS_SEQUENCES, blindsAudioUrl);
    } catch (e) {
      console.error('[核电站功率动画数据解析失败]', e);
      setStatus('核电站功率动画数据解析失败: ' + (e as Error).message, true);
    }
    // 失败时允许下次重试
    if (!blindsData) blindsDataPromise = null;
  })();
  return blindsDataPromise;
}

/* ---------- 任务弹窗动画(animations/animation_4)----------
 * 数据 = animations/animation_4/animation_data.json(1920×1080 / 60fps / 单段、无音频;出点以数据里的 op 为准),
 * 画面内容:行动开始 / 任务名 / 预期报酬 / 数字 四个文字层 + 一枚哈夫币图标(MallIcon_HafuCoins.png)。
 * 载入时要处理两件与其它动画不同的事:
 *  ① **图片资源带目录前缀(按"是不是图标"判断,不写死文件名)**:Bodymovin 把 AE 的素材写成
 *     u:"images/(子目录/)" + p:"文件名",而站点产物里没有 images/ 目录,原样渲染会 404(SVG/Canvas 都是空白图)。
 *     这里把这类资源改写成打包后的静态资源地址(p 指向 ?url 导入的产物、u 置空、e 置 1,lottie 才会把 p
 *     当完整地址)。判断方式是「p 不是完整地址(data:/http/绝对路径)且文件名叫 MallIcon_HafuCoins.png」
 *     —— 用文件名的**基名**比对:重新导出时 AE 可能把素材归到子目录(如 images/MallIcon/MallIcon_HafuCoins.png),
 *     只比对完整 p 就会漏改。之后用户在「图标选择」里换图标 / 上传自定义图标时,写的也是同一条资源(见 applyIconUrlToScope)。
 *  ② 数据里带了一个 AE「视频图层」(ty:9,引用 images/<文件名>.mp4):lottie-web 不支持视频图层,
 *     它的处理方式是把它当成图片层挂上去、href 指向那个相对路径(站点里并不存在该文件);
 *     而且 AE 工程里这一层本来就是隐藏的(hd:true)、配套素材动辄上 GB。这里直接把这类图层连同
 *     只被它引用的视频资源一起丢掉,避免多出一次必然 404 的请求,也让「资源数」等信息更准确。 */
async function ensureMissionData(onProgress?: (p: number | null) => void): Promise<void> {
  if (missionData) return;
  if (missionDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return missionDataPromise;
  }
  missionDataPromise = (async () => {
    try {
      const [raw] = await fetchJsonBundle([missionDataUrl], onProgress);
      const data = JSON.parse(raw);
      /* 图标资源的 u/p 拼接改成完整静态资源地址(与 animations/animation_2 图标同做法)。
       * 只认「相对路径」的资源:重新导出时若 Bodymovin 直接输出 data: URI,或导成了别的绝对地址,就别去动它。 */
      const isAbsoluteAssetUrl = (p: string) => /^(data:|https?:|\/\/|\/|\.\.?[\/\\])/i.test(p);
      for (const a of data.assets ?? []) {
        if (typeof a?.p !== 'string' || isAbsoluteAssetUrl(a.p)) continue;
        if (a.p.split(/[\/\\]/).pop() === 'MallIcon_HafuCoins.png') {
          a.p = missionIconUrl;
          a.u = '';
          a.e = 1;
        }
      }
      /* 丢掉视频图层(ty:9)与它独占的资源:先收集被丢图层的 refId,再删掉没人再引用的视频资源。
       * 递归处理预合成内部,避免嵌套里的视频层被漏掉。 */
      const droppedRefs = new Set<string>();
      const dropVideoLayers = (layers: any[]): any[] => {
        const kept: any[] = [];
        for (const l of layers ?? []) {
          if (l && l.ty === 9) {
            if (typeof l.refId === 'string') droppedRefs.add(l.refId);
            continue;
          }
          if (Array.isArray(l?.layers)) l.layers = dropVideoLayers(l.layers);
          kept.push(l);
        }
        return kept;
      };
      data.layers = dropVideoLayers(data.layers);
      for (const a of data.assets ?? []) if (Array.isArray(a.layers)) a.layers = dropVideoLayers(a.layers);
      if (droppedRefs.size) {
        const stillUsed = new Set<string>();
        const collect = (layers: any[]) => {
          for (const l of layers ?? []) {
            if (typeof l?.refId === 'string') stillUsed.add(l.refId);
            if (Array.isArray(l?.layers)) collect(l.layers);
          }
        };
        collect(data.layers);
        for (const a of data.assets ?? []) if (Array.isArray(a.layers)) collect(a.layers);
        data.assets = (data.assets ?? []).filter((a: any) => !(droppedRefs.has(a.id) && !stillUsed.has(a.id)));
      }
      missionData = data;
    } catch (e) {
      console.error('[任务弹窗动画数据解析失败]', e);
      setStatus('任务弹窗动画数据解析失败: ' + (e as Error).message, true);
    }
    // 失败时允许下次重试
    if (!missionData) missionDataPromise = null;
  })();
  return missionDataPromise;
}

/* ---------- 地图标题动画(animations/animation_5)----------
 * 数据 = animations/animation_5/animation_data.json(2560×1024 / 60fps / op=327,即 327 帧 ≈ 5.45s;
 * 宽画布 + 文字左对齐:内容贴在画布左侧(左边缘 ≈102px),右侧留出空间供长地名把底框撑开;
 * 底框/描边随文字宽度自适应,见 captureMaptitlePlateBase / adaptMaptitlePlateWidth;
 * 原始导出里 ip=4,会把「地图名称」从第 0 帧开始的淡入切掉前 4 帧,已本地归一为 ip=0,见 README),
 * 画面内容:上方「地图名称」+ 下方「地图地点」(带一条底框 + 描边衬板,两层都有闪烁的不透明度关键帧),
 * 两个 NULL CONTROL 负责整组的位移。没有音频、没有位图资源、没有叠加序列,
 * 所以载入就是纯 JSON 解析 —— 不需要像任务弹窗动画那样改写资源地址,也不需要注入音频层。
 * 字体与其它动画一致:JSON 里的 fPath 已被剥离,运行时按 fName 从 animations/animation_1/fonts/ 解析;
 * chars 只烘焙了「地图点名称」五个字,用户改成表外字时由 dropCharsIfUncovered 自动退回浏览器文本引擎。 */
async function ensureMapTitleData(onProgress?: (p: number | null) => void): Promise<void> {
  if (mapTitleData) return;
  if (mapTitleDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return mapTitleDataPromise;
  }
  mapTitleDataPromise = (async () => {
    try {
      const [raw] = await fetchJsonBundle([mapTitleDataUrl], onProgress);
      mapTitleData = JSON.parse(raw);
    } catch (e) {
      console.error('[地图标题动画数据解析失败]', e);
      setStatus('地图标题动画数据解析失败: ' + (e as Error).message, true);
    }
    // 失败时允许下次重试
    if (!mapTitleData) mapTitleDataPromise = null;
  })();
  return mapTitleDataPromise;
}


/* ---------- 黑潮爆破默认弹窗动画(animations/animation_6)----------
 * 数据 = animations/animation_6/animation_data.json(1920×1080 / 60fps / op=600 = 600 帧,保持 AE 导出原样;
 * 这套动画**不配 caps.defaultDuration**,侧栏也没有时长区块 —— 改时长会搬动末尾淡出关键帧,属于改数据)。
 * 画面内容:「主标题 / 副标题」两个文字层 + 一条 HUD 底条(预合成 2 里的 656×16 位图,叠了填充与线性擦除)
 *      + 三张提示位图(一张 512×84 长条与两张 256×256 图标)、一段 696 帧的逐帧序列
 *      (AE 里的视频素材,导出成 Bodymovin 的 image sequence:assets[] 里的 sequence_0 + 696 个 t:"seq" 资源,
 *      由「预合成 1」里的一条 ty:0 图层引用),再用毛边/方框模糊的形状层做轨道遮罩叠出观感。
 * 载入时要处理三件与其它动画不同的事:
 *  ① 位图资源的 u/p 是相对路径(u:"images/"),站点产物里没有 images/ 目录,原样渲染必然 404(SVG / Canvas 都是空白图)。
 *     这里按**文件基名**把 animations/animation_6/images/*.png 换成本地打包后的静态资源地址(p 指向 ?url 的产物、
 *     u 置空、e 置 1 —— 只有 e 为真时 lottie 才把 p 当完整地址)。与任务弹窗动画同做法:只认「相对路径」的资源,
 *     重新导出若已写成 data: URI 或绝对地址就不去动它。
 *     注意这条规则现在要覆盖 700 多个文件(见上面 glob 处的 ?url&no-inline 说明):序列帧一个都不能漏,
 *     漏掉就是那几帧空白。基名匹配正好兜住这种「同一个目录里既有单图又有成百上千张序列帧」的情况。
 *  ② 视频图层(ty:9)及其素材必须整个丢掉,这次不是「可丢可不丢」:数据里除了一堆引用 GIF 的 ty:9 图层,
 *     还带了 9 个 xt:1 的外链预合成(数值 id,内容全是 ty:9 视频层)。lottie 的 searchExtraCompositions 会对
 *     每个 xt 资源直接 createComp,而这些资源在浏览器侧是残缺的,构建时抛 TypeError;异常发生在
 *     AnimationItem.configAnimation 的 try/catch 里被吞掉,表现为 DOMLoaded 永不触发、预览整帧全黑
 *     (SVG / Canvas 都一样,实测)。做法:递归删掉 ty:9 图层,再删掉**没有任何图层再引用**的资源 ——
 *     外链预合成与 GIF 素材就此一并消失,也省掉必然 404 的请求。
 *     ⚠ 这套「按引用回收」的判据只认图层的 refId:696 个序列帧资源正是被 sequence_0 内部的图层逐个 refId 引用,
 *     所以它们会**原样保留**(实测 696/696 全部留着);重新导出后若资源数骤降,先查这一条。
 *  ③ 剩余资源里有 tt:3 亮度遮罩,canvas 渲染器根本构建不出来(上游 lottie-web 的 bug,见 hasLumaMatte),
 *     所以这套动画的预览与导出都必须走 SVG —— 由 hasLumaMatte 统一判定,切到该动画时自动切回 SVG 渲染器。
 * 字体与其它动画一致(fName = ProjectDType-Medium / ProjectDTypeCurve-Bold,fPath 已被剥离),
 * 运行时由 loadEmbeddedFonts 从 animations/animation_1/fonts/ 注册,这里不需要额外处理。 */
let blastData: any = null;
let blastDataPromise: Promise<void> | null = null;
/* 位图素材的「文件基名 → 打包地址」表:重新导出时 AE 可能把素材归到子目录,只比对完整 p 会漏改,
 * 所以一律按基名匹配(与任务弹窗动画的图标改写同规则)。 */
const blastImageUrlByBase = new Map<string, string>();
for (const [path, url] of Object.entries(blastImageModules)) {
  const base = path.split('/').pop();
  if (base) blastImageUrlByBase.set(base, url);
}

async function ensureBlastData(onProgress?: (p: number | null) => void): Promise<void> {
  if (blastData) return;
  if (blastDataPromise) {
    if (onProgress) onProgress(null); // 已在加载中:以不确定进度显示
    return blastDataPromise;
  }
  blastDataPromise = (async () => {
    try {
      const [raw] = await fetchJsonBundle([blastDataUrl], onProgress);
      const data = JSON.parse(raw);
      /* ① 把相对路径的位图资源改写成打包地址 */
      const isAbsoluteAssetUrl = (p: string) => /^(data:|https?:|\/\/|\/|\.\.?[\/\\])/i.test(p);
      for (const a of data.assets ?? []) {
        if (typeof a?.p !== 'string' || isAbsoluteAssetUrl(a.p)) continue;
        const base = a.p.split(/[\/\\]/).pop() ?? '';
        const url = blastImageUrlByBase.get(base);
        if (!url) continue; // 视频 / GIF 素材:引用它们的图层随后会被删掉,这里不动
        a.p = url;
        a.u = '';
        a.e = 1;
      }
      /* ② 递归丢掉视频图层(ty:9),预合成内部也一并处理 */
      const dropVideoLayers = (layers: any[]): any[] => (layers ?? []).filter((l) => {
        if (l && l.ty === 9) return false;
        if (Array.isArray(l?.layers)) l.layers = dropVideoLayers(l.layers);
        return true;
      });
      data.layers = dropVideoLayers(data.layers);
      for (const a of data.assets ?? []) if (Array.isArray(a.layers)) a.layers = dropVideoLayers(a.layers);
      /* ②续 删掉没有任何图层引用的资源:xt 外链预合成与视频资源都在此列。
       * 引用表必须在「删完视频图层之后」重新收集 —— 否则刚被删掉的视频层仍会把 video_* 算作「有人在用」。 */
      const usedRefs = new Set<string>();
      const collectRefs = (layers: any[]) => {
        for (const l of layers ?? []) {
          if (typeof l?.refId === 'string') usedRefs.add(l.refId);
          if (Array.isArray(l?.layers)) collectRefs(l.layers);
        }
      };
      collectRefs(data.layers);
      for (const a of data.assets ?? []) if (Array.isArray(a.layers)) collectRefs(a.layers);
      data.assets = (data.assets ?? []).filter((a: any) => usedRefs.has(String(a.id)));
      blastData = data;
    } catch (e) {
      console.error('[黑潮爆破动画数据解析失败]', e);
      setStatus('黑潮爆破动画数据解析失败: ' + (e as Error).message, true);
    }
    // 失败时允许下次重试
    if (!blastData) blastDataPromise = null;
  })();
  return blastDataPromise;
}

/* 递归偏移对象中所有动画属性({a:1, k:[{t,...}]})的关键帧时刻 t */
/* 说明：只平移动画属性（{a:1}）里关键帧的 t（帧号，60fps 下一帧 = 1）；数组直接递归；
 * 遇到 a===1 的 k 数组后不再向下递归，避免把关键帧的 s/e 值当成嵌套属性处理；
 * delta 与图层 ip/op/st 同一单位（合成帧），两者必须一起平移，否则图层区间与动画内容错位。 */
function offsetKeyframes(obj: any, delta: number) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const x of obj) offsetKeyframes(x, delta);
    return;
  }
  if (obj.a === 1 && Array.isArray(obj.k)) {
    for (const kf of obj.k) if (kf && typeof kf.t === 'number') kf.t += delta;
  }
  for (const key of Object.keys(obj)) {
    if (key === 'k' && obj.a === 1) continue;
    offsetKeyframes(obj[key], delta);
  }
}

/* 第二段数据:重新编号 ind(+100)并更新 parent 引用、重命名资源(id+_n)并更新
 * refId、图层 ip/op/st 与全部关键帧整体平移 baseOp 帧。 */
/* 第二段与第一段共用一条时间线，合并前必须做四件事：
 *   ① 图层 ind 与 parent 引用整体 +100（全文件以「ind ≥ 100 即第二段」为约定，见 isMergedNext）；
 *   ② 资源 id 加 _n 后缀并同步改写 refId，避免与第一段同名资源互相覆盖、引用错图；
 *   ③ 图层 ip/op/st 与全部关键帧整体平移 baseOp 帧（baseOp = 第一段的 op），使第二段紧随其后；
 *   ④ 修掉 AE 导出遗留的路径手柄 / 轨道蒙版 / 底框填充等与第一段不一致的地方（见下）。
 * 入参 next 先被深拷贝，函数不会改动调用方的数据。 */
function prepareNextData(next: any, baseOp: number): any {
  const d = JSON.parse(JSON.stringify(next));
  const renumber = (layers: any[]) => {
    for (const l of layers ?? []) {
      l.ind += 100;
      if (typeof l.parent === 'number') l.parent += 100;
      if (Array.isArray(l.layers)) renumber(l.layers);
    }
  };
  renumber(d.layers);
  // 第二段的「光.png」「百叶窗2.png」是 tt:1 轨道蒙版目标(装饰效果),蒙版源分别为
  // 「形状图层 4」(td=1)与「底框」(td=1)。lottie 的 matte 配对默认取数组顺序中前一个
  // 图层作蒙版源,这两个图层的蒙版源并不紧邻,直接保留会配对失败被完整平铺显示
  // (百叶窗2 铺满金色斜纹、光.png 盖出光带)。这里保留图层,并用 tp 字段显式指定
  // 蒙版源(合并后 ind),使轨道蒙版正确生效:
  //   光.png → tp=101(形状图层 4)
  //   百叶窗2.png → tp=109(底框)
  // (此前曾整层移除这两层,导致二次扫描缺少百叶窗纹理;tp 方案已实测渲染正常。)
  for (const l of d.layers ?? []) {
    if (l.nm === '光.png') l.tp = 101;
    else if (l.nm === '百叶窗2.png') l.tp = 109;
  }
  // 优先复用新导出文件自带的可见底框副本(如“底框 可见”),它已含金色竖条,仅统一黑矩形
  // 不透明度为 55%(与第一段一致);旧文件没有可见副本时才自行注入(不改动源 JSON)。
  const existingVis = (d.layers ?? []).find(
    (l: any) => l.ind >= 100 && !l.td && /底框/.test(l.nm ?? '') && /可见/.test(l.nm ?? '')
  );
  // 统一第二段「底框 可见」为纯黑填充 #000000 + 黑矩形不透明度 55%(与第一段一致)。
  // 注意:第二段 AE 导出时竖条(形状 3/形状 2)的填充是绿色 [0.31,1,0.18](第一段为黑色),
  // 侧栏形状图层显示的是第一个填充(绿色),因此必须把所有形状组的填充统一为黑色,
  // 侧栏才会显示 #000000,渲染也与第一段一致(金/红描边 + 黑填充)。
  /* 只改两处：矩形形状组的 tr.o 固定为 55%（整体重建为静态值 a:0，消除可能的关键帧），
   * 以及所有形状组的填充 fl.c 统一为纯黑不透明（[0,0,0,1]，分量是 0..1 不是 0..255）。
   * 金色/红色描边保持原样不动。 */
  const normalizeDikuangRect = (layer: any) => {
    for (const g of layer?.shapes ?? []) {
      if (!g || g.ty !== 'gr' || !Array.isArray(g.it)) continue;
      const isRect = /矩形/.test(String(g.nm ?? ''));
      const tr = g.it.find((c: any) => c && c.ty === 'tr');
      if (tr && tr.o && isRect) tr.o = { a: 0, k: 55, ix: tr.o.ix };
      const fl = g.it.find((c: any) => c && c.ty === 'fl');
      if (fl) fl.c = { a: 0, k: [0, 0, 0, 1], ix: (fl.c && fl.c.ix) || 4 };
    }
  };
  if (existingVis) {
    normalizeDikuangRect(existingVis);
  } else {
    const src = (d.layers ?? []).find((l: any) => l.nm === '底框' && l.td === 1);
    if (src) {
      const vis = JSON.parse(JSON.stringify(src));
      vis.nm = '底框(可见)';
      // ind 取 900001：远离第一段（<100）与第二段（1xx）的号段，不会与任何真实图层撞号
      vis.ind = 900001;
      delete vis.td;
      normalizeDikuangRect(vis);
      d.layers.push(vis);
    }
  }
  /* 路径手柄绝对化(lottie completeData 的复刻):
   * Bodymovin 导出的形状路径手柄是相对值(如 [0,0] = 无手柄),lottie 加载时通过
   * convertPathsToAbsoluteValues 就地转换为绝对坐标(顶点 + 手柄)。但二次扫描数据
   * 从未被 lottie 单独处理过,而 mergeNextInto 深拷贝了已加载(带 __complete 标记)
   * 的主动画数据,合并数据再加载时 lottie 因 __complete 守卫跳过该转换,第二段路径的
   * 相对手柄 (0,0) 会被 buildShapeString 直接当作绝对控制点写入 SVG/Canvas,导致竖条
   * 等形状向形状原点(合成下方中心)弯曲成弧线。这里对第二段所有形状路径执行同样的
   * 转换,保证与第一段渲染一致。 */
  const convertPathKeys = (k: any) => {
    if (!k) return;
    if (Array.isArray(k)) {
      for (const kf of k) {
        if (kf && Array.isArray(kf.s)) for (const s of kf.s) convertPathKeys(s);
        if (kf && Array.isArray(kf.e)) for (const e of kf.e) convertPathKeys(e);
      }
      return;
    }
    if (Array.isArray(k.i) && Array.isArray(k.o) && Array.isArray(k.v)) {
      const len = Math.min(k.i.length, k.o.length, k.v.length);
      for (let j = 0; j < len; j += 1) {
        if (!k.i[j] || !k.o[j] || !k.v[j]) continue;
        k.i[j][0] += k.v[j][0];
        k.i[j][1] += k.v[j][1];
        k.o[j][0] += k.v[j][0];
        k.o[j][1] += k.v[j][1];
      }
    }
  };
  const convertShapesToAbsolute = (items: any[]) => {
    for (const it of items ?? []) {
      if (it.ty === 'sh' && it.ks) {
        convertPathKeys(it.ks.k);
      } else if (it.ty === 'gr' && Array.isArray(it.it)) {
        convertShapesToAbsolute(it.it);
      }
    }
  };
  for (const l of d.layers ?? []) {
    if (l.ty === 4 && Array.isArray(l.shapes)) convertShapesToAbsolute(l.shapes);
  }
  /* 资源 id 统一加 _n 后缀并建立「旧 → 新」映射，随后按映射改写所有 refId（含预合成内的嵌套
   * 图层）：两段数据出自同一套 AE 工程，资源 id 极可能重名，不区分会让第二段引用到第一段的图。 */
  const idMap = new Map<string, string>();
  for (const a of d.assets ?? []) {
    const newId = a.id + '_n';
    idMap.set(a.id, newId);
    a.id = newId;
  }
  const updateRefs = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l.refId && idMap.has(l.refId)) l.refId = idMap.get(l.refId)!;
      if (Array.isArray(l.layers)) updateRefs(l.layers);
    }
  };
  updateRefs(d.layers);
  /* 图层时间整体平移：ip（入点）/ op（出点）/ st（起始时刻）三个时间字段与全部关键帧时刻
   * 必须一起平移，否则图层的显示区间与它自己的动画会对不上。 */
  const offsetLayers = (layers: any[]) => {
    for (const l of layers ?? []) {
      l.ip += baseOp;
      l.op += baseOp;
      l.st += baseOp;
      offsetKeyframes(l, baseOp);
      // 文字图层:偏移 t.d.k 文字关键帧时刻(不在 {a:1,k:[...]} 结构内)
      const tdk = l?.t?.d?.k;
      if (Array.isArray(tdk)) for (const kf of tdk) if (kf && typeof kf.t === 'number') kf.t += baseOp;
      if (Array.isArray(l.layers)) offsetLayers(l.layers);
    }
  };
  offsetLayers(d.layers);
  d.ip += baseOp;
  d.op += baseOp;
  return d;
}

/* 是否已把第二段并进主数据：prepareNextData 给第二段图层统一 +100，因此出现 ind ≥ 100
 * 即视为已合并（整个文件都用这个约定区分两段）。 */
function isMergedNext(data: any): boolean {
  return Array.isArray(data?.layers) && data.layers.some((l: any) => l.ind >= 100);
}

/* 把第二段并入主数据(深拷贝,保留第一段编辑状态) */
/* 合并要点：主数据深拷贝，保留用户在第一段上的编辑状态；图层与资源直接首尾拼接；
 * 字体表按 fFamily/fName 去重合并，避免同名字体重复登记（lottie 按字体名查找，重复无益）。
 * 时长：op = 第一段 op + 第二段 op，并把第一段原 op 存进 __mainOp、第二段时长存进 __nextOp，
 * 供「取消二次扫描」还原主数据与时长显示使用。 */
function mergeNextInto(main: any): any {
  const d = JSON.parse(JSON.stringify(main));
  const next = prepareNextData(animation2NextData, d.op);
  // 二次扫描段图标:prepareNextData 把第二段的 image_0 重命名为 image_0_n,并按用户为
  // 二次扫描单独选定的图标覆盖它的图片资源(未单独指定时即「跟随位置暴露」当前值),
  // 保证每次开启二次扫描都是用户要的图标,而不是 JSON 内置的那张 PNG。
  const nextIconUrl = effectiveIconUrl('next');
  if (nextIconUrl) {
    const nextIconAsset = (next.assets ?? []).find((a: any) => a.id === 'image_0_n');
    if (nextIconAsset) {
      nextIconAsset.p = nextIconUrl;
      nextIconAsset.u = '';
      nextIconAsset.e = 1;
    }
  }
  d.layers = [...d.layers, ...next.layers];
  d.assets = [...d.assets, ...next.assets];
  const fonts = d.fonts?.list ?? [];
  const famSet = new Set(fonts.map((f: any) => f.fFamily || f.fName));
  for (const f of next.fonts?.list ?? []) {
    const fam = f.fFamily || f.fName;
    if (!famSet.has(fam)) {
      fonts.push(f);
      famSet.add(fam);
    }
  }
  d.fonts = d.fonts ?? { list: fonts };
  d.__mainOp = d.op;
  d.op = d.op + next.op;
  d.__nextOp = next.op;
  return d;
}

/* 从合并数据提取主数据(移除第二段图层/资源,恢复 op) */
function extractMainFrom(data: any): any {
  const d = JSON.parse(JSON.stringify(data));
  d.layers = d.layers.filter((l: any) => l.ind < 100);
  d.assets = d.assets.filter((a: any) => !String(a.id).endsWith('_n'));
  d.op = d.__mainOp ?? d.op;
  delete d.__mainOp;
  delete d.__nextOp;
  return d;
}

/* 平移第二段所有图层(第一段时长变化时保持两段紧接) */
function offsetSecondSegment(data: any, delta: number) {
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l.ind >= 100) {
        l.ip += delta;
        l.op += delta;
        l.st += delta;
        offsetKeyframes(l, delta);
        // 文字内容关键帧的时刻不在 {a:1,k:[...]} 结构里（t.d.k 直接就是数组），offsetKeyframes 覆盖不到
        const tdk = l?.t?.d?.k;
        if (Array.isArray(tdk)) for (const kf of tdk) if (kf && typeof kf.t === 'number') kf.t += delta;
      }
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(data.layers);
}

/* ---------- 动画注册表 ----------
 * 「新增一套动画」只需要在 ANIMATIONS 里加一项,顶栏触发器 / 选择画廊 / 侧栏能力开关
 * 全部由这一项的字段驱动,不需要再去 switchAnimation 里补分支。
 *
 * 字段分四组:
 *  1) 身份:key(唯一标识,也是隐藏 select 的 value)、label(中文全名);
 *  2) 元信息 meta:画廊卡片在「不下载数据」的前提下要显示的全部内容(规格 + 特性标签 + 搜索词)——
 *     一旦按需加载改成首屏就拉全部数据,这些信息都要等下载完才能显示,所以必须是静态声明;
 *     真实数据载入后会用实测值覆盖(见 animMetaOf),因此尺寸/帧率只要求「大致准确」;
 *  3) 数据:data()/popup() 以 getter 形式提供(bootAnimation/animation2Data 在启动时可能尚未就绪)、
 *     audioUrl 为 null 表示没有音效(任务弹窗动画即是,导出时不挂音轨、预览也不播声音)、
 *     loaded() 判断数据是否已在内存、load(onProgress) 负责首次下载;
 *  4) caps 能力开关:侧栏哪些区块对这套动画开放(见 AnimCaps)。 */
type AnimCaps = {
  /** 「动画时长」区块(时长滑杆;配合 nextScan 时还有二次扫描开关与时长) */
  timing?: boolean;
  /** 「二次扫描」开关(第二段合并进同一条时间轴) */
  nextScan?: boolean;
  /** 首次载入时套用的默认时长(秒),不写则不压缩 */
  defaultDuration?: number;
};
type AnimMeta = {
  /** 搜索关键词(名称之外还能被搜到的词:别名、英文 key、内容关键词) */
  tags: string[];
  /** 封面兜底主色:没有预览图时卡片用它生成渐变,保证列表永远好看且可区分 */
  accent: string;
  /* 画布尺寸 / 帧率 / 总帧数:卡片信息条用;载入后会被实测值覆盖 */
  w: number; h: number; fps: number; frames: number;
  /** 卡片底部的特性标签(只显示前 2 个,再多会把卡片撑高) */
  features: string[];
};
type AnimDef = {
  key: string;
  label: string;
  meta: AnimMeta;
  /** 预览图 URL(打包资源);空串时卡片用 accent 渐变兜底 */
  poster: string;
  data: () => any;
  popup: () => any;
  audioUrl: string | null;
  loaded: () => boolean;
  load: (onProgress?: (p: number | null) => void) => Promise<void>;
  caps: AnimCaps;
};

/* 预览图:posters/<key>.(webp|png|jpg),由 tools/build-anim-posters.mjs 从真实渲染里截取。
 * 用 import.meta.glob + ?url 而不是写死路径 —— 缺图时不会构建失败,卡片自动退回渐变封面;
 * 新增动画只要把预览图丢进 posters/ 并跑一次脚本即可。 */
const POSTER_MODULES = import.meta.glob('../posters/*.{webp,png,jpg}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
function posterOf(key: string): string {
  for (const [path, url] of Object.entries(POSTER_MODULES)) {
    const base = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    if (base === key) return url;
  }
  return '';
}

const ANIMATIONS: AnimDef[] = [
  {
    key: 'extraction',
    label: '撤离动画',
    meta: {
      tags: ['撤离', '结算', '撤离成功', '弹窗', 'extraction'],
      accent: '#3b82f6',
      w: 1920, h: 1080, fps: 60, frames: 609,
      features: ['弹窗叠加', '文字可编辑'],
    },
    poster: posterOf('extraction'),
    data: () => bootAnimation,
    popup: () => popupData,
    audioUrl: bundledAudioUrl,
    loaded: () => !!bootAnimation && !!popupData,
    load: (p) => ensureExtractionData(p),
    caps: {},
  },
  {
    key: 'exposed',
    label: '位置暴露动画',
    meta: {
      tags: ['位置暴露', '扫描', '二次扫描', '技能', '图标', 'exposed'],
      accent: '#22c55e',
      w: 3840, h: 1080, fps: 60, frames: 601,
      features: ['二次扫描', '图标可换', '时长可调'],
    },
    poster: posterOf('exposed'),
    data: () => animation2Data,
    popup: () => null,
    audioUrl: exposedAudioUrl,
    loaded: () => !!animation2Data && !!animation2NextData,
    load: (p) => ensureExposedData(p),
    caps: { timing: true, nextScan: true, defaultDuration: 1.25 },
  },
  {
    key: 'blinds',
    label: '核电站功率动画',
    meta: {
      tags: ['核电站', '功率', '反应堆', '百叶窗', '序列', 'blinds'],
      accent: '#f59e0b',
      w: 1920, h: 1080, fps: 60, frames: 359,
      features: ['PNG 序列', '数字位联动'],
    },
    poster: posterOf('blinds'),
    data: () => blindsData,
    popup: () => null,
    audioUrl: blindsAudioUrl,
    loaded: () => !!blindsData,
    load: (p) => ensureBlindsData(p),
    caps: {},
  },
  {
    key: 'mission',
    label: '任务弹窗动画',
    meta: {
      tags: ['任务', '弹窗', '报酬', '哈夫币', 'mission'],
      accent: '#a855f7',
      w: 1920, h: 1080, fps: 60, frames: 214,
      features: ['图标可换', '文字可改'],
    },
    poster: posterOf('mission'),
    data: () => missionData,
    popup: () => null,
    audioUrl: null,
    loaded: () => !!missionData,
    load: (p) => ensureMissionData(p),
    caps: {},
  },
  {
    key: 'maptitle',
    label: '地图标题动画',
    meta: {
      tags: ['地图', '地点', '地名', '标题', '位置', '坐标', 'maptitle'],
      accent: '#14b8a6',
      w: 2560, h: 1024, fps: 60, frames: 327,
      features: ['文字可编辑', '底框随文字自适应'],
    },
    poster: posterOf('maptitle'),
    data: () => mapTitleData,
    popup: () => null,
    audioUrl: null,
    loaded: () => !!mapTitleData,
    load: (p) => ensureMapTitleData(p),
    caps: {},
  },
  {
    key: 'blast',
    label: '黑潮爆破默认弹窗动画',
    meta: {
      tags: ['黑潮', '爆破', '黑潮爆破', '弹窗', '默认弹窗', '提示', '爆破提示', 'blasting', 'blast'],
      accent: '#1bb8c4',
      w: 1920, h: 1080, fps: 60, frames: 600,
      features: ['文字可编辑', '图片可调色'],
    },
    poster: posterOf('blast'),
    data: () => blastData,
    popup: () => null,
    audioUrl: null,
    loaded: () => !!blastData,
    load: (p) => ensureBlastData(p),
    /* caps 全空:**侧栏不出现「动画时长」区块**,也就没有任何改时长/改关键帧的入口 ——
     * 这套动画的画面与时间轴完全按 AE 导出原样呈现(600 帧 / 10s)。
     * 之所以连滑杆都不要:改时长的实现(applyMainDuration)是**把各图层末尾那段淡出关键帧整体搬到新的出点**,
     * 对这套动画就等于改数据 —— 提示条 image_1 的 192→216 淡出、图标 image_3 的 114→145 淡出都会被搬走,
     * 侧栏里的透明度关键帧就和 AE 对不上了。
     * 同理也**不要**加 nextScan:这是单段弹窗动画,没有第二段可接。
     * 日后若确实需要给用户改时长的能力,把 timing: true 加回来即可(区块会自动出现,无需改别的代码)。 */
    caps: {},
  },
];
let currentAnimKey = 'extraction';
/* 当前动画的注册项。所有「按 key 走特殊逻辑」的地方都改成查这张表,
 * 新增动画时漏配字段的后果只是某个区块不显示,而不是抛错。 */
function animDef(key: string = currentAnimKey): AnimDef | undefined {
  return ANIMATIONS.find((a) => a.key === key);
}

/* ---------- 二次扫描开关状态 ---------- */
let showNextScan = false; // 是否显示二次扫描(主动画后紧接着播第二段)
let nextDuration = 3.2; // 第二段时长(秒,默认 3.2s)

/* ---------- 图标选择(位置暴露 / 任务弹窗动画) ----------
 * 位置暴露动画两段的图标各自是一个独立图片资源,因此可以分别指定:
 *   • 位置暴露(主段):animation2Data 的 image_0(图层 ind 5,恒存在);
 *   • 二次扫描(第二段):animation2NextData 的 image_0 —— 该段被 mergeNextInto/
 *     prepareNextData 合并时会整体重命名为 image_0_n(图层 ind 105),所以合并后的
 *     数据里要写 image_0_n,而原始第二段数据里要写 image_0。
 * 每段都同时写入「源数据」与「当前(可能已合并)数据」,这样开启/关闭「二次扫描」来回
 * 切换、以及重新合并时都不会退回内置 PNG。
 *
 * 任务弹窗动画只有一个图标位(数据里唯一的那张位图图层,资源 id 为 image_0),
 * 因此它没有选项卡与「跟随」开关,选中项记在 iconMissionName 里;两套动画的图标选择互不影响。 */
type IconScope = 'main' | 'next';
let iconScope: IconScope = 'main'; // 当前选项卡:正在为哪一段挑图标
let iconMainName = DEFAULT_ICON_NAME; // 位置暴露图标
let iconNextName = DEFAULT_ICON_NAME; // 二次扫描图标(默认与位置暴露相同)
let followMainIcon = true; // 二次扫描是否跟随位置暴露(默认跟随,与旧版「两段共用图标」一致)
let customIcons: { name: string; url: string }[] = []; // 用户上传的自定义图标(会话内有效)
/* 任务弹窗动画的内置图标:就是动画自带的哈夫币位图(animations/animation_4/images/MallIcon_HafuCoins.png)。
 * 名字沿用资源文件名,列表里显示为「MallIcon_HafuCoins」(iconDisplayName 会去掉扩展名)。 */
const MISSION_ICON_OPTION = { name: 'MallIcon_HafuCoins.png', url: missionIconUrl };
/* animations/animation_4/icon/ 下的图标列表(按名称自然序);同名时优先 WebP(与 animations/animation_2/icon 同规则)。
 * 目录为空时只有下面这一项回落项,保证列表永远非空、默认图标永远可选。 */
const MISSION_ICON_OPTIONS: { name: string; url: string }[] = (() => {
  const byBase = new Map<string, { name: string; url: string }>();
  for (const [path, url] of Object.entries(missionIconModules)) {
    const name = path.split('/').pop() ?? '';
    const base = name.replace(/\.[^.]+$/, '');
    const prev = byBase.get(base);
    const isWebp = /\.webp$/i.test(name);
    if (prev && !(isWebp && !/\.webp$/i.test(prev.name))) continue;
    byBase.set(base, { name, url });
  }
  const list = [...byBase.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return list.length ? list : [MISSION_ICON_OPTION];
})();
/* 默认图标:优先 icon/ 目录里同名的 HafuCoins(素材就放在那儿),否则用目录首项。
 * 目录里那份与动画自带的 images/ 版视觉一致(仅编码差异),所以默认画面不变。 */
const MISSION_ICON_DEFAULT_NAME =
  MISSION_ICON_OPTIONS.find((o) => o.name.replace(/\.[^.]+$/, '') === 'MallIcon_HafuCoins')?.name ??
  MISSION_ICON_OPTIONS[0]?.name ??
  MISSION_ICON_OPTION.name;
let iconMissionName = MISSION_ICON_DEFAULT_NAME; // 任务弹窗动画当前选用的图标

/* 定位当前动画的「图标图层」——用于判断该动画有没有图标位、以及不透明度滑块该挂在哪一层上。
 *   • 位置暴露:按图层名「图标_可替换」找(数据里就是这个名字,主段 ind 5 / 二次扫描 ind 105);
 *   • 任务弹窗:数据里唯一的那张位图图层(叠加序列图层不算,它们逐帧换图,没有单一资源)。
 * 其它动画(撤离 / 核电站功率)没有图标位,返回 null,「图标选择」区块整块隐藏。 */
function iconLayerOf(data: any, key: string = currentAnimKey): any | null {
  const layers: any[] = data?.layers ?? [];
  if (key === 'mission') return layers.find((l: any) => l.ty === 2 && !isSeqLayer(l)) ?? null;
  if (key === 'exposed') return layers.find((l: any) => l.ty === 2 && l.nm === '图标_可替换') ?? null;
  return null;
}

/* 「显示图标」开关只对位置暴露动画有意义(它同时要挪文字与底框,见 setIconVisible);
 * 其余动画的图标显隐走「图标不透明度」滑块,不能套用这套位移逻辑。 */
function iconToggleApplies(key: string = currentAnimKey): boolean {
  return key === 'exposed';
}

/* ---------- 图标显示开关 ----------
 * 「显示图标」开关(默认勾选):取消后主段与二次扫描段的图标图层透明度动画
 * 置 0(隐藏),文字 p.x 置 1920(3840×1080 画布中心,两段一致);恢复勾选时还原原值。注意:图标隐藏不能只设静态 ks.o=0(lottie 对静态
 * 透明度不应用,图层仍会渲染),必须用动画关键帧 {a:1,k:[{t:0,s:[0]}]}。
 * 图标显示状态下加载数据时捕获原值;隐藏状态下重建动画(切换/改文字等)时
 * 保留上次捕获的原值,保证恢复后与原始一致。 */
let buildSerial = 0; // 动画重建序号:并发/连发重建时只让最新一次恢复画面与播放状态
let iconVisible = true; // 「显示图标」开关状态(默认显示)
const iconOpacityOriginal = new Map<number, { a: number; k: any }>(); // 图标层 ind → 原 ks.o
const textPosXOriginal = new Map<number, number>(); // 文字层 ind → 原 p.x
/* 隐藏图标时底框整组随文字回中:位置暴露动画画布已加宽为 3840×1080,数据整体
 * 平移 +930(可见态内容实测中心 990 → 1920)。文字 p.x 置 1920 后,主段的底框/
 * 两侧竖条等组件仍停留在“图标+文字”布局处(静止帧实测中心 1925.5,即旧 995.5+930),
 * 文字相对底框偏左约 34 合成单位。这里把主段父级「空 2」(ind 3)整体左移 -34.3,
 * 使底框中心与文字中心(≈1921)重合,底框左右留白对称、观感居中;恢复图标时还原。
 * 二次扫描段(ind 103)的底框本身就以 1920 为中心,无需偏移。数值按当前内置动画
 * JSON(3840×1080)静止帧实测换算,若更换/重导出动画数据导致底框基准位置变化,
 * 需要重新标定。 */
const PLATE_PARENT_X_SHIFT = new Map<number, number>([[3, -34.3]]); // 空 2 ind → 隐藏时左移量(合成单位)
const plateParentXOriginal = new Map<number, number>(); // 空 2 ind → 原 p.x
/* 隐藏图标居中微调:不同字体/文字内容的字形存在固有光学偏差(墨迹/笔画分布不
 * 完全对称),纯数值很难替人眼定“正中”。提供 ±px 手动微调,叠加在 1920 上,
 * 只影响「显示图标」未勾选时的文字与其跟随的底框;SVG/Canvas、预览/导出一致。 */
let iconCenterNudge = 0; // 合成单位,正值右移;0 = 关闭微调
let nudgeRebuildTimer: number | undefined; // 连点微调防抖(220ms):一次快速连点只合并成一次重建
/* 居中微调（合成单位 px，范围 ±8）：只影响「显示图标」未勾选时的文字及其跟随的底框。
 * 图标仍显示时微调值照样记录，但不重建（对显示态无影响）；
 * 连点走 220ms 防抖合并成一次重建，配合单飞队列不会出现交错重建。 */
function changeIconNudge(delta: number) {
  iconCenterNudge = Math.max(-8, Math.min(8, iconCenterNudge + delta));
  const v = document.getElementById('iconNudgeVal');
  if (v) v.textContent = (iconCenterNudge > 0 ? '+' : '') + iconCenterNudge + ' px';
  if (!chkIcon.checked) {
    // 已隐藏 → 重定位(含整段重渲染)。快速连点统一推迟到停手后再重建一次(配合单飞队列,
    // 任意点击速度都不会交错重建)。
    window.clearTimeout(nudgeRebuildTimer);
    nudgeRebuildTimer = window.setTimeout(() => setIconVisible(false), 220);
  }
}
/* 画面中心取 p.x=1920 而不做额外偏移(此前按“锚点偏移 −anchorX×缩放”≈1.18
 * 与“固定 18.43”均实测偏左):本字体 ProjectD Type 字形墨迹在其字格内略偏左
 * (约 0.5 字格 ≈ 1.5 合成单位),按字格中心/锚点校正反而让墨迹视觉中心落在
 * 1918.4 附近(观感偏左)。逐字形墨迹实测:p.x=1920 时主段「位置暴露」墨迹中心
 * 1919.6、二次扫描「即将扫描移动单位」1920.2,观感最居中;SVG 与 Canvas 一致。 */
/* 捕获「显示图标」状态下的原始值（图标层 ks.o、文字层 p.x、底框父级 p.x）。
 * 只在图标显示时捕获：隐藏状态下的重建若也捕获，会把「隐藏后的值」当成原值存下来，
 * 之后再勾选「显示图标」就还原不回原始布局了。 */
function captureIconState() {
  if (!chkIcon.checked) return; // 仅图标显示时记录原始状态,隐藏时保留上次记录
  iconOpacityOriginal.clear();
  textPosXOriginal.clear();
  plateParentXOriginal.clear();
  if (!currentData) return;
  /* 图层 ind 约定（内置位置暴露数据）：主段 = 文字 4 / 图标 5；
   * 二次扫描段合并时整体 +100 → 文字 104 / 图标 105。因此按是否已合并决定要改哪些图层。 */
  const iconInds = [5];
  const textInds = [4];
  if (isMergedNext(currentData)) {
    iconInds.push(105);
    textInds.push(104);
  }
  for (const ind of iconInds) {
    const layer = findLayerByInd(currentData.layers, ind);
    const o = layer?.ks?.o;
    if (o) iconOpacityOriginal.set(ind, { a: o.a, k: JSON.parse(JSON.stringify(o.k)) });
  }
  for (const ind of textInds) {
    const layer = findLayerByInd(currentData.layers, ind);
    const p = layer?.ks?.p;
    if (p && p.a === 0 && Array.isArray(p.k)) textPosXOriginal.set(ind, p.k[0]);
  }
  for (const ind of PLATE_PARENT_X_SHIFT.keys()) {
    const layer = findLayerByInd(currentData.layers, ind);
    const p = layer?.ks?.p;
    if (p && p.a === 0 && Array.isArray(p.k)) plateParentXOriginal.set(ind, p.k[0]);
  }
}

/* 切换「显示图标」：隐藏时把图标层透明度改成动画关键帧、把文字及其底框父级移到画布中心；
 * 恢复时写回 captureIconState 捕获的原值（而非就地增减，重复调用不会累积偏移）。
 * rerender=false 用于「批量改完数据再统一重建」的场景，避免重建多次。 */
function setIconVisible(visible: boolean, rerender = true) {
  iconVisible = visible;
  // 居中微调组件仅在取消显示图标(图标隐藏)后出现;恢复显示图标时收回
  iconNudgeRow.hidden = iconVisible;
  if (!currentData) return;
  const iconInds = [5];
  const textInds = [4];
  if (isMergedNext(currentData)) {
    iconInds.push(105);
    textInds.push(104);
  }
  for (const ind of iconInds) {
    const layer = findLayerByInd(currentData.layers, ind);
    const o = layer?.ks?.o;
    if (!o) continue;
    if (visible) {
      const orig = iconOpacityOriginal.get(ind);
      if (orig) {
        o.a = orig.a;
        o.k = JSON.parse(JSON.stringify(orig.k));
      }
    } else {
      o.a = 1;
      o.k = [{ t: 0, s: [0] }];
    }
  }
  for (const ind of textInds) {
    const layer = findLayerByInd(currentData.layers, ind);
    const p = layer?.ks?.p;
    if (!(p && p.a === 0 && Array.isArray(p.k))) continue;
    if (visible) {
      const orig = textPosXOriginal.get(ind);
      if (orig !== undefined) p.k[0] = orig;
    } else {
      // 画面中心:1920(3840 宽画布)+ 手动微调(见 iconCenterNudge 注释)。
      p.k[0] = 1920 + iconCenterNudge;
    }
  }
  // 底框整组随文字回中:从捕获的原值按偏移量取绝对值,重复触发(隐藏状态下重建等)
  // 不会累积偏移。
  for (const [ind, shift] of PLATE_PARENT_X_SHIFT) {
    const layer = findLayerByInd(currentData.layers, ind);
    const p = layer?.ks?.p;
    if (!(p && p.a === 0 && Array.isArray(p.k))) continue;
    const orig = plateParentXOriginal.get(ind);
    if (orig === undefined) continue;
    p.k[0] = visible ? orig : orig + shift + iconCenterNudge;
  }
  if (rerender) reRenderPreservingState();
}

chkIcon.addEventListener('change', () => setIconVisible(chkIcon.checked));
/* 「报酬信息」统一开关(仅任务弹窗动画):勾选/取消后重建动画(数据里的 hd 已改) */
chkMissionReward.addEventListener('change', () => setMissionRewardVisible(chkMissionReward.checked));

/* 「图标不透明度」滑块(任务弹窗动画):复用图片/文字/形状列表那套 .o-slider 处理,
 * 只把根节点换成图标区块 —— 滑块是静态 DOM,模块加载时绑定一次即可,不会重复挂监听。 */
bindOpacitySliders(iconOpacityRow);

/* 居中微调按钮:±1px(合成单位),重置归零 */
document.getElementById('btnNudgeL')?.addEventListener('click', () => changeIconNudge(-1));
document.getElementById('btnNudgeR')?.addEventListener('click', () => changeIconNudge(1));
document.getElementById('btnNudgeReset')?.addEventListener('click', () => changeIconNudge(-iconCenterNudge));
// 初始化微调数值的显示（模块加载时同步一次，否则面板会显示为空）
{
  const v = document.getElementById('iconNudgeVal');
  if (v) v.textContent = iconCenterNudge + ' px';
}

/* 内置图标素材按动画区分:
 *  • 位置暴露动画用 animations/animation_2/icon 下的干员技能图标(ICON_OPTIONS);
 *  • 任务弹窗动画用动画自带的哈夫币图标(排在最前),后接同一套技能图标,方便换用其它图标。
 * 用户上传的自定义图标对两套动画都可见,排在前面便于一眼看到自己加的那张。 */
function builtinIconOptions(): { name: string; url: string }[] {
  // 任务弹窗动画用 animations/animation_4/icon/ 的图标;位置暴露动画用 animations/animation_2/icon/ 的干员技能图标
  return currentAnimKey === 'mission' ? MISSION_ICON_OPTIONS : ICON_OPTIONS;
}
function allIconOptions() {
  return [...customIcons, ...builtinIconOptions()];
}

/* 图标显示名:去掉扩展名(Hero_Sp_03.webp → Hero_Sp_03) */
function iconDisplayName(name: string) {
  return name.replace(/\.(png|jpe?g|webp|gif)$/i, '');
}

function findIconOption(name: string) {
  return allIconOptions().find((o) => o.name === name);
}

/* 某段实际生效的图标名:二次扫描在「跟随位置暴露」时取位置暴露的值;
 * 任务弹窗动画与分段无关,恒取它自己的选择。 */
function effectiveIconName(scope: IconScope): string {
  if (currentAnimKey === 'mission') return iconMissionName;
  if (scope === 'main') return iconMainName;
  return followMainIcon ? iconMainName : iconNextName;
}

function effectiveIconUrl(scope: IconScope) {
  return findIconOption(effectiveIconName(scope))?.url ?? '';
}

/* 把某条资源指向打包后的 url：必须同时把 u 置空、e 置 1，lottie 才会把 p 当成完整地址；
 * 否则它会按 u+p 去拼路径，或把 data URI 再当 base64 解码一次。
 * 返回是否命中资源 —— 资源 id 不存在时调用方需要知道这次改写没生效。 */
function setAssetImageUrl(data: any, id: string, url: string): boolean {
  const asset = (data?.assets ?? []).find((a: any) => a.id === id);
  if (!asset) return false;
  asset.p = url;
  asset.u = '';
  asset.e = 1;
  return true;
}

/* 把某段选定的图标写入该段的所有相关数据对象。
 * 只认「位置暴露动画」的两个数据对象:切换动画的瞬间 currentData 可能仍是撤离动画,
 * 而它的资源 id 也叫 image_0,误写会改坏撤离动画的图标。合并后的数据与 animation2Data
 * 是同一个对象(见 chkNextScan / switchAnimation),因此写它就等于写 currentData。 */
/* 返回是否有资源被实际改写（调用方据此决定要不要重建动画）。 */
function applyIconUrlToScope(scope: IconScope, url: string): boolean {
  if (!url) return false;
  let updated = false;
  // 任务弹窗动画只有一个图标位:写到它自己数据里那张位图图层引用的资源上
  if (currentAnimKey === 'mission') {
    const layer = iconLayerOf(missionData, 'mission');
    if (layer?.refId && setAssetImageUrl(missionData, layer.refId, url)) updated = true;
    return updated;
  }
  if (scope === 'main') {
    // 位置暴露(主段):资源恒为 image_0。注意不能顺带写 image_0_n ——那是第二段的资源
    if (setAssetImageUrl(animation2Data, 'image_0', url)) updated = true;
  } else {
    // 二次扫描:源数据(未合并)里叫 image_0,合并后被 prepareNextData 重命名为 image_0_n。
    // 两者是各自独立的资源,必须分别写;绝不能写 animation2Data.image_0(那是一次的图标)
    if (setAssetImageUrl(animation2NextData, 'image_0', url)) updated = true;
    if (setAssetImageUrl(animation2Data, 'image_0_n', url)) updated = true;
  }
  return updated;
}

/* 按当前状态刷新两段图标资源。两段都写:即便处于「跟随」状态,二次扫描资源也要对齐,
 * 否则取消跟随、或关闭再开启二次扫描时第二段会退回内置 PNG。 */
function applyIconsToData(): boolean {
  // 任务弹窗动画只有一个图标位,写一次即可
  if (currentAnimKey === 'mission') return applyIconUrlToScope('main', effectiveIconUrl('main'));
  let updated = false;
  if (applyIconUrlToScope('main', effectiveIconUrl('main'))) updated = true;
  if (applyIconUrlToScope('next', effectiveIconUrl('next'))) updated = true;
  return updated;
}

/* 选中某段的图标。在「二次扫描」页点选图标即视为单独指定,自动取消「跟随位置暴露」 */
function setIconForScope(scope: IconScope, name: string) {
  if (!findIconOption(name)) return;
  if (currentAnimKey === 'mission') {
    iconMissionName = name;
  } else if (scope === 'main') {
    iconMainName = name;
    if (followMainIcon) iconNextName = name; // 跟随中:顺带记录,取消跟随后仍显示同一图标
  } else {
    iconNextName = name;
    if (followMainIcon) {
      followMainIcon = false; // 为二次扫描单独指定 → 不再跟随
      chkFollowMainIcon.checked = false;
    }
  }
  applyIconsToData();
  syncIconScopeUI();
  reRenderPreservingState();
}

/* 切换图标选项卡（位置暴露 / 二次扫描）：只刷新 UI，不改数据也不重建动画 */
function setIconScope(scope: IconScope) {
  if (iconScope === scope) return;
  iconScope = scope;
  syncIconScopeUI();
}

/* 同步「图标不透明度」行(仅任务弹窗动画):图标是普通位图图层,滑块直接改它的图层不透明度。
 * data-ind 每次按当前图层重写 —— 滑块是静态 DOM(不随列表重建),靠它把两次载入区分开;
 * .o-slider 的输入处理由 bindOpacitySliders 统一绑定(模块加载时绑一次即可)。 */
function syncIconOpacityRow(data: any = currentData) {
  // 只对任务弹窗动画生效:位置暴露动画的位图图层(百叶窗.png 等)走「图片图层」列表,
  // 不能凭「数据里有位图图层」就把这一行显示出来。
  if (currentAnimKey !== 'mission') {
    iconOpacityRow.hidden = true;
    return;
  }
  const layer = iconLayerOf(data, 'mission');
  iconOpacityRow.hidden = !layer;
  if (!layer) return;
  const v = getLayerOpacity(layer);
  iconOpacitySlider.dataset.ind = String(layer.ind);
  iconOpacitySlider.value = String(v);
  iconOpacityVal.textContent = v + '%';
}

/* ---------- 任务弹窗动画:「报酬信息」统一显隐 ----------
 * 「预期报酬」「数字」与货币图标在画面上是同一条报酬文案(文字 + 金额 + 币种图标),
 * 这里把它们当成一组,用一个开关统一显隐。
 *
 * 为什么用图层的 hd(隐藏)标记,而不是像位置暴露动画的 setIconVisible 那样把不透明度压成 0:
 *   • 这三个图层在侧栏各有**独立的不透明度滑块**(两个文字层在「文字图层」列表、图标在「图标不透明度」),
 *     靠改不透明度来隐藏,用户一碰滑块就会把隐藏状态冲掉;
 *   • 隐藏前用户调好的不透明度也会被覆盖 —— hd 则完全不动 o,重新勾选即原样恢复;
 *   • hd 只在 lottie 构建时跳过该图层(buildItem),其余字段一个不碰,风险最小。
 * 侧栏各列表的遍历(walkEditableLayers)不过滤 hd,所以隐藏后三者仍留在列表里,
 * 文案 / 颜色 / 不透明度都照常可编辑,只是画面不显示 —— 这正是「设置都保留」的含义。 */
const MISSION_REWARD_TEXT_NAMES = ['预期报酬', '数字'];
/* 当前是否显示(默认显示)。存在模块级而不是挂在数据上:切换动画时数据对象会保留,
 * 但重新勾选/取消时要以这个为准,避免「数据里没 hd 但开关是关的」这种不一致。 */
let missionRewardShown = true;

/* 收集这一组的三个图层:两个按名字找的文字层 + 任务弹窗动画唯一的那张位图(图标层)。
 * 用名字而不是写死 ind:重新导出后 ind 可能变,名字是稳定的。 */
function missionRewardLayers(data: any = currentData): any[] {
  if (!data) return [];
  const out: any[] = [];
  for (const nm of MISSION_REWARD_TEXT_NAMES) {
    const l = (data.layers ?? []).find((x: any) => x.nm === nm);
    if (l) out.push(l);
  }
  const icon = iconLayerOf(data, 'mission');
  if (icon) out.push(icon);
  return out;
}

/* 应用显隐。rerender=false 用于「批量改完数据再统一重建」的场景(如 switchAnimation 里
 * 在 loadData 之前先把状态落实,避免重建两次)。 */
function setMissionRewardVisible(visible: boolean, rerender = true) {
  missionRewardShown = visible;
  if (currentData && currentAnimKey === 'mission') {
    for (const l of missionRewardLayers()) {
      if (visible) delete l.hd;
      else l.hd = true;
    }
  }
  if (rerender) reRenderPreservingState();
}

/* 同步选项卡 / 缩略图 / 跟随开关 / 二次扫描提示,并重绘图标网格。
 * data 可显式传入「正在载入的数据」,避免切换动画瞬间用旧数据判断二次扫描是否已开启。 */
function syncIconScopeUI(data: any = currentData) {
  /* 位置暴露动画有两个图标位(选项卡 + 跟随开关),任务弹窗动画只有一个:UI 按当前动画整体切换。
   * 「显示图标」开关与居中微调只服务于位置暴露(隐藏图标要连带挪文字与底框),对其余动画隐藏。 */
  const multiScope = iconToggleApplies();
  iconToggleRow.hidden = !multiScope;
  iconScopeTabs.hidden = !multiScope;
  iconScopeHint.hidden = true;
  if (!multiScope) {
    iconFollowRow.hidden = true;
    iconNudgeRow.hidden = true;
    /* 注意:这里不动 chkIcon 的勾选状态。「显示图标」是位置暴露动画自己的设置,取消勾选后
     * 数据会被就地改成「图标透明 + 文字回中」;若在别的动画里把它重置成勾选态,切回位置暴露时
     * loadData 就不会再应用隐藏(见那里的 iconToggleApplies 判断),数据和开关就会对不上。
     * 保持原样即可:这个开关对其它动画不显示、也不生效。 */
  }
  const isNext = iconScope === 'next';
  iconScopeMain.classList.toggle('is-active', !isNext);
  iconScopeNext.classList.toggle('is-active', isNext);
  iconScopeMain.setAttribute('aria-selected', String(!isNext));
  iconScopeNext.setAttribute('aria-selected', String(isNext));
  if (multiScope) iconFollowRow.hidden = !isNext;
  chkFollowMainIcon.checked = followMainIcon;
  // 缩略图与名称就地更新：src 相同时不重复赋值，避免浏览器重新加载同一张图造成闪烁
  const setPick = (thumb: HTMLImageElement, label: HTMLElement, name: string) => {
    const opt = findIconOption(name);
    if (!opt) return;
    if (thumb.getAttribute('src') !== opt.url) thumb.src = opt.url;
    label.textContent = iconDisplayName(opt.name);
  };
  setPick(iconScopeThumbMain, iconScopeNameMain, effectiveIconName('main'));
  setPick(iconScopeThumbNext, iconScopeNameNext, effectiveIconName('next'));
  // 二次扫描尚未开启(数据未合并)时给出提示:设置会保留,开启后自动生效
  const nextReady = isMergedNext(data);
  if (multiScope && isNext && !nextReady) {
    iconScopeHint.hidden = false;
    iconScopeHint.textContent = '二次扫描尚未开启:这里的选择会保留,在上方「动画时长 → 二次扫描」勾选后自动生效。';
  }
  syncIconOpacityRow(data);
  renderIconList();
}

// 重绘图标网格:列表随动画切换(位置暴露=技能图标;任务弹窗=哈夫币图标+技能图标),当前生效项标 is-active。
// 用 innerHTML 整体重建而不是局部 diff —— 条目数量级很小(内置 + 用户上传),重建成本可忽略。
function renderIconList() {
  const opts = allIconOptions();
  const activeName = effectiveIconName(iconScope);
  const following = currentAnimKey !== 'mission' && iconScope === 'next' && followMainIcon;
  iconCount.textContent = '· ' + opts.length + ' 个' + (following ? ' · 跟随位置暴露' : '');
  iconList.innerHTML = opts
    .map(
      (opt) =>
        '<li class="icon-item' + (opt.name === activeName ? ' is-active' : '') + '" data-name="' + esc(opt.name) + '">' +
        '<img class="icon-thumb" src="' + opt.url + '" alt="' + esc(opt.name) + '" loading="lazy" />' +
        '<span class="icon-name">' + esc(iconDisplayName(opt.name)) + '</span>' +
        '</li>'
    )
    .join('');
  iconList.querySelectorAll<HTMLLIElement>('.icon-item').forEach((li) => {
    li.addEventListener('click', () => {
      const name = li.dataset.name;
      if (!name) return;
      // 二次扫描页在「跟随」状态下点中同一个图标也要落成单独指定(用户意图是固定下来);
      // 任务弹窗动画没有「跟随」概念,点中当前生效的那一项直接忽略。
      const alreadyActive = name === effectiveIconName(iconScope);
      const landingOnFollow = iconToggleApplies() && iconScope === 'next' && followMainIcon;
      if (alreadyActive && !landingOnFollow) return;
      setIconForScope(iconScope, name);
    });
  });
}

// 两个选项卡只切换 iconScope;缩略图、跟随开关、提示与列表统一由 syncIconScopeUI 刷新
iconScopeMain.addEventListener('click', () => setIconScope('main'));
iconScopeNext.addEventListener('click', () => setIconScope('next'));

/* 「二次扫描跟随位置暴露」开关:勾选后第二段立即改回与位置暴露相同 */
chkFollowMainIcon.addEventListener('change', () => {
  followMainIcon = chkFollowMainIcon.checked;
  if (followMainIcon) iconNextName = iconMainName;
  applyIconsToData();
  syncIconScopeUI();
  reRenderPreservingState();
  setStatus(followMainIcon ? '二次扫描图标已改为跟随位置暴露' : '二次扫描图标已独立:可单独选择或上传');
});

/* 用户上传自定义图标:读取为 data URL,加入列表并应用到当前选项卡对应的段 */
iconFile.addEventListener('change', () => {
  const file = iconFile.files?.[0];
  iconFile.value = ''; // 允许重复选择同一文件
  if (!file) return;
  // 上限 2MB:上传的图标会以 data URL 形式写进动画数据(每次应用、每次导出都要重新解析),
  // 存成 base64 还会比原文件大约 1/3,过大既拖慢渲染也让导出产物变重
  if (file.size > 2 * 1024 * 1024) {
    setStatus('图标过大:请上传 ≤2MB 的图片', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result ?? '');
    if (!url.startsWith('data:image/')) {
      setStatus('不支持的文件类型', true);
      return;
    }
    const base = iconDisplayName(file.name) || '自定义图标';
    // 显示名去重(与内置/已上传图标同名时追加序号),避免列表里出现两个同名项
    const taken = new Set(allIconOptions().map((o) => iconDisplayName(o.name)));
    let name = base;
    let n = 2;
    while (taken.has(iconDisplayName(name))) name = base + ' (' + n++ + ')';
    customIcons.unshift({ name, url });
    setIconForScope(iconScope, name);
    const where = currentAnimKey === 'mission' ? '任务弹窗动画' : iconScope === 'next' ? '二次扫描' : '位置暴露';
    setStatus('已应用自定义图标「' + iconDisplayName(name) + '」到' + where);
  };
  reader.onerror = () => setStatus('读取图片失败', true);
  reader.readAsDataURL(file);
});

/* 切换动画。
 * 数据包按需加载:仅首次进入该动画时才下载,期间显示加载浮层与实时进度,结束后关闭。
 * 加载方式完全来自注册项的 load()/loaded(),这里不再按 key 分支 —— 新增动画不需要动本函数。
 * 弹窗数据随动画一起换,并强制关闭弹窗、隐藏无关区块(弹窗 / 图片调色 / 图标 / 时长)。
 * 载入前先把「图标、图片调色」等用户设置写回数据,保证随后 loadData 构建出的动画直接用对资源。 */
async function switchAnimation(key: string) {
  const def = animDef(key);
  if (!def) return;
  // 数据按需加载:仅首次进入该动画时才动态下载其数据包(已加载则直接复用)。
  // 需要真正下载时显示加载浮层与实时进度条,完成后关闭。
  if (!def.loaded()) showDataLoading(def.label);
  try {
    await def.load((p) => setDataLoadingProgress(p));
  } finally {
    hideDataLoading();
  }
  if (!def.data()) return;
  currentAnimKey = key;
  // 记录「最近使用」并按实测数据校准卡片规格(都只影响选择器的展示)
  noteAnimUsed(key);
  measureAnim(def);
  // 弹窗数据随动画切换;切换后默认关闭弹窗
  popupData = def.popup();
  popupVisible = false;
  chkPopup.checked = false;
  destroyPopupAnim();
  popupLayer.hidden = true;
  const popupSection = document.getElementById('popupSection');
  if (popupSection) popupSection.hidden = !def.popup();
  if (def.popup()) {
    capturePopupOriginalState();
    renderPopupLists();
  } else {
    popupCount.textContent = '';
    popupTextCount.textContent = '';
    popupShapeCount.textContent = '';
    popupTextList.innerHTML = '';
    popupShapeList.innerHTML = '';
  }
  /* 当前动画的「可编辑数据」:注册项的 data() 本身就是内存里的那份引用
   * (位置暴露返回的 animation2Data 可能已合并二次扫描/含用户编辑状态),直接取用即可。 */
  const data = def.data();
  /* 含亮度遮罩(tt:3)的动画在 canvas 渲染器下构建即失败(上游 lottie-web 的 bug,见 hasLumaMatte):
   * 预览会整帧全黑、导出也是空帧。渲染器下拉框是全局状态(上一套动画可能被切到 Canvas),
   * 所以切入这类动画时自动切回 SVG 并提示一句,用户不用自己去猜为什么黑屏。 */
  const lumaMatte = hasLumaMatte(data);
  if (lumaMatte && selRenderer.value !== 'svg') {
    selRenderer.value = 'svg';
    setStatus('该动画含亮度遮罩:canvas 渲染器不支持,已自动切回 SVG 渲染器');
  }
  // 遮罩源被多个图层共用的动画(tt 层数 > 遮罩源数)在 canvas 渲染器下遮罩合成会偏暗/丢内容,
  // 导出时自动改走 SVG 逐帧光栅化(见 needsSvgRasterExport / rasterizeSvgFrameToCtx),无需用户干预
  if (needsSvgRasterExport(data)) {
    setStatus(lumaMatte
      ? '该动画含亮度遮罩:导出将自动使用 SVG 逐帧光栅化,画面与预览一致'
      : '该动画含共用轨道遮罩:导出将自动使用 SVG 逐帧光栅化,画面与预览一致');
  }
  // 主题颜色区块:当前动画里存在这两族颜色(填充族/描边族)时显示,并回填当前色与计数
  syncThemeSection(data);
  // 图片图层区块:含可调色纹理(百叶窗.png 等)、叠加序列,或黑潮爆破的位图/序列时显示
  const hasTintable = (currentAnimKey === 'blast' ? blastTintableLayers(data) : tintableImageLayers(data)).length > 0;
  imageSection.hidden = !hasTintable;
  if (hasTintable) renderImageList(data);
  else imageList.innerHTML = '';
  // 图标选择区块:位置暴露动画(两段图标)与任务弹窗动画(单张图标)显示。载入前先按用户选择
  // 刷新图标资源,保证随后 loadData 构建的动画直接用上正确的图标(位置暴露两段都写,见 applyIconsToData)。
  const hasIcon = !!iconLayerOf(data, key);
  iconSection.hidden = !hasIcon;
  if (hasIcon) {
    applyIconsToData();
    syncIconScopeUI(data);
  } else {
    iconList.innerHTML = '';
    iconOpacityRow.hidden = true;
  }
  // 报酬信息区块(统一显隐「预期报酬 / 数字 / 图标」):只有任务弹窗动画有这一组
  const hasRewardGroup = key === 'mission';
  missionRewardSection.hidden = !hasRewardGroup;
  if (hasRewardGroup) {
    /* 必须在随后的 loadData 之前把 hd 落实到位 —— loadData 会据此构建 lottie 实例,
     * 之后再改就要多重建一次。rerender=false:这里只改数据,重建由 loadData 负责。 */
    chkMissionReward.checked = missionRewardShown;
    setMissionRewardVisible(missionRewardShown, false);
  }
  // 动画时长区块(时长 + 二次扫描开关 + 二次扫描时长):由注册项的 caps.timing 决定
  timingSection.hidden = !def.caps.timing;
  /* 「二次扫描」勾选行单独按 caps.nextScan 显隐 —— 它只是碰巧和时长滑杆放在同一区块里,
   * 语义上和「时长可调」无关:黑潮爆破默认弹窗是单段弹窗动画(caps 全空),
   * 只该有时长滑杆、甚至没有区块,出现「二次扫描」开关会让人以为能接第二段(勾了也确实什么都不会发生)。 */
  nextScanRow.hidden = !def.caps.nextScan;
  // 二次扫描时长行只在「支持二次扫描」且开关已打开时出现(开关状态是全局的,切回来要保持)
  nextDurationRow.hidden = !(def.caps.nextScan && showNextScan);
  if (def.caps.nextScan) chkNextScan.checked = showNextScan;
  if (def.caps.timing) syncNextDurationSlider();
  // 选择器(顶栏触发器 + 画廊里的「当前」标记)随动画一起刷新
  syncAnimTrigger();
  void loadData(data, def.label);
}
/* ---------- 视频导出 ---------- */
// 导出单飞锁:导出期间为 true,再次点击导出按钮直接返回。
// 两个导出并行会互抢 GPU 编码器与渲染容器,还会互相覆盖进度浮层。
let exporting = false;

/* ---------- 导出进度浮层 ---------- */
// 用户主动取消导出的专用错误类型:catch 里用 instanceof 区分「取消」与「真失败」,
// 取消走静默收尾(不打印堆栈、浮层显示已取消),失败才回显错误信息与堆栈。
class ExportCancelledError extends Error {}

// 取消是「协作式」的:取消按钮只置位 exportCancelRequested,真正的中断发生在逐帧循环的检查点
// (见 runWebCodecsExport / exportVideoAvi),这样硬件编码器与渲染器都能被正常关闭、不泄漏。
// exportLastPct 让「正在取消…」的提示停留在当前进度;exportOverlayTimer 管终态的自动隐藏。
let exportCancelRequested = false;
let exportLastPct = 0;
let exportOverlayTimer: number | undefined;

// 字节数 → 人类可读体积,按 1000 进制显示(与「无压缩 AVI ≈ 宽×高×4×帧数」的粗算口径一致),
// 只用于导出前的量级提示,不追求精确。
function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
  return bytes + ' B';
}

// 打开进度浮层并复位所有导出状态:取消标志、进度、按钮文案、颜色 class。
// exportPercent 的 class 必须重设 —— 上一次导出留下的 done/error/cancel 会让本次进度数字保持旧配色。
// warn 只在有需要提前告知的风险时显示(目前仅透明 AVI 的体积提示)。
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

// 更新进度:百分比取整并夹到 0..100(逐帧回调按整数帧计算,可能因取整越界),进度条宽度与数字同步。
// status 是阶段描述(如「正在编码帧 3 / 300」),detail 是更细的补充信息。
function updateExportProgress(pct: number, status: string, detail = '') {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  exportLastPct = p;
  exportPercent.textContent = p + '%';
  exportBarFill.style.width = p + '%';
  exportStatus.textContent = status;
  exportDetail.textContent = detail;
}

// 收尾:把浮层切到 done / error / cancel 三种终态。
// done 时把文案里的字符勾「✓」换成矢量 ICON_CHECK —— 不同平台的 emoji 字体会把勾渲染成彩色方块。
// 非 error 会在 holdMs(默认 2600ms)后自动关闭浮层;失败则常驻,免得用户还没看清原因就消失了。
function finishExportOverlay(kind: 'done' | 'error' | 'cancel', status: string, detail: string, holdMs = 2600) {
  exportPercent.classList.add(kind === 'done' ? 'done' : kind === 'error' ? 'error' : 'cancel');
  // 成功时把「导出完成 ✓」的字符勾换成矢量对勾
  exportStatus.innerHTML = kind === 'done' ? ICON_CHECK + esc(status.replace(/\s*✓\s*/g, '')) : esc(status);
  exportDetail.textContent = detail;
  btnExportCancel.disabled = false;
  btnExportCancel.textContent = '关闭';
  /* 完成态:把「保存/分享」「重新下载」两个按钮亮出来(有素材可给时)。
   * 手机上下载经常是「提示完成了,但相册/文件里找不到」——这两个按钮就是兜底出口。 */
  const hasFile = kind === 'done' && !!lastExportBlob;
  btnExportSave.hidden = !(hasFile && canShareFile());
  btnExportRedownload.hidden = !hasFile;
  window.clearTimeout(exportOverlayTimer);
  /* 移动端完成态不自动关闭:自动下载在手机上未必落盘,用户需要时间点「保存到手机」。
   * 失败态本来就不自动关(常驻,免得用户还没看清原因就消失了)。 */
  const keepOpen = hasFile && IS_MOBILE;
  if (kind !== 'error' && !keepOpen) {
    exportOverlayTimer = window.setTimeout(() => { exportOverlay.hidden = true; }, holdMs);
  }
}

// 取消按钮一钮两用:导出中 = 请求取消(置位标志,等逐帧循环在检查点中断,按钮随即禁用并转成「关闭」);
// 导出已结束 = 单纯关闭浮层。
btnExportCancel.addEventListener('click', () => {
  if (!exporting) { exportOverlay.hidden = true; return; }
  exportCancelRequested = true;
  btnExportCancel.disabled = true;
  updateExportProgress(exportLastPct, '正在取消,请稍候…');
});

/* 「保存到手机」:优先走系统分享(Web Share Level 2)。
 * 手机上这是把视频真正落到「相册 / 文件」里最可靠的方式 —— blob 下载在 iOS 上经常
 * 只留下一个临时视图,系统播放器之外的 App 根本看不到文件。
 * 必须是用户手势触发的调用,所以它挂在按钮上而不是导出结束时的自动逻辑上。
 * 分享面板被用户取消(AbortError)不算失败,只有系统不支持才退回普通下载。 */
btnExportSave.addEventListener('click', async () => {
  if (!lastExportBlob) return;
  const { blob, filename } = lastExportBlob;
  try {
    const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // 用户自己取消了分享面板
  }
  downloadBlob(blob, filename);
});
// 「重新下载」:自动下载被浏览器拦截 / 手机上没找到文件时,再触发一次
btnExportRedownload.addEventListener('click', () => {
  if (lastExportBlob) downloadBlob(lastExportBlob.blob, lastExportBlob.filename);
});

/* ---------- 图标(内联 SVG,不使用 emoji / 文字符号当图标) ----------
 * ICON_RESET / ICON_CHECK 供 innerHTML 拼接复用;'.bi' 控制尺寸与配色(见 style.css)。
 * SVG 内标 aria-hidden,可读名由按钮的 title / 相邻文字提供。 */
const ICON_RESET =
  '<svg class="bi" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M2.6 8a5.4 5.4 0 1 1 1.7 3.93.8.8 0 0 0-1.1 1.16A7 7 0 1 0 1.2 8z"/>' +
  '<path d="M1 3.2a.8.8 0 0 1 1.6 0v4.2a.8.8 0 0 1-.8.8H-.2a.8.8 0 0 1 0-1.6H1z"/>' +
  '</svg>';
const ICON_CHECK =
  '<svg class="bi" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M13.9 3.5a.95.95 0 0 1 .05 1.34l-6.5 7.4a.95.95 0 0 1-1.4.05L2.2 8.6a.95.95 0 1 1 1.33-1.36l3.15 3.08 5.83-6.64a.95.95 0 0 1 1.34-.18z"/>' +
  '</svg>';
// 启动时一次性取出 WebCodecs 的四个构造器(浏览器不支持时都是 undefined,导出前据此回退)。
// 这些 API 只在安全上下文(https / localhost)可用,所以 resolveH264Plan 里还要额外判断 isSecureContext。
const WebVideoEncoder = (window as any).VideoEncoder;
const WebAudioEncoder = (window as any).AudioEncoder;
const WebVideoFrame = (window as any).VideoFrame;
const WebAudioData = (window as any).AudioData;

/* ---------- 运行环境能力探测(移动端加固) ----------
 * 桌面 Chrome/Edge 的能力基本是「有或没有」两态,手机上却是连续谱:同样是 Chrome,
 * 中低端机型只支持到 1080p 甚至 720p 的 H.264 硬编、不支持 AAC、内存只有桌面的十几分之一。
 * 所以这里不假设任何能力,一律「先探测、不行就降级」,并把真实原因回显到浮层。 */
/* 是否移动端。iPadOS 的 UA 伪装成 Macintosh,所以额外用 maxTouchPoints 兜一层。
 * 只影响三件事:导出分辨率的默认档位、是否做逐帧像素自检、导出期间是否申请屏幕常亮。 */
const IS_MOBILE = (() => {
  try {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPod|Windows Phone|Mobile|HarmonyOS/i.test(ua)) return true;
    return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  } catch { return false; }
})();

/* 完成态那个按钮的文案随端变:手机上走系统分享面板(能直接存进相册 / 发给别人),
 * 桌面上是给「下载被拦截 / 想再存一份」用的兜底入口。 */
btnExportSave.textContent = IS_MOBILE ? '保存到手机' : '分享 / 保存';
/* 能力不足的设备提前告知 —— 等用户按了导出才说就晚了。
 * 提示条会被 syncExportFormatUI 随格式切换重写,所以这里只在启动时写一次做首屏提示;
 * 真正导出时浮层里还有带完整原因与建议的说明。 */
if (!WebVideoEncoder || !window.isSecureContext) {
  exportHint.textContent = '本机不支持 WebCodecs H.264:MP4 将改用兼容录制(无音轨),AVI 将改用 MJPEG';
  exportHint.classList.add('warn');
}

/* 屏幕常亮(Wake Lock):手机导出少则几十秒、多则十几分钟,屏幕一黑系统就把标签页冻结,
 * 表现是「进度卡住不动」或直接被系统杀掉。不支持 / 被拒绝都不影响导出,失败一律忽略。 */
let exportWakeLock: any = null;
async function acquireExportWakeLock(): Promise<void> {
  try {
    const wl = (navigator as any).wakeLock;
    if (!wl || document.visibilityState !== 'visible') return;
    exportWakeLock = await wl.request('screen');
    if (exportWakeLock && typeof exportWakeLock.addEventListener === 'function') {
      exportWakeLock.addEventListener('release', () => { exportWakeLock = null; });
    }
  } catch { exportWakeLock = null; }
}
function releaseExportWakeLock(): void {
  try { if (exportWakeLock && typeof exportWakeLock.release === 'function') exportWakeLock.release(); } catch { /* ignore */ }
  exportWakeLock = null;
}
// 回到前台时补申请一次(系统会在切走时自动释放常亮锁)
document.addEventListener('visibilitychange', () => {
  if (exporting && document.visibilityState === 'visible') void acquireExportWakeLock();
});

/* ---------- H.264(codec string)自动选级 ----------
 * WebCodecs 的 codec string 里写死了 AVC Level(原为 4.2 = 0x2A),而 Level 4.2 的
 * 最大宏块面积只有 8704 宏块(≈1920×1080)。「位置暴露动画」画布是 3840×1080,
 * 已编码面积 4177920 像素 > Level 4.2 上限 2228224:
 * Chrome 在 configure() 时并不抛错(状态仍是 configured),而是直接把编码器关掉,
 * 于是紧接着第一次 encode() 抛出:
 *   Failed to execute 'encode' on 'VideoEncoder': Cannot call 'encode' on a closed codec.
 * (真正的原因留在 error 回调里,而旧代码在回调里 throw,根本传不到 UI。)
 * 这里按分辨率/帧率算出所需的最低 Level 再配置,并在开跑前用 isConfigSupported 校验。 */
// 固定码率 30 Mbps(单位 bit/s):HUD 动画以大面积纯色加锐利文字为主,码率给足才压得住文字边缘的块效应。
// 1080p 与 4K 共用同一常量(对两者都够高),不按分辨率细分,文件体积主要由时长决定。
const H264_BITRATE = 30_000_000;
const AVC_PROFILE_HIGH = '6400'; // High Profile(与原来的 avc1.64002a 一致)
const AVC_PROFILE_MAIN = '4d00';
const AVC_PROFILE_BASELINE = '42e0';
/* [Level 名称, level_idc, 最大宏块数 MaxFS, 最大宏块率 MaxMBPS] —— ITU-T H.264 表 A-1 */
const AVC_LEVELS: [string, number, number, number][] = [
  ['3.1', 0x1f, 3600, 108000],
  ['3.2', 0x20, 5120, 216000],
  ['4.0', 0x28, 8192, 245760],
  ['4.1', 0x29, 8192, 245760],
  ['4.2', 0x2a, 8704, 522240],
  ['5.0', 0x32, 22080, 589824],
  ['5.1', 0x33, 36864, 983040],
  ['5.2', 0x34, 36864, 2073600],
  ['6.0', 0x3c, 139264, 4177920],
  ['6.1', 0x3d, 139264, 8355840],
  ['6.2', 0x3e, 139264, 16711680],
];

/* 按「已编码尺寸」(宽高各自向上取整到 16 的倍数)算所需的最低 Level:
 * 3840×1080 → 3840×1088 = 240×68 = 16320 宏块 → Level 5.0(上限 22080);
 * 1920×1080 → 120×68 = 8160 宏块 → Level 4.0(上限 8192)。 */
function avcMinLevelIndex(w: number, h: number, fps: number): number {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const mbsPerSec = mbs * Math.max(1, Math.round(fps));
  for (let i = 0; i < AVC_LEVELS.length; i++) {
    const maxFs = AVC_LEVELS[i][2], maxMbps = AVC_LEVELS[i][3];
    if (mbs <= maxFs && mbsPerSec <= maxMbps) return i;
  }
  return AVC_LEVELS.length - 1;
}

/* 编码方案(plan)= codec string + 实际编码尺寸 + 帧率 + 码率。
 * 相比原来「只挑 codec string、尺寸固定为动画原始分辨率」,这里允许编码尺寸小于原始尺寸:
 * 手机的 H.264 硬编码器普遍不支持 4K(甚至只到 1080p),原来会直接报「不支持该配置」而整段导出失败。 */
type H264Plan = { codec: string; width: number; height: number; fps: number; scale: number; bitrate: number };

/* 分辨率降级阶梯:从用户选的档位(或 auto 推出来的档位)往下试。
 * 降档同时带来两个好处:硬编码器更可能接受,内存与编码耗时也成比例下降
 * ——手机长导出最容易挂在「4K×60fps 满载跑十几分钟」上(过热降频、被系统回收)。 */
const H264_SCALE_LADDER = [1, 0.75, 0.5, 0.375];

/* H.264 用 4:2:0 色度采样,编码尺寸必须能被 2 整除;奇数宽高会被硬编码器直接拒绝。 */
function evenDim(n: number): number { return Math.max(2, Math.round(n / 2) * 2); }

/* auto 档位的基准缩放:桌面 = 原始分辨率(与既有行为完全一致);
 * 移动端等比压到 1080p 级(不裁切、不改宽高比),避免手机上动辄十几分钟的满载导出。
 * 用户在下拉里显式选了百分比就完全按所选走,这里不再插手。 */
function baseExportScale(w: number, h: number): number {
  if (!IS_MOBILE) return 1;
  return Math.min(1, 1920 / w, 1080 / h);
}

/* 按编码尺寸折算码率:30 Mbps 是按 4K 定的,降到 1080p 还用 30 Mbps 只会白白撑大文件。
 * 按像素数等比缩放;scale = 1 时严格等于 H264_BITRATE,保证桌面端导出结果一字不变。 */
function bitrateFor(w: number, h: number, baseW: number, baseH: number): number {
  const k = (w * h) / Math.max(1, baseW * baseH);
  return Math.max(4_000_000, Math.round(H264_BITRATE * k));
}

/* 选编码方案:沿阶梯逐档降分辨率,每档从「规格算出的最低 Level」往上试(Level 4.0 直接用原来的
 * 4.2 字符串,避免 1080p 导出的既有行为发生变化),High 不行再退 Main / Baseline,
 * 一档分辨率全试不通就把帧率从 60 降到 30 再试。全部失败返回 null —— 由调用方改走兼容路径,
 * 所以这里不抛异常,只如实回报「试过哪些组合」。 */
async function resolveH264Plan(w: number, h: number, fps: number, reqScale = 1): Promise<H264Plan | null> {
  /* 四个构造器缺一不可:VideoFrame 缺失时即便编码器存在也无法从画布取帧
   * ——这里一并挡掉,让调用方直接改走兼容录制,而不是跑到一半抛「构造器不存在」。 */
  if (!WebVideoEncoder || !WebVideoFrame || !window.isSecureContext) return null;
  const ladder = H264_SCALE_LADDER.filter((s) => s <= reqScale + 1e-6);
  const fpsList = fps > 30 ? [fps, 30] : [fps];
  const tried = new Set<string>();
  for (const scale of (ladder.length ? ladder : [1])) {
    const cw = evenDim(w * scale), ch = evenDim(h * scale);
    const bitrate = bitrateFor(cw, ch, w, h);
    for (const f of fpsList) {
      const key = cw + 'x' + ch + '@' + f;
      if (tried.has(key)) continue;
      tried.add(key);
      let start = avcMinLevelIndex(cw, ch, f);
      if (AVC_LEVELS[start] && AVC_LEVELS[start][0] === '4.0') start = 4; // → 4.2(与既有 1080p 行为一致)
      const profiles = [AVC_PROFILE_HIGH, AVC_PROFILE_MAIN, AVC_PROFILE_BASELINE];
      for (let i = start; i < AVC_LEVELS.length; i++) {
        const idc = AVC_LEVELS[i][1].toString(16).padStart(2, '0');
        for (const prof of profiles) {
          const codec = 'avc1.' + prof + idc;
          try {
            const r = await WebVideoEncoder.isConfigSupported({ codec, width: cw, height: ch, bitrate, framerate: f });
            if (r && r.supported) return { codec, width: cw, height: ch, fps: f, scale: cw / w, bitrate };
          } catch { /* 该组合不被支持,继续试下一档 */ }
        }
      }
    }
  }
  return null;
}

// codec string → 可读的「High / Level 5.0」,仅用于错误提示与状态显示。
// avc1.PPCCLL:PP = profile_idc、CC = 约束标志位、LL = level_idc,这里取后两位查 AVC_LEVELS 还原名称。
function avcProfileLevelName(codec: string | null): string {
  if (!codec) return '未知';
  const hex = codec.split('.')[1] || '';
  if (hex.length < 6) return codec;
  const idc = parseInt(hex.slice(4, 6), 16);
  const hit = AVC_LEVELS.find((l) => l[1] === idc);
  const prof = hex.slice(0, 4).toLowerCase();
  const profName = prof === AVC_PROFILE_HIGH ? 'High' : prof === AVC_PROFILE_MAIN ? 'Main' : prof === AVC_PROFILE_BASELINE ? 'Baseline' : prof;
  return profName + ' / Level ' + (hit ? hit[0] : '0x' + idc.toString(16));
}

// mp4-muxer 与 AVI 帧收集器共用的最小接口:只要能把编码后的 chunk 交出去即可,
// 这样 runWebCodecsExport 不必关心最终封装成 MP4 还是 AVI。
type MuxerLike = { addVideoChunk: (chunk: any, meta: any) => void; addAudioChunk: (chunk: any, meta: any) => void };

/* 「本机编不了这个配置」专用错误:与导出中途的其他故障区分开 ——
 * 前者可以自动降一档分辨率重试或改走兼容格式,后者只能如实报错。 */
class EncoderConfigError extends Error {}

/* 统一的 WebCodecs 编码驱动:
 * ① 开跑前用 isConfigSupported 校验 codec / 分辨率,失败给出可读原因;
 * ② 编码器因故关闭时抛出 error 回调里的真实原因,而不是「closed codec」;
 * ③ 结束/取消时一定 close,不泄漏硬件编码器。 */
/* 参数约定:
 *   encodeFrame(enc, i) 由调用方实现「渲染第 i 帧 → new VideoFrame(canvas) → enc.encode」,
 *                       i 是【输出帧序号】(0..totalFrames-1),不是动画帧号;
 *   onProgress(p, detail) 每 12 帧回调一次,p 是输出帧进度(0..100),不含封装与下载阶段;
 *   audio 为 null 表示本次导出没有音轨(AVI 的音频走 PCM,另行封装)。 */
async function runWebCodecsExport(
  muxer: MuxerLike, plan: H264Plan, totalFrames: number,
  onProgress: (p: number, detail?: string) => void,
  encodeFrame: (enc: any, i: number) => Promise<void>,
  audio: { numCh: number; frames: number; sample: (planar: Float32Array, off: number, n: number) => void } | null,
): Promise<void> {
  const { codec, width: w, height: h, fps: fr, bitrate } = plan;
  let encError: any = null;
  const fail = (e: any) => { if (!encError) encError = e; };
  const videoEncoder = new WebVideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  let audioEncoder: any = null;
  const audioSrc = audio && audio.numCh > 0 ? audio : null; // 局部引用,便于在闭包/循环里做非空收窄
  if (audioSrc && WebAudioEncoder && WebAudioData) {
    audioEncoder = new WebAudioEncoder({
      output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
      error: fail,
    });
  }

  try {
    try {
      const chk = await WebVideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fr });
      if (!chk || !chk.supported) throw new Error('编码器拒绝该配置');
    } catch (e) {
      /* 走 EncoderConfigError 而不是普通 Error:调用方据此区分「本机编不了这个尺寸」
       * 与「导出过程中出错」,前者可以自动降一档重试或改走兼容路径。 */
      throw new EncoderConfigError('H.264 编码配置不受支持(' + avcProfileLevelName(codec) + ', ' + w + '×' + h + '): ' + ((e as Error).message || e));
    }
    videoEncoder.configure({ codec, width: w, height: h, bitrate, framerate: fr });
    // AAC-LC(mp4a.40.2)+ 48kHz:采样率必须与 exportVideoMp4 的重采样目标、muxer 里 audio.sampleRate 完全一致,
    // 对不上会出现音调偏移或时长漂移;192 kbps 对音效足够,声道数跟随素材(最多 2)。
    if (audioEncoder && audioSrc) audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: audioSrc.numCh, bitrate: 192000 });

    if (audioEncoder && audioSrc) {
      // AAC-LC 的帧长固定 1024 采样:WebCodecs AudioEncoder 每帧必须正好喂 1024 个采样,这里按此切分。
      // 时间戳单位是【微秒】,由采样偏移 off 换算(off / 48000 秒);planar 复用同一块缓冲区,
      // 尾帧不足 1024 时由 sample 内部补零,多余内容不会被读取(numberOfFrames 只取 n)。
      const AAC_FRAME = 1024;
      const planar = new Float32Array(AAC_FRAME * audioSrc.numCh);
      for (let off = 0; off < audioSrc.frames; off += AAC_FRAME) {
        if (encError) throw encError;
        const n = Math.min(AAC_FRAME, audioSrc.frames - off);
        audioSrc.sample(planar, off, n); // 尾部不足一帧的部分由 sample 内部补零
        const audioData = new WebAudioData({
          format: 'f32-planar', sampleRate: 48000, numberOfChannels: audioSrc.numCh,
          numberOfFrames: n, timestamp: Math.round((off / 48000) * 1e6), data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
    }

    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
      if (encError) throw encError; // 编码器已因错误关闭:抛出真实原因,而不是 closed codec
      if (videoEncoder.state !== 'configured') throw encError || new Error('H.264 编码器已关闭(state=' + videoEncoder.state + ')');
      await encodeFrame(videoEncoder, i);
      // 每 12 帧刷新一次进度并 setTimeout(0) 让出一次事件循环:
      // 逐帧渲染是同步重活,不让出的话导出期间取消按钮和进度条完全没有响应。
      if (i % 12 === 0) { onProgress(Math.round((i / totalFrames) * 100), '正在编码帧 ' + (i + 1) + ' / ' + totalFrames); await new Promise((r) => setTimeout(r, 0)); }
    }

    // flush 不能省:编码器内部还有排队中的帧,不 flush 就拿不到最后几个 chunk。
    // flush 之后要再查一次错误回调 —— 有些编码错误只在收尾时才暴露出来。
    if (audioEncoder) { await audioEncoder.flush(); if (encError) throw encError; }
    await videoEncoder.flush();
    if (encError) throw encError;
  } finally {
    try { videoEncoder.close(); } catch { /* ignore */ }
    if (audioEncoder) { try { audioEncoder.close(); } catch { /* ignore */ } }
  }
}

/* 音频来源:按当前动画返回其音频文件(已打包进网站),不再使用 JSON 内嵌音频 */
function findAudioAsset(): string | null {
  const def = ANIMATIONS.find((a) => a.key === currentAnimKey);
  return def?.audioUrl ?? null;
}

/* 解码音效文件为浮点 PCM:每声道一个 Float32Array,取值 -1..1。
 * buf.slice(0) 是必需的:decodeAudioData 会「分离(detach)」传入的 ArrayBuffer,直接传 res.arrayBuffer()
 * 会让这块内存后续不可用。
 * 用临时 AudioContext 解码后立即 close():浏览器对同时存在的 AudioContext 数量有上限(约 6 个),
 * 泄漏会连带把预览音频一起搞哑。任何失败(404、格式不支持)都返回 null,导出继续但不带音轨。 */
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

/* 用 OfflineAudioContext 重采样到目标采样率(MP4 的 AAC 轨固定 48000)。
 * 采样率相同则直接返回原数组(不复制);输出长度按 toRate/fromRate 比例取整,末尾可能有不到一个采样的零头,
 * 由调用方按视频时长截断 / 补静音。 */
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

/* AAC 编码能力探测(MP4 音轨)。
 * 原来直接 configure('mp4a.40.2'):不支持 AAC 的浏览器会在这一步抛错,结果是**整段导出失败**,
 * 而用户其实只是拿不到音轨。现在先探测,不支持就退回「无声导出」并在浮层里说明。
 * AVI 的音频走自包含的 PCM,完全不经过这里。 */
async function aacSupported(numCh: number): Promise<boolean> {
  if (!WebAudioEncoder || !WebAudioData) return false;
  try {
    const r = await WebAudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: numCh, bitrate: 192000 });
    return !!(r && r.supported);
  } catch { return false; }
}

/* 导出失败时显示的一行「本机能力摘要」:让用户(和远程排障的人)一眼看清
 * 是浏览器没有 WebCodecs、不是安全上下文,还是编码器不支持这个分辨率。 */
function encodeSupportSummary(): string {
  const parts: string[] = [];
  parts.push('WebCodecs=' + (WebVideoEncoder && WebVideoFrame ? '有' : '无'));
  parts.push('安全上下文=' + (window.isSecureContext ? '是' : '否'));
  parts.push('音频编码=' + (WebAudioEncoder && WebAudioData ? '有' : '无'));
  return parts.join(' · ');
}

/* 最近一次导出的产物。<a download> 在移动端(尤其 iOS)未必真的把文件落到「文件/相册」里,
 * 所以导出完成后还会在浮层上给两个按钮:「保存到手机」(Web Share,可存进相册/发给别人)
 * 与「重新下载」。两者都从这里取字节。 */
let lastExportBlob: { blob: Blob; filename: string } | null = null;

/* 本机是否支持用系统分享把文件交出去(移动端落地视频最可靠的一条路)。
 * canShare 需要一个真实的 File 才能判,这里用 1 字节的占位文件探测能力,代价可忽略。 */
function canShareFile(): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'prob.mp4', { type: 'video/mp4' })] });
  } catch { return false; }
}

// 触发浏览器下载。blob URL 不能立刻 revoke:部分浏览器在大文件真正开始落盘前会被中断,
// 所以延迟 10 秒释放;<a> 用完即从 DOM 移除,避免节点堆积。
function downloadBlob(blob: Blob, filename: string) {
  // 记住本次产物:浮层上的「保存/分享」「重新下载」要靠它再取一次
  lastExportBlob = { blob, filename };
  // 开发模式:把同一份字节流上传到 dev server 落盘(tools/user-export.avi),
  // 用于分析真实导出的文件结构(仅 dev,不影响生产)
  if (import.meta.env.DEV) {
    fetch('/save-avi', { method: 'POST', body: blob }).catch(() => {});
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* MP4 导出(H.264 视频 + AAC 音频,由 mp4-muxer 封装)。
 * 取帧统一来自「合成画布」(背景 + 主动画 + 弹窗),画面由调用方传入的 renderFrame 负责画好。
 * 音频先解码音效再重采样到 48kHz(与 AAC 轨声明一致),然后按视频时长截断 / 补静音,
 * 保证音轨与视频严格等长,导入剪辑软件不会音画不同步。
 * animFrameOf 负责把输出帧序号 i 映射到动画帧号。 */
async function exportVideoMp4(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void | Promise<void>, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void, plan: H264Plan, animFrameOf: (i: number) => number = (i) => data.ip + i) {
  if (!WebVideoEncoder || !WebVideoFrame) throw new Error('当前浏览器不支持 WebCodecs 视频编码(请用 Chrome/Edge)');
  const w = plan.width, h = plan.height;
  const audioUrl = findAudioAsset();
  const audioInfo = audioUrl ? await decodeAudio(audioUrl) : null;
  const audioChannels = audioInfo ? await resampleTo(audioInfo.channels, audioInfo.sampleRate, 48000) : null;
  // 声道数上限 2:导出的 AAC 轨只声明立体声,多声道素材也只取前两路
  let numCh = audioChannels ? Math.min(audioChannels.length, 2) : 0;
  /* 先确认本机能编 AAC 再决定「要不要音轨」:mp4-muxer 的音轨是在构造时声明的,
   * 声明了却没有帧喂进去会得到一个空的音频轨。不支持就拿掉音轨继续导出(见 aacSupported)。 */
  if (numCh > 0 && !(await aacSupported(numCh))) numCh = 0;
  const videoSec = totalFrames / fr;
  // 音轨长度严格按视频时长(秒 × 48000)定:多出来的音频丢掉,不够的补静音
  const audioFrames = audioChannels ? Math.round(videoSec * 48000) : 0;

  // fastStart:'in-memory' 把 moov 索引块写到文件头(代价是组装期间数据在内存里多留一份),
  // 这样浏览器/播放器能边下边播,剪辑软件拖进度条也不必先扫完整个文件。
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate: fr },
    ...(numCh > 0 ? { audio: { codec: 'aac', numberOfChannels: numCh, sampleRate: 48000 } } : {}),
    fastStart: 'in-memory',
  });

  /* 音频交给 runWebCodecsExport 统一按 AAC 帧喂给编码器 */
  const audio = (numCh > 0 && audioChannels && WebAudioEncoder && WebAudioData)
    ? {
        numCh,
        frames: audioFrames,
        sample: (planar: Float32Array, off: number, n: number) => {
          // f32-planar 是「按通道连续」排布:第 c 通道第 i 个采样在 planar[c * n + i]
          // (n = 本帧样本数,不是缓冲区容量 AAC_FRAME × numCh),写成交错布局会被解成噪声
          for (let c = 0; c < numCh; c++) {
            const ch = audioChannels[c];
            for (let i = 0; i < n; i++) {
              const s = off + i < ch.length ? ch[off + i] : 0;
              planar[c * n + i] = s * AUDIO_VOLUME; // 超出音频长度补静音
            }
          }
        },
      }
    : null;

  /* 编码尺寸小于合成画布(手机等自动降档)时,先把整帧缩到编码尺寸再交给编码器。
   * 一次 GPU 侧的 drawImage 代价远低于让硬编码器去拒绝一个它不支持的尺寸。 */
  const srcW = canvas.width, srcH = canvas.height;
  const needScale = w !== srcW || h !== srcH;
  const encCanvas = needScale ? document.createElement('canvas') : canvas;
  if (needScale) { encCanvas.width = w; encCanvas.height = h; }
  const encCtx = needScale ? encCanvas.getContext('2d') : null;
  if (needScale && !encCtx) throw new Error('无法创建缩放画布');

  await runWebCodecsExport(muxer, plan, totalFrames, onProgress, async (enc, i) => {
    const animFrame = animFrameOf(i);
    await ensureSeqDecoded(Math.round(animFrame));
    await renderFrame(animFrame);
    if (encCtx) encCtx.drawImage(canvas, 0, 0, w, h);
    // VideoFrame 的 timestamp / duration 单位是【微秒】:第 i 帧时间戳 = i/fr 秒。
    // 关键帧每 60 帧(约 1 秒)一个 —— 太稀会让播放与剪辑 seek 变慢,太密则白白增大文件。
    const frame = new WebVideoFrame(encCanvas, { timestamp: Math.round((i * 1e6) / fr), duration: Math.round(1e6 / fr) });
    enc.encode(frame, { keyFrame: i % 60 === 0 });
    frame.close();
  }, audio);

  // 编码阶段只报到 99%:最后的封装(finalize 要把整段数据在内存里搬一遍)与下载同样要占时间
  onProgress(99, '帧编码完成,正在封装音视频…');
  muxer.finalize();
  onProgress(100, '封装完成,正在下载…');
  downloadBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'animation.mp4');
}

/* --- AVI 自封装(MJPEG + PCM / 无压缩 BGRA 透明 + PCM) --- */
// 三个小工具:ASCII 四cc / 小端 u32 / 小端 u16。
// AVI(RIFF)的所有整数字段都是 little-endian 且不做对齐填充,所以统一用 DataView 按小端写入。
function ascii(s: string) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }

/* AVI 容器通用组装(videoFcc: 编码器标识 MJPG / DIB ;strf: 视频流 BITMAPINFOHEADER;
 * frameFcc: movi 帧块标识 00dc / 00db)。直接以 parts 数组构造 Blob,避免大文件二次拷贝。 */
function buildAvi(w: number, h: number, fr: number, videoFcc: string, strf: Uint8Array<ArrayBuffer>, frameFcc: string, frameChunks: Uint8Array<ArrayBuffer>[], pcm16: Uint8Array<ArrayBuffer>, numCh: number, audioRate: number, frameKeyFlags?: boolean[]): Blob {
  const totalFrames = frameChunks.length;
  const isDib = videoFcc === 'DIB ';
  const frameBytes = w * h * 4;
  const bytesPerSample = numCh * 2;
  const hasAudio = numCh > 0;

  // 音频按"每帧时长"切片,与视频帧交错写入 movi —— 播放器顺序读取,
  // 无需在文件头尾之间频繁 seek,显著改善大文件(尤其无压缩透明 AVI)的播放流畅度
  /* 每帧音频切片必须严格铺满 PCM,否则音频流长度和文件头里的 dwRate 对不上,
   * 播放器重采样/丢样就会「滋啦」。
   * 用累计取整(第 f 帧 = [round(f*rate/fr), round((f+1)*rate/fr)))而不是
   * 「每帧固定 round(rate/fr) 个样本」——后者在 48000/fr 不是整数时(如 165fps
   * → 290.909)每秒会多/少几十个样本,长时间就漂移、出现爆音。 */
  const audioSlices: Uint8Array<ArrayBuffer>[] = [];
  if (hasAudio) {
    const samplesAt = (f: number) => Math.round((f * audioRate) / fr);
    for (let f = 0; f < totalFrames; f++) {
      const start = samplesAt(f) * bytesPerSample;
      if (start >= pcm16.length) break;
      const end = Math.min(pcm16.length, samplesAt(f + 1) * bytesPerSample);
      if (end <= start) continue; // 极端高帧率下可能不足一个样本,跳过该帧的音频块
      let slice = pcm16.subarray(start, end);
      if (slice.length % 2) { // 偶字节对齐
        const c = new Uint8Array(slice.length + 1);
        c.set(slice);
        slice = c;
      }
      audioSlices.push(slice as Uint8Array<ArrayBuffer>);
    }
  }

  // 分段:每段数据 ≤ ~1GB(RIFF/movi 的 size 字段是 uint32,最大 4.29GB,
  // 无压缩透明 AVI 超过后必须用 AVIX/ODML 分段,否则播放器只读前 1GB 出现残影)
  const SEGMENT_LIMIT = 0x3F000000;
  const segments: number[] = [];
  {
    let cur = 0, curBytes = 0;
    for (let i = 0; i < totalFrames; i++) {
      const fb = 8 + frameChunks[i].length + (audioSlices[i] ? 8 + audioSlices[i].length : 0);
      if (cur > 0 && curBytes + fb > SEGMENT_LIMIT) {
        segments.push(cur);
        cur = 0;
        curBytes = 0;
      }
      cur++;
      curBytes += fb;
    }
    if (cur > 0) segments.push(cur);
  }
  const segmentCount = segments.length;
  const multi = segmentCount > 1;

  /* RIFF 规定:块长度为奇数时后面要补 1 个填充字节,且该填充字节计入父容器(LIST/RIFF)的大小。
   * 此前完全没算填充:H.264 的 strf = 40 + avcC 常常是奇数,于是 hdrl/movi 之后所有偏移
   * 整体错位 1 字节,播放器/ffmpeg 从错位处读块头 → 「tag IST…」解析失败、
   * 音频读到帧数据 = 滋啦、画面残影。这里统一按「含填充」计算。 */
  const pad = (n: number) => n % 2;
  const PAD_BYTE = new Uint8Array(1);              // 奇数块后的填充字节(内容 0)
  // 尺寸计算:LIST 块的大小字段 = 内容(四cc + 子块,含子块填充),不含 LIST 自身 8 字节头
  const avihChunkSize = 8 + 56;                    // 'avih' chunk
  const strhChunkSize = 8 + 56;                    // 'strh' chunk
  const strfVideoChunkSize = 8 + strf.length + pad(strf.length);      // 'strf' chunk(40 或 40+avcC,奇数要补)
  const strfAudioChunkSize = 8 + 18;
  const videoStrlContent = 4 + strhChunkSize + strfVideoChunkSize;  // 'strl' + strh + strf
  const audioStrlContent = 4 + strhChunkSize + strfAudioChunkSize;  // 'auds' + strh + strf
  const odmlContent = 4 + (8 + 20);                // 'odml' + dmlh chunk(ODML 大文件标记)
  const hdrlContent = 4 + avihChunkSize + (8 + videoStrlContent) + (hasAudio ? 8 + audioStrlContent : 0) + (multi ? 8 + odmlContent : 0);  // 'hdrl'

  const moviContentOf = (start: number, count: number) => {
    let s = 4; // 'movi'
    for (let i = start; i < start + count; i++) {
      s += 8 + frameChunks[i].length + pad(frameChunks[i].length);
      if (audioSlices[i]) s += 8 + audioSlices[i].length + pad(audioSlices[i].length);
    }
    return s;
  };
  // 写一段 movi 的帧块(音视频交错),返回 idx 条目(offset 相对本段 movi 内容起点)
  const writeMovi = (start: number, count: number, target: BlobPart[], baseOffset: number): { fourcc: string; flags: number; offset: number; size: number }[] => {
    let moviOffset = baseOffset + 4; // 相对段0 movi 内容起点的偏移(跨段累加)
    const idx: { fourcc: string; flags: number; offset: number; size: number }[] = [];
    for (let i = start; i < start + count; i++) {
      const c = frameChunks[i];
      target.push(ascii(frameFcc), u32(c.length), c);
      idx.push({ fourcc: frameFcc, flags: frameKeyFlags ? (frameKeyFlags[i] ? 0x10 : 0x00) : 0x10, offset: moviOffset, size: c.length });
      moviOffset += 8 + c.length;
      if (pad(c.length)) { target.push(PAD_BYTE); moviOffset += 1; } // RIFF 填充:奇数块补 1 字节
      const a = audioSlices[i];
      if (a) {
        target.push(ascii('01wb'), u32(a.length), a);
        idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: a.length });
        moviOffset += 8 + a.length;
        if (pad(a.length)) { target.push(PAD_BYTE); moviOffset += 1; }
      }
    }
    return idx;
  };
  // 写 idx1 标准索引块:每条目 16 字节(四cc + flags + offset + size,全部小端)。
  // 有索引,播放器与 ffmpeg 才能直接 seek 到任意帧,不必顺序扫描整个 movi。
  const writeIdx1 = (target: BlobPart[], idx: { fourcc: string; flags: number; offset: number; size: number }[]) => {
    target.push(ascii('idx1'), u32(idx.length * 16));
    for (const e of idx) {
      const entry = new Uint8Array(16);
      const d = new DataView(entry.buffer);
      entry.set(ascii(e.fourcc), 0);
      d.setUint32(4, e.flags, true);
      // dwChunkOffset = 相对 'movi' fourcc 位置的偏移,第一条目 = 4(标准约定,
      // 与 ffmpeg/VirtualDub 一致)。曾写成 +4(第一条目=8),ffmpeg 有校准能容忍,
      // PotPlayer 按原始约定计算会整体 +4 偏差 → 音频读到块头当数据 = 滋滋声
      d.setUint32(8, e.offset, true);
      d.setUint32(12, e.size, true);
      target.push(entry);
    }
  };

  // 预计算所有段的 idx 条目(段0 的 idx1 需要包含全部帧,ffmpeg 只在第一个 movi 后扫描 idx1)
  const calcIdx = (start: number, count: number, baseOffset: number): { fourcc: string; flags: number; offset: number; size: number }[] => {
    let moviOffset = baseOffset + 4;
    const idx: { fourcc: string; flags: number; offset: number; size: number }[] = [];
    for (let i = start; i < start + count; i++) {
      idx.push({ fourcc: frameFcc, flags: frameKeyFlags ? (frameKeyFlags[i] ? 0x10 : 0x00) : 0x10, offset: moviOffset, size: frameChunks[i].length });
      moviOffset += 8 + frameChunks[i].length + pad(frameChunks[i].length);
      if (audioSlices[i]) {
        idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: audioSlices[i].length });
        moviOffset += 8 + audioSlices[i].length + pad(audioSlices[i].length);
      }
    }
    return idx;
  };
  // 跨段 base 计算(两遍法:idxDataBytes 依赖截断点,截断点依赖 base,但截断点
  // 只由 4.29GB 边界决定,16KB 级平移不会改变它,所以第一遍用占位值求截断,
  // 第二遍用真实 idxDataBytes 重算。截断点在 517/518 帧之间,与段偏移无关)
  const calcAllIdx = (idxData: number): { fourcc: string; flags: number; offset: number; size: number }[] => {
    const out: { fourcc: string; flags: number; offset: number; size: number }[] = [];
    let off = segments[0];
    // 段 k 第一帧块相对段0内容起点的偏移 = Σ前面段 movi 内容 + idx1块(8+idxData) + 段头(20)
    // 注意:idx1 块在段0 内 movi0 之后,必须计入;段头 = RIFF(8)+AVIX(4)+LIST(8) = 20,
    // 'movi' fourcc 已含在 moviContentOf 内,不能重复加
    let base = moviContentOf(0, segments[0]) + idxData + 28;
    out.push(...calcIdx(0, segments[0], 0));
    for (let k = 1; k < segmentCount; k++) {
      out.push(...calcIdx(off, segments[k], base));
      base += moviContentOf(off, segments[k]) + 20;
      off += segments[k];
    }
    return out;
  };
  let allIdx = calcAllIdx(0);
  // ===== 索引策略 =====
  // idx1 的 u32 偏移最多表示 4.29GB,超出的条目会回绕(PotPlayer 残影根源)。
  // 实测 PotPlayer 对头区的任何 'indx' 块都会出错(无声音/拒播),所以:
  //   - 多段:写"部分 idx1"——偏移能放进 u32 的条目(前 ~517 帧,绝对正确);
  //     超界部分按 AVI 规范"seek 到最近条目再顺序解码",结果仍正确(ffmpeg/VLC 已验证)。
  //   - 单段:全部条目(u32 内)。
  const idxCut = multi ? allIdx.findIndex(e => e.offset > 0xFFFFF000) : -1;
  if (multi) allIdx = calcAllIdx((idxCut < 0 ? allIdx.length : idxCut) * 16);
  const idx1Entries = idxCut < 0 ? allIdx : allIdx.slice(0, idxCut);
  const idxDataBytes = idx1Entries.length * 16;

  const parts: BlobPart[] = [];
  // ===== 段 0(主 RIFF:AVI + hdrl + movi0 + idx1(部分/全部)) =====
  {
    const seg0 = segments[0];
    const movi0Content = moviContentOf(0, seg0);
    // RIFF 大小字段 = 段0 总大小 - 8('RIFF' + size 本身)
    const riffSize = 28 + hdrlContent + movi0Content + idxDataBytes;
    parts.push(ascii('RIFF'), u32(riffSize), ascii('AVI '));
    // hdrl
    parts.push(ascii('LIST'), u32(hdrlContent), ascii('hdrl'));
    // avih 是主文件头,固定 56 字节(40 字节字段 + 16 字节保留区,保留区保持全 0)。
    // 播放器主要校验 microSecPerFrame / totalFrames / 宽高;dwStreams 必须与实际写出的 strl 数量一致。
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
      // dwSampleSize 必须为 0:ffmpeg 的 seek 会把时间戳 × dwSampleSize 再查索引,
      // 无压缩帧若设置帧大小会导致 seek 失败(播放器残影/卡死)
      d.setUint32(44, 0, true);
      parts.push(ascii('strh'), u32(56), strh);
      // strf (BITMAPINFOHEADER,长度可变:40 或 40+avcC);奇数长度必须补 1 字节,
      // 否则 hdrl 之后所有偏移错位 1 字节(解析失败/音频滋啦的根因)
      parts.push(ascii('strf'), u32(strf.length), strf);
      if (pad(strf.length)) parts.push(PAD_BYTE);
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
      // 音频流的 dwLength 以「样本单位」计(scale=1、rate=audioRate,所以一个单位 = 一个采样帧):
      // 采样帧数 = 字节数 / 每帧字节数(numCh × 2)
      d.setUint32(32, Math.floor(pcm16.length / bytesPerSample), true);
      d.setUint32(36, 0, true);
      d.setUint32(40, 0xffffffff, true); // -1 quality
      d.setUint32(44, bytesPerSample, true);
      parts.push(ascii('strh'), u32(56), strh);
      // WAVEFORMATEX 18 字节(比 16 字节的 PCMWAVEFORMAT 多一个 cbSize=0,AVI 音频的标准写法):
      // 格式标签(1=PCM)/ 声道数 / 采样率 / 平均字节率 / 块对齐 / 位深 / 附加字节数
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
    // ODML 标记(仅大文件分段时):让 AE/PR/PotPlayer 识别为 AVI 2.0
    if (multi) {
      const dmlh = new Uint8Array(20);
      const dd = new DataView(dmlh.buffer);
      dd.setUint32(0, totalFrames, true); // dwTotalFrames
      parts.push(ascii('LIST'), u32(odmlContent), ascii('odml'));
      parts.push(ascii('dmlh'), u32(20), dmlh);
    }
    // movi(音视频交错)
    parts.push(ascii('LIST'), u32(movi0Content), ascii('movi'));
    writeMovi(0, seg0, parts, 0);
    // idx1(多段=部分条目,单段=全部)紧跟段0 movi
    writeIdx1(parts, idx1Entries);
  }
  // ===== 后续段(RIFF AVIX + LIST movi) =====
  {
    let offset = segments[0];
    let baseOffset = moviContentOf(0, segments[0]) + 20;
    for (let k = 1; k < segmentCount; k++) {
      const seg = segments[k];
      const moviKContent = moviContentOf(offset, seg);
      const riffSize = 12 + moviKContent; // 'AVIX'(4) + LIST(8+moviContent)
      parts.push(ascii('RIFF'), u32(riffSize), ascii('AVIX'));
      parts.push(ascii('LIST'), u32(moviKContent), ascii('movi'));
      writeMovi(offset, seg, parts, baseOffset);
      baseOffset += moviKContent + 24;
      offset += seg;
    }
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

/* ImageData(RGBA,自上而下) → DIB 帧(BGRA,自下而上,保留 alpha)
 * 注意:输出为【预乘 alpha】——Windows/DirectShow 生态(PotPlayer 等)按
 * premultiplied 语义合成 alpha,straight 数据会被误渲染为不透明亮色。 */
function rgbaToBgraBottomUp(img: ImageData, w: number, h: number): Uint8Array<ArrayBuffer> {
  const src = img.data;
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const s = y * rowBytes;
    const d = (h - 1 - y) * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      const a = src[s + x + 3];
      out[d + x] = Math.round((src[s + x + 2] * a) / 255);     // B(预乘)
      out[d + x + 1] = Math.round((src[s + x + 1] * a) / 255); // G(预乘)
      out[d + x + 2] = Math.round((src[s + x] * a) / 255);     // R(预乘)
      out[d + x + 3] = a;
    }
  }
  return out;
}

/* MJPEG 压缩 AVI(体积小,不含 alpha,用于带背景色的导出) */
function buildAviMjpeg(w: number, h: number, fr: number, jpegFrames: Uint8Array<ArrayBuffer>[], pcm16: Uint8Array<ArrayBuffer>, numCh: number, audioRate: number): Blob {
  // JPEG 帧长度可能为奇数:先统一补 1 字节,保证 movi 内每个块偶对齐
  // (与 buildAvi 内对 strf / 音频块做的 RIFF 填充是同一件事,漏掉会让后续所有偏移错位 1 字节)
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
  // 有音效时直接用素材原始采样率:AVI 的 PCM strf 可以声明任意采样率,不像 AAC 被固定 48k 约束,
  // 所以这里不做重采样、不引入额外失真;无音效时 numCh=0,audioRate 只是占位值。
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
        // 浮点 -1..1 → int16:先 clamp(素材本身可能轻微过载)再乘 AUDIO_VOLUME(0.3,与预览音量一致),
        // 最后乘 32767 而不是 32768,避免 +1.0 溢出成反向的负值
        dv.setInt16((i * numCh + c) * 2, Math.round(s * AUDIO_VOLUME * 32767), true);
      }
    }
  }
  return { pcm16, numCh, audioRate };
}

/* 导出 AVI,两种模式:
 *   dib   —— 无压缩 32 位 BGRA,逐帧 getImageData 直读像素,真正保留 alpha 透明通道(体积大);
 *   mjpeg —— 每帧 toBlob 成 JPEG 再封装,浏览器不支持 WebCodecs 时的回退方案(体积小,但无透明、有色度毛边)。
 * 两条路都是「先把所有帧收进内存,最后一次性组装 AVI」,内存占用与帧数成正比。
 * 取消靠逐帧循环里的 exportCancelRequested 检查点。 */
async function exportVideoAvi(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void | Promise<void>, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void, mode: 'dib' | 'mjpeg', animFrameOf: (i: number) => number = (i) => data.ip + i) {
  const { pcm16, numCh, audioRate } = await buildPcm16(data, totalFrames, fr);

  let blob: Blob;
  if (mode === 'dib') {
    // 无压缩 32 位 BGRA:直接读取画布像素,真正保留 alpha 透明通道
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法读取渲染画布');
    const bgraFrames: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
      const animFrame = animFrameOf(i);
      await ensureSeqDecoded(Math.round(animFrame));
      await renderFrame(animFrame);
      // 透明只能走 getImageData 直读像素:canvas 的 toBlob 只给 JPEG/PNG(JPEG 无 alpha),
      // 而这里要的是「预乘 alpha、自下而上」的 DIB 布局,转换在 rgbaToBgraBottomUp 里完成
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
      const animFrame = animFrameOf(i);
      await ensureSeqDecoded(Math.round(animFrame));
      await renderFrame(animFrame);
      // JPEG 质量 0.92:MJPEG 每帧独立压缩,质量给足以减少色度毛边,同时别把体积推回 PNG 量级
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
async function exportVideoAviH264(data: any, canvas: HTMLCanvasElement, renderFrame: (n: number) => void | Promise<void>, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void, plan: H264Plan, animFrameOf: (i: number) => number = (i) => data.ip + i) {
  if (!WebVideoEncoder || !WebVideoFrame) throw new Error('当前浏览器不支持 H.264 编码(请用 Chrome/Edge)');
  const { pcm16, numCh, audioRate } = await buildPcm16(data, totalFrames, fr);
  // 编码尺寸取自编码方案:AVI 的 strf / avih 都必须声明「真正编码出来的尺寸」,
  // 与 MP4 一样支持手机等机型的自动降档(降档后写进容器头的也是降档尺寸)
  const w = plan.width, h = plan.height;

  const frames: { data: Uint8Array<ArrayBuffer>; key: boolean }[] = [];
  /* 裸 WebCodecs 输出:帧数据收集 + 从首个 chunk 的 decoderConfig 取 avcC(附加到 AVI strf)。
   * 注意:TS 对闭包内赋值不做窄化,所以这里必须用另一个变量接住再判断,不能先声明成 null 再在闭包里赋值。 */
  let avcCLocal: Uint8Array<ArrayBuffer> | null = null;
  const collect = (chunk: any, meta: any) => {
    const desc = meta?.decoderConfig?.description;
    if (desc && !avcCLocal) {
      avcCLocal = desc instanceof ArrayBuffer
        ? new Uint8Array(desc)
        : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength); // 只取视图范围,避免带上整个底层 buffer
    }
    const buf = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buf);
    frames.push({ data: buf, key: chunk.type === 'key' });
  };
  // 复用统一的 WebCodecs 驱动,但 muxer 换成「只收集帧数据」的收集器 —— 封装交给 AVI 自己写;
  // AVI 的音频走 PCM,所以 addAudioChunk(即 AAC 编码)整个不用,audio 参数传 null。
  // 编码尺寸小于合成画布时先缩放(与 MP4 路径同一套处理)
  const srcW = canvas.width, srcH = canvas.height;
  const needScale = w !== srcW || h !== srcH;
  const encCanvas = needScale ? document.createElement('canvas') : canvas;
  if (needScale) { encCanvas.width = w; encCanvas.height = h; }
  const encCtx = needScale ? encCanvas.getContext('2d') : null;
  if (needScale && !encCtx) throw new Error('无法创建缩放画布');

  await runWebCodecsExport(
    { addVideoChunk: collect, addAudioChunk: () => { /* AVI 音频走 PCM,不用 AAC */ } },
    plan, totalFrames, onProgress,
    async (enc, i) => {
      const animFrame = animFrameOf(i);
      await ensureSeqDecoded(Math.round(animFrame));
      await renderFrame(animFrame);
      if (encCtx) encCtx.drawImage(canvas, 0, 0, w, h);
      const frame = new WebVideoFrame(encCanvas, { timestamp: Math.round((i * 1e6) / fr), duration: Math.round(1e6 / fr) });
      enc.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
    },
    null,
  );
  // avcC(解码配置,含 SPS/PPS)来自首个 chunk 的 decoderConfig.description,必须拿到:
  // 缺了它 AVI 的 strf 无法声明 H.264 参数集,播放器会黑屏或直接拒播
  if (!avcCLocal) throw new Error('未能获取 H.264 解码配置(avcC)');

  onProgress(99, '帧编码完成,正在组装 AVI(H.264)…');
  // frameKeyFlags 决定 idx1 里每个帧块的 0x10(AVIIF_KEYFRAME)标志:H.264 的非关键帧无法单独解码,
  // 标错会让播放器 / 剪辑软件 seek 之后花屏
  const blob = buildAvi(w, h, fr, 'H264', h264Strf(w, h, avcCLocal), '00dc', frames.map((f) => f.data), pcm16, numCh, audioRate, frames.map((f) => f.key));
  onProgress(100, 'AVI 组装完成,正在下载…');
  downloadBlob(blob, 'animation.avi');
}

/* ---------- 兼容录制(MediaRecorder):本机没有可用的 WebCodecs H.264 编码器时的最后一条路 ----------
 * 有这类机型:手机上浏览器自带视频能力(能录屏、能用 MediaRecorder),但 WebCodecs 的
 * VideoEncoder 要么不存在、要么不提供 H.264。原来遇到这种机器 MP4 直接失败,只剩「请用 Chrome/Edge」
 * ——而手机用户换不了浏览器内核。这里改用「画布录制」出片,产出的 MP4(H.264,部分地区)/ WebM 都能直接播。
 * 两个已知代价,都会写进完成提示:
 *   ① 录制按真实时间走(10 秒动画就要录 10 秒),不能像 WebCodecs 那样离线快跑;
 *   ② 不挂音轨(音轨要再把 WebAudio 推成一条媒体流,风险与收益不成比例)。
 * captureStream(0) 表示「不自动采样,等 requestFrame() 推帧」:只有推帧那一刻的画面会被录进去,
 * 所以录到的就是逐帧渲染的结果,不会掺入浏览器自己采样的中间态。 */
function pickRecorderMime(): string | null {
  try {
    const MR = (window as any).MediaRecorder;
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;
    // 优先 MP4(Safari 与部分 Android 能直接录 MP4),否则退 WebM(Android/桌面 Chrome 都认)
    const cands = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const m of cands) if (MR.isTypeSupported(m)) return m;
  } catch { /* ignore */ }
  return null;
}

async function exportVideoRecorder(canvas: HTMLCanvasElement, renderFrame: (n: number) => void | Promise<void>, totalFrames: number, fr: number, onProgress: (p: number, detail?: string) => void, animFrameOf: (i: number) => number): Promise<void> {
  const mime = pickRecorderMime();
  const capture = (canvas as any).captureStream;
  if (!mime || typeof capture !== 'function') {
    throw new Error('本机既没有可用的 H.264 编码器,也不支持画布录制(' + encodeSupportSummary()
      + ')。请改用电脑上的 Chrome / Edge 导出,或在该浏览器里勾选「透明背景」导出 AVI。');
  }
  const stream: MediaStream = capture.call(canvas, 0) as MediaStream;
  const track: any = stream.getVideoTracks()[0];
  if (!track) throw new Error('画布录制失败:没有取到视频轨');
  const hasRequestFrame = typeof track.requestFrame === 'function';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });

  onProgress(0, '正在兼容录制(按真实速度,约 ' + Math.ceil(totalFrames / fr) + ' 秒)…');
  rec.start();
  const frameMs = 1000 / fr;
  const t0 = performance.now();
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelRequested) throw new ExportCancelledError('导出已取消');
      const animFrame = animFrameOf(i);
      await ensureSeqDecoded(Math.round(animFrame));
      await renderFrame(animFrame);
      // 推帧:requestFrame 不可用时(Microsoft 系旧实现)只能靠 captureStream 的自动采样,
      // 此时录制时间轴仍由下面的等时逻辑对齐
      if (hasRequestFrame) track.requestFrame();
      /* 录制器的时间轴是「墙钟」:推帧必须按 1/fr 秒的节奏走,推太快会把 10 秒的动画录成几秒。
       * 渲染本身比 16ms 慢时(手机上常见)不做补偿 —— 那只会让录制时间更长,不影响画面正确性。 */
      const wait = t0 + (i + 1) * frameMs - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (i % 12 === 0) onProgress(Math.round((i / totalFrames) * 100), '正在兼容录制帧 ' + (i + 1) + ' / ' + totalFrames);
    }
  } finally {
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    track.stop();
  }
  await stopped;
  const isMp4 = mime.indexOf('mp4') !== -1;
  const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  if (!blob.size) throw new Error('兼容录制没有产生任何数据(浏览器可能禁用了画布录制)');
  onProgress(100, '录制完成,正在保存…');
  downloadBlob(blob, 'animation.' + (isMp4 ? 'mp4' : 'webm'));
}

/* 导出实例的「每帧状态同步」:导出直接调 renderer.renderFrame() 逐帧渲染,
 * 绕过了 lottie 自己的 AnimationItem.renderFrame(),而后者每帧还会做两件事:
 *   ① expressionsPlugin.resetFrame():清空表达式插件逐帧状态(_lottieGlobal)。
 *      预览(goToAndStop/play)必经此步,导出此前完全跳过 —— 含 AE 表达式的动画
 *      因此在导出与预览之间产生差异(表达式里用 _lottieGlobal 暂存/累加的写法尤其明显);
 *   ② currentFrame / currentRawFrame 同步:任何读取 anim.currentFrame 的代码
 *      (元素、表达式、序列帧兜底)都能取到当前导出帧,而不是停在 0。
 * 这里在每次 renderer.renderFrame(n, true) 之前补齐,使导出与预览走同一条帧管线。 */
function syncAnimFrameForExport(item: AnimationItem | null, frame: number) {
  if (!item) return;
  const anyItem = item as any;
  try {
    const plugin = anyItem.expressionsPlugin;
    if (plugin && typeof plugin.resetFrame === 'function') plugin.resetFrame();
  } catch { /* 表达式插件缺位时忽略 */ }
  const first = typeof anyItem.firstFrame === 'number' && isFinite(anyItem.firstFrame) ? anyItem.firstFrame : 0;
  anyItem.currentRawFrame = frame - first;
  anyItem.currentFrame = frame - first;
}

/* 导出专用 Canvas 渲染器 patch:文字兜底 + 修复 getElementById 扫描未构建元素报错 */
function patchExportCanvasRenderer(renderer: any) {
  patchCanvasRendererTree(renderer, true);
  // 覆盖 getElementById:lottie 原实现直接读 this.elements[i].data,而元素数组在 buildItem 之前
  // 存在空槽位 → 读 .data 抛 TypeError。导出是「按帧直渲」,元素未必都构建过,所以补上空值保护。
  renderer.getElementById = function (id: number) {
    const els = this.elements || [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el && el.data && el.data.ind === id) return el;
    }
    return null;
  };
}

/* ---------- 兼容导出:用 SVG 渲染器逐帧光栅化 ----------
 * 背景:lottie-web 的 canvas 渲染器用「整画布缓冲 + source-in/destination-over」实现轨道遮罩。
 * 当一份遮罩源被多个图层共用时(核电站功率动画:10 个 tt 层共用 2 个遮罩源,其中还夹着文字层),
 * 这套合成会逐层把内容乘暗甚至抹掉(实测同帧:亮红 (216,47,40) → (78,17,14),白字 → 灰),
 * 而 SVG 渲染器(<mask>/<text> DOM)是正确的。
 * 站点部署在 Cloudflare Pages(纯静态、必须跑在访客浏览器里),既没有服务端也不能用离线脚本,
 * 所以在浏览器内把 SVG 渲染器的每一帧栅格化:
 *   克隆 <svg> → 剔除预载图片 → 内联外链图片与字体(SVG 以 <img> 加载时禁止外部资源)
 *   → Blob URL → <img> → drawImage 到合成画布。
 * 编码、音频、进度、取消全部沿用原导出管线,只把「取帧」这一步换掉。 */
/* 统计动画里的遮罩相关图层:tt(轨道遮罩层,自身带 matte)、td(遮罩源层)、ty===5(文字层)。
 * 预合成要递归进去(图层自己的 layers,以及 assets 里的预合成),否则共用遮罩藏在预合成里就检测不到。 */
function countMatteLayers(data: any): { tt: number; td: number; text: number } {
  let tt = 0;
  let td = 0;
  let text = 0;
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l?.tt >= 1) tt += 1;
      if (l?.td) td += 1;
      if (l?.ty === 5) text += 1;
      if (Array.isArray(l?.layers)) walk(l.layers);
    }
  };
  walk(data?.layers);
  for (const a of data?.assets ?? []) if (Array.isArray(a?.layers)) walk(a.layers);
  return { tt, td, text };
}

/* 数据里是否存在「亮度遮罩」(轨道遮罩 tt:3)。
 * 背景:lottie-web 5.13.0 的 canvas 渲染器对亮度遮罩是坏的 —— 源码里 lumaLoader 是函数表达式却漏了
 * 调用括号(assetLoader 里写的是 lumaLoader.load,而 lumaLoader 本身是个未经调用的函数),
 * 于是 assetLoader.loadLumaCanvas === undefined;构建任何 tt>=3 的图层时 CVBaseElement.createContainerElements
 * 调用它会抛 TypeError,而异常正好落在 AnimationItem.configAnimation 的 try/catch 里被吞掉:
 * 后续 config_ready / DOMLoaded 都不会触发(预览停在加载态、画面全黑),导出取到的也是空帧。
 * SVG 渲染器用 SVG 滤镜(feColorMatrix)自己做亮度遮罩,不走这条路径,实测正常。
 * 所以含亮度遮罩的动画一律走 SVG:预览在切入时自动把渲染器切回 SVG(见 switchAnimation),
 * 导出由 needsSvgRasterExport 自动改走 SVG 逐帧光栅化。 */
function hasLumaMatte(data: any): boolean {
  let found = false;
  const walk = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l?.tt === 3) found = true;
      if (Array.isArray(l?.layers)) walk(l.layers);
    }
  };
  walk(data?.layers);
  for (const a of data?.assets ?? []) if (Array.isArray(a?.layers)) walk(a.layers);
  return found;
}

/* 需要兼容导出吗:被遮罩层(tt)多于遮罩源(td)说明遮罩源被共用,canvas 合成不可靠;
 * 另外含亮度遮罩(tt:3)的动画在 canvas 渲染器下根本构建不出来(见 hasLumaMatte),同样必须走 SVG。 */
function needsSvgRasterExport(data: any): boolean {
  // 判定是启发式:tt > td 只说明「有遮罩源被共用」,并不保证 canvas 一定出错;
  // 但兼容导出的代价只是更慢(SVG 逐帧光栅化),画面正确优先于速度,所以宁可多走这条路。
  const { tt, td } = countMatteLayers(data);
  return tt > td || hasLumaMatte(data);
}

/* 字体二进制 → 可复用的 blob URL。
 * 关键:栅格化每帧都会新建一份 SVG 文档,字体若用 data URI 内联,浏览器每帧都要重新 base64 解码
 * 并解析整份字体(实测 2.7MB WOFF2 ≈ 44ms/帧,占导出时间近一半);改用 blob URL 后浏览器按 URL
 * 复用已解析字体,同样的画面只要 3~9ms/帧。图片不能照搬:SVG 作为 <img> 时 blob:/外部图片会被拦掉。 */
const svgRasterFontBlobUrls: string[] = [];
function fontBytesToBlobUrl(buf: ArrayBuffer, mime: string): string {
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  svgRasterFontBlobUrls.push(url);
  return url;
}
// 释放本次导出创建的所有字体 blob URL(正常结束、失败、取消三条路径都会调到),
// 不释放的话反复导出会持续累积内存占用。
function releaseSvgRasterFontBlobUrls() {
  while (svgRasterFontBlobUrls.length) {
    const u = svgRasterFontBlobUrls.pop();
    if (u) URL.revokeObjectURL(u);
  }
}
// data URI 的 base64 主体 → 字节数组;atob 遇到非法字符会抛异常,这里捕获后返回 null(视为该字体不可用)
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/* 光栅化用字体 CSS:全部用 blob URL 引用(见上)。每次导出只构建一次,导出结束统一释放。 */
async function buildSvgRasterFontCss(list: any[]): Promise<string> {
  let css = '';
  const seen = new Set<string>();
  for (const fdef of list ?? []) {
    const fam = fdef?.fFamily || fdef?.fName;
    if (!fam || seen.has(fam)) continue;
    seen.add(fam);
    // 字体来源分两种:fPath 是 data URI 时直接转成 blob URL;
    // 否则按 fFamily/fName 解析到打包好的 WOFF2(优先,逐帧解析成本约减半)或 TTF,并校验文件头再使用。
    let uri = '';
    const fPath = typeof fdef?.fPath === 'string' ? fdef.fPath : '';
    if (fPath.startsWith('data:')) {
      const comma = fPath.indexOf(',');
      const meta = comma > 0 ? fPath.slice(0, comma) : '';
      const bytes = comma > 0 ? base64ToBytes(fPath.slice(comma + 1)) : null;
      if (!bytes) continue;
      const mime = /woff2/.test(meta) ? 'font/woff2' : /woff/.test(meta) ? 'font/woff' : 'font/ttf';
      uri = fontBytesToBlobUrl(bytes.buffer as ArrayBuffer, mime);
    } else {
      // 优先 WOFF2(体积约为 TTF 的一半,逐帧解析成本直接减半);没有再退回 TTF
      const woff2Url = resolveFontWoff2Url(fdef.fFamily, fdef.fName);
      const ttfUrl = resolveFontUrl(fdef.fFamily, fdef.fName);
      const url = woff2Url || ttfUrl;
      if (!url) continue;
      const buf = await fetchFontBinary(url);
      if (!buf || !looksLikeFontBuffer(buf)) continue;
      const mime = /woff2/.test(url) ? 'font/woff2' : 'font/ttf';
      uri = fontBytesToBlobUrl(buf, mime);
    }
    css += '@font-face{font-family:"' + fam + '";src:url("' + uri + '");}';
  }
  return css;
}

/* 把字体 CSS 包成 <style> 标签字符串:逐帧复用同一份字符串,序列化时只做一次字符串插入,
 * 不再每帧把 5MB 的 style 文本节点交给 XMLSerializer(实测这是每帧最大的开销之一) */
function svgRasterStyleTag(fontCss: string): string {
  if (!fontCss) return '';
  return '<style>' + fontCss.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>';
}

/* 上一帧的栅格结果:序列化结果完全一致时直接复用(动画里有不少静止段,省掉最贵的 SVG 解析) */
let svgRasterLastKey = '';
let svgRasterLastImg: HTMLImageElement | null = null;

/* 外链图片 → data URI 缓存(SVG 作为 <img> 加载时不能引用外部资源) */
const svgRasterImageCache = new Map<string, string>();
/* 外链图片 → data URI 并缓存(同一张图整个导出期间只读一次)。
 * 必须内联的原因:SVG 以 <img> 加载时是「禁止外部资源」的独立文档,外部 http/blob 图片会被静默丢弃(画面缺图)。 */
async function svgRasterInlineImage(href: string): Promise<string> {
  const hit = svgRasterImageCache.get(href);
  if (hit) return hit;
  const blob = await fetch(href).then((r) => r.blob());
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
  svgRasterImageCache.set(href, data);
  return data;
}

/* 把当前已渲染到 DOM 的一帧 SVG 光栅化并画到目标画布 */
async function rasterizeSvgFrameToCtx(
  svgEl: SVGSVGElement,
  octx: CanvasRenderingContext2D,
  w: number,
  h: number,
  styleTag: string,
): Promise<boolean> {
  const NS_SVG = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  /* 剔除 lottie 的图片预载元素与字体 <style>。
   * ⚠ 必须用**直接子选择器** defs > image:预载元素是 <defs> 的直接子节点,
   * 而 mask 引用的**遮罩源**是 <defs> 里 <g id=…> 的子节点 —— 用后代选择器会把遮罩源一起删掉,
   * 蒙版随即变空,导出画面里整条蒙版动画直接消失(实测:导出丢蒙版,预览正常)。 */
  clone.querySelectorAll('defs > image').forEach((n) => n.remove());
  clone.querySelectorAll('defs style').forEach((n) => n.remove());
  // 强制按导出尺寸重建视口:clone 沿用了 lottie 写在 <svg> 上的尺寸属性,
  // 不覆盖的话 <img> 会按原尺寸呈现,合成到输出画布上位置和大小都会错位。
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  /* 修剪「本帧不可见」的图层子树:lottie 用 display:none 表示图层不在当前帧的区间内,
   * 黑潮爆破的逐帧序列同时挂着 696 层、任一时刻只有 1 层可见 —— 不修剪的话每帧都要序列化
   * 700 个 <image>(实测 0.35 秒/帧、258 帧要 90 多秒,画面还更容易出错)。
   * 但被 mask / clip-path / filter / <use> 引用到的元素(及其祖先)必须保留:
   * 轨道遮罩的**源图层**本身就常常是 display:none,删了蒙版就空了。 */
  const referencedIds = new Set<string>();
  clone.querySelectorAll('[mask],[clip-path],[filter],use').forEach((n) => {
    for (const attr of ['mask', 'clip-path', 'filter']) {
      const v = n.getAttribute(attr);
      if (!v) continue;
      const m = /#([^)"'\s]+)/.exec(v);
      if (m) referencedIds.add(m[1]);
    }
    const href = n.getAttribute('href') || n.getAttributeNS(XLINK, 'href');
    if (href && href.charAt(0) === '#') referencedIds.add(href.slice(1));
  });
  const mustKeep = new Set<Element>();
  referencedIds.forEach((id) => {
    const el = clone.querySelector('#' + CSS.escape(id));
    let node: Element | null = el;
    while (node && node !== clone) { mustKeep.add(node); node = node.parentElement; }
  });
  for (const n of Array.from(clone.querySelectorAll('[style*="display: none"]'))) {
    if (mustKeep.has(n) || !n.parentNode) continue;
    n.parentNode.removeChild(n);
  }
  const imgs = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
  // 逐个内联 <image> 的地址:同时写 xlink:href 与 href 两份(SVG 2 解析器读 href,老解析器只认 xlink:href),
  // 本来就是 data: 的跳过;单张图失败不阻断整帧。
  for (const im of imgs) {
    const href = im.getAttributeNS(XLINK, 'href') || im.getAttribute('href') || '';
    if (!href || href.startsWith('data:')) continue;
    try {
      const data = await svgRasterInlineImage(href);
      im.setAttributeNS(XLINK, 'href', data);
      im.setAttribute('href', data);
    } catch { /* 单张图片失败不阻断整帧 */ }
  }
  // 叠加序列调色用的是 SVG filter(feColorMatrix),滤镜定义挂在站点的隐藏 <svg> 里。
  // 序列化出来的这份 SVG 会被当作「独立文档」用 <img> 加载,看不到外部文档的滤镜定义,
  // 于是样式里的 filter:url(#...) 解析不到 → 导出画面退回素材原色(用户改的颜色丢失)。
  // 所以必须把滤镜定义一并复制进这份 SVG。
  if (seqTintSvg) {
    const tintDefs = seqTintSvg.querySelector('defs');
    if (tintDefs && tintDefs.childNodes.length) {
      const copied = tintDefs.cloneNode(true) as Element;
      const ownDefs = clone.querySelector('defs');
      if (ownDefs) ownDefs.appendChild(copied);
      else clone.insertBefore(copied, clone.firstChild);
    }
  }
  let serialized = new XMLSerializer().serializeToString(clone);
  // 字体 <style> 只做一次字符串插入(在 <svg ...> 开标签之后)
  if (styleTag) serialized = serialized.replace(/<svg[^>]*>/, (m) => m + styleTag);
  // 与上一帧完全相同(静止段):直接复用上一帧的图片,跳过整段 SVG 解析
  if (svgRasterLastImg && svgRasterLastKey === serialized) {
    octx.drawImage(svgRasterLastImg, 0, 0, w, h);
    return true;
  }
  // 用 Blob URL 而不是 data URI:data URI 每帧都要把整份 SVG(数 MB)base64 编码一遍,
  // 字符串还会膨胀约 1/3;Blob URL 由浏览器直接持有字节,解码完立刻 revoke。
  const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.width = w;
    img.height = h;
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!loaded) return false;
    octx.drawImage(img, 0, 0, w, h);
    svgRasterLastKey = serialized;
    svgRasterLastImg = img;
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* 视频导出总入口(导出按钮点击)。
 * 在页面上另建一套离屏渲染器(与预览实例隔离),用一张合成画布把「背景 + 主动画 + 弹窗」叠起来,
 * 再按所选格式交给对应的导出函数(MP4 / AVI-H.264 / AVI 无压缩透明 / AVI-MJPEG 回退)。
 * 进度浮层、取消、以及导出结束后恢复预览播放状态都在这里统一处理。 */
async function exportVideo() {
  if (exporting || !currentData) return;
  exporting = true;
  btnExport.disabled = true;
  const data = currentData;
  // 透明背景不支持 MP4:勾选透明时无论格式选择如何,一律自动导出 AVI
  const wantTransparent = chkTransparent.checked;
  const format = wantTransparent ? 'avi' : selFormat.value;
  const w = data.w, h = data.h;
  /* 输出帧率固定规则(不给用户选项):
   * 预览是 lottie 的「分数帧」渲染——动画自身只有 30fps 时,浏览器仍按屏幕刷新率
   * 对关键帧做插值,每秒画出上百个平滑位置,所以预览看着很顺;
   * 而导出若照搬动画的 30fps,画面就只有 30 个位置/秒:缓动、表达式这类慢速运动
   * 看着就是「30 帧」卡顿,快速位移的图层则不太明显。
   * 因此导出帧率取 max(动画帧率, 60):30fps 动画导出 60fps(输出帧映射到小数动画帧,
   * lottie 线性插值),60fps 动画与原来完全一致,更高帧率的动画不降采样。 */
  const srcFps = data.fr || 60;
  // 帧率上限 240 是护栏:源动画帧率再高也不超过它(正常素材远到不了)
  const fr = Math.min(240, Math.max(60, Math.round(srcFps)));
  const srcFrames = Math.max(1, Math.round((data.op ?? 0) - (data.ip ?? 0)));
  const totalFrames = Math.max(1, Math.round((srcFrames / srcFps) * fr));   // 时长不变,帧数按倍率增加
  const animFrameOf = (i: number) => (data.ip ?? 0) + (i * srcFps) / fr;    // 可为小数
  const withPopup = popupVisible && !!popupData;
  const popupTag = withPopup ? ' · 含弹窗' : '';
  // 无压缩透明 AVI 的体积 ≈ 宽 × 高 × 4 字节(BGRA)× 帧数,不含音频与封装开销
  const dibBytes = w * h * 4 * totalFrames;
  const formatLabel = (format === 'avi'
    ? (wantTransparent ? 'AVI · 无压缩透明' : 'AVI · H.264')
    : 'MP4 · H.264') + ' · ' + fr + 'fps' + (fr !== srcFps ? '(插值)' : '') + popupTag;
  const warn = wantTransparent
    ? '透明 AVI 为无压缩编码,预计文件约 ' + fmtSize(dibBytes) + ';已采用预乘 alpha(premultiplied),与 PotPlayer/Windows 渲染语义一致,半透明组件可正常显示。导出期间请勿关闭页面。'
    : undefined;
  showExportOverlay({ formatLabel, warn });

  /* 手机上的无压缩透明 AVI:全部帧都要先在内存里排好(宽×高×4 字节 × 帧数),
   * 1080p 十秒就是 5 GB —— 手机标签页的内存配额远不到这个量级,必然崩。
   * 这里提前拦下并说清楚怎么办,而不是让用户等几分钟后看到页面崩掉。 */
  if (wantTransparent && IS_MOBILE && dibBytes > 8e8) {
    throw new Error('手机上无法导出无压缩透明 AVI:预计文件 ' + fmtSize(dibBytes) + ',浏览器内存放不下。'
      + '请改用 MP4 / AVI(取消勾选「透明背景」),或在电脑上导出透明版本。');
  }

  /* 编码方案:按分辨率档位 + 本机能力选定「真正要编码的尺寸」。
   * 这是移动端加固的核心 —— 手机编不了 4K 时自动降到它能编的尺寸,而不是直接报错。 */
  const resMode = selRes.value;
  const reqScale = resMode === 'auto' ? baseExportScale(w, h) : Math.max(0.1, parseFloat(resMode) || 1);
  updateExportProgress(0, '正在探测本机编码能力…', '');
  const plan = wantTransparent ? null : await resolveH264Plan(w, h, fr, reqScale);
  /* 编码帧数 / 帧率:方案若把帧率降到 30,就按整帧步进取帧(帧数减半、时间戳按新帧率写),
   * 成片时长不变。没有方案(透明 AVI、MJPEG 回退、兼容录制)时按原始 60fps 走。 */
  const stepOfPlan = (p: H264Plan) => Math.max(1, Math.round(fr / p.fps));
  const framesOfPlan = (p: H264Plan) => Math.max(1, Math.floor(totalFrames / stepOfPlan(p)));
  const animFrameOfPlan = (p: H264Plan) => (i: number) => animFrameOf(i * stepOfPlan(p));
  const lowRes = !!plan && (plan.width !== w || plan.height !== h || plan.fps !== fr);
  if (plan) {
    // 把实际编码规格写进浮层标题:用户随时看得到「这段视频到底按什么规格在导」
    exportFormatTag.textContent = formatLabel
      + (lowRes ? ' → ' + plan.width + '×' + plan.height + '@' + plan.fps : '');
  }
  updateExportProgress(0, '正在初始化渲染器…', '');
  /* 兼容导出:遮罩源被共用的动画自动改用 SVG 渲染器逐帧光栅化(canvas 渲染器遮罩合成不正确) */
  const useRaster = needsSvgRasterExport(data);
  let container: HTMLDivElement | null = null;
  let renderAnim: AnimationItem | null = null;
  let popupExportContainer: HTMLDivElement | null = null;
  let popupExportAnim: AnimationItem | null = null;
  let popupExportCanvas: HTMLCanvasElement | null = null;
  /* 导出期间暂停预览(含预览音频):预览一边播放一边渲染会和导出抢 CPU/GPU,
   * 高负载下浏览器音频线程被拖到丢样,听感就是「滋啦」;顺带也让导出更快。 */
  const previewWasPlaying = !!(anim && anim.isLoaded && !anim.isPaused);
  if (previewWasPlaying && anim) { try { anim.pause(); } catch { /* ignore */ } }
  if (popupAnim) { try { popupAnim.pause(); } catch { /* ignore */ } }
  try {
    setStatus(wantTransparent
      ? '导出中: 已选透明背景,自动导出 AVI…'
      : '导出中: 初始化渲染器…');
    /* 屏幕常亮:手机导出期间屏幕一黑,系统就会冻结/回收标签页,导出直接「卡住不动」。
     * 申请失败(不支持或被系统拒绝)不影响导出,所以这里不 await 结果。 */
    void acquireExportWakeLock();
    // 导出容器挂在文档里但推到视口外(left:-10000px):渲染器必须在文档中才能正确测量与绘制,
    // 又不能被用户看到;dpr:1 让渲染像素 = 动画坐标像素,取帧时不需要任何缩放换算。
    container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:' + h + 'px;';
    document.body.appendChild(container);
    // 另建一个独立 AnimationItem,不复用预览实例:导出要按帧号直渲(renderer.renderFrame),
    // 复用会把用户的预览位置一并搞乱;音频仍走 audioFactory,避免 lottie 内部找不到 Howl 时报错。
    renderAnim = lottie.loadAnimation({
      container,
      renderer: useRaster ? 'svg' : 'canvas',
      rendererSettings: { dpr: 1 },
      loop: false,
      autoplay: false,
      animationData: data,
      audioFactory,
    });
    if (useRaster) {
      // SVG 渲染器同样要打站点的补丁:序列帧逐帧换图、AE 投影、overflow 等都在这里生效
      patchSvgRendererTree((renderAnim as any).renderer);
      // lottie 的图片预载元素(序列帧 720 张)只作缓存、不在画面上:导出期间先从 DOM 摘掉,
      // 这样每帧克隆/序列化的节点数从 ~740 降到 ~20(实测每帧省 ~90ms)
      const svgRoot = (renderAnim as any).renderer?.svgElement as SVGSVGElement | null;
      if (svgRoot) {
        /* ⚠ 必须是**直接子选择器** defs > image(与下方栅格化一致):
         * 预载图片是 <defs> 的直接子节点,而遮罩源图层是 <defs> 里 <g id=…> 的子节点 ——
         * 用后代选择器会把导出实例自己的遮罩源删掉,蒙版随即变空,导出视频里整条蒙版动画直接消失。 */
        svgRoot.querySelectorAll('defs > image').forEach((n) => n.remove());
        // lottie 会把字体 base64(TTF,约 5MB)塞进 <defs><style>:栅格化时改用下面注入的 WOFF2 版本,
        // 否则每帧要白白序列化+解析两份字体(实测这是导出最慢的一环)
        svgRoot.querySelectorAll('defs > style').forEach((n) => n.remove());
      }
    } else {
      patchExportCanvasRenderer((renderAnim as any).renderer);
    }
    // canvas 渲染器:lottie 把 <canvas> 建在容器里,取出它当「动画层」,每帧 drawImage 到合成画布
    let canvas: HTMLCanvasElement | null = null;
    if (!useRaster) {
      canvas = container.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) throw new Error('无法创建渲染画布');
    }
    // 兼容导出的字体 <style>(只构建一次):主动画 + 弹窗的文字都要能在栅格化时正确排版
    const rasterStyleTag = useRaster
      ? svgRasterStyleTag(await buildSvgRasterFontCss([...(data?.fonts?.list ?? []), ...(withPopup ? popupData?.fonts?.list ?? [] : [])]))
      : '';
    // 弹窗合成:导出时若开启弹窗,用同一帧号驱动弹窗渲染器,叠加到主动画之上
    if (withPopup) {
      // 弹窗文字要先注册自带字体(FontFace):否则量文本宽度时用的是系统字体,排版会错位
      await loadEmbeddedFonts(popupData);
      popupExportContainer = document.createElement('div');
      popupExportContainer.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:' + h + 'px;';
      document.body.appendChild(popupExportContainer);
      popupExportAnim = lottie.loadAnimation({
        container: popupExportContainer,
        renderer: useRaster ? 'svg' : 'canvas',
        rendererSettings: { dpr: 1 },
        loop: false,
        autoplay: false,
        animationData: popupData,
        audioFactory,
      });
      if (useRaster) {
        patchSvgRendererTree((popupExportAnim as any).renderer);
      } else {
        patchExportCanvasRenderer((popupExportAnim as any).renderer);
        popupExportCanvas = popupExportContainer.querySelector('canvas') as HTMLCanvasElement | null;
        if (!popupExportCanvas) throw new Error('无法创建弹窗渲染画布');
      }
    }
    // 合成画布:背景 + 主动画 + 弹窗(透明模式不填充背景,保留 alpha)
    const bg: string | null = wantTransparent ? null : bgColor.value;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext('2d');
    if (!octx) throw new Error('无法创建导出画布');
    // DEV 调试钩子:把合成画布与动画画布暴露出来,便于在浏览器里逐帧核对导出到底取了什么画面
    if (import.meta.env.DEV) { (window as any).__exportCanvas = outCanvas; (window as any).__exportLottieCanvas = canvas; }
    /* 导出自检:逐帧记录「合成画面」指纹,统计与上一帧完全相同的帧数。
     * 用途:导出后画面看起来只有 30fps 时,先分清是「渲染侧丢了帧」还是
     * 「编码器/播放器把同一帧显示了两次」——自检报重复帧 → 渲染侧问题(有确切帧号);
     * 自检为 0 但播放仍重复 → 编码/播放侧问题(与渲染无关)。 */
    // 自检缩略图 240×135(约 3.2 万像素):把合成帧缩到小图再取像素做指纹,
    // 即便是 4K 帧也只读这么点数据,单帧成本不到 1ms,不会拖慢导出。
    /* 自检要把每帧从 GPU 读回 CPU(getImageData),手机上每帧要几毫秒、还会打断渲染管线,
     * 所以移动端整个跳过 —— 它只是「导出结果看着卡顿」时用来归因的诊断信息,不影响成片。 */
    const wantSelfCheck = !IS_MOBILE;
    const checkCanvas = document.createElement('canvas');
    checkCanvas.width = 240; checkCanvas.height = 135;
    const checkCtx = checkCanvas.getContext('2d', { willReadFrequently: true });
    let prevSig = -1, dupFrames = 0, firstDup = -1, checkedFrames = 0;
    const frameSignature = (): number => {
      if (!wantSelfCheck || !checkCtx) return -1;
      checkCtx.clearRect(0, 0, 240, 135);
      checkCtx.drawImage(outCanvas, 0, 0, 240, 135);
      const d = checkCtx.getImageData(0, 0, 240, 135).data;
      let h = 2166136261 >>> 0;
      for (let k = 0; k < d.length; k++) { h ^= d[k]; h = Math.imul(h, 16777619) >>> 0; }
      return h;
    };
    /* 每帧渲染回调,参数 n 是【动画帧号】(可为小数,由 animFrameOf 映射得到):
     * 顺序与 lottie 的 AnimationItem.renderFrame 保持一致 —— 先同步表达式与帧状态,再整帧强制重绘;
     * 主动画与弹窗各渲染一次,然后依次叠到合成画布(透明模式不铺背景,保留 alpha)。
     * 兼容导出时这里换成 SVG 光栅化,下游的编码 / 音频 / 进度完全无感。 */
    const renderFrame = async (n: number) => {
      const __t0 = import.meta.env.DEV ? performance.now() : 0;
      // 顺序与 lottie 的 AnimationItem.renderFrame 一致:先同步表达式/帧状态,再整帧强制重绘
      syncAnimFrameForExport(renderAnim, n);
      (renderAnim as any).renderer.renderFrame(n, true);
      if (popupExportAnim) {
        syncAnimFrameForExport(popupExportAnim, n);
        (popupExportAnim as any).renderer.renderFrame(n, true);
      }
      // 每帧先清空合成画布!!!透明模式之前缺失:历史帧全部叠加进当前帧 = 残影(上一帧不消失)
      octx.clearRect(0, 0, w, h);
      // 动画画布保持透明,背景通过合成画布垫在下方,避免破坏轨道遮罩合成
      if (bg) {
        octx.fillStyle = bg;
        octx.fillRect(0, 0, w, h);
      }
      if (useRaster) {
        // 兼容导出:把主/弹窗这一帧的 SVG 各自光栅化后叠加(与 SVG 预览完全一致)
        const __tr = import.meta.env.DEV ? performance.now() : 0;
        const mainSvg = (renderAnim as any).renderer?.svgElement as SVGSVGElement | null;
        if (mainSvg) await rasterizeSvgFrameToCtx(mainSvg, octx, w, h, rasterStyleTag);
        const popupSvg = popupExportAnim ? ((popupExportAnim as any).renderer?.svgElement as SVGSVGElement | null) : null;
        if (popupSvg) await rasterizeSvgFrameToCtx(popupSvg, octx, w, h, rasterStyleTag);
        // DEV 性能统计:把光栅化耗时(rasterMs)与整帧耗时(totalMs)累计到 window.__exportStats,
        // 便于在控制台快速判断导出瓶颈在渲染还是在编码;生产构建里这段会被摇掉。
        if (import.meta.env.DEV) {
          const st = (window as any).__exportStats || ((window as any).__exportStats = { frames: 0, rasterMs: 0, totalMs: 0 });
          st.rasterMs += performance.now() - __tr;
        }
      } else {
        octx.drawImage(canvas as HTMLCanvasElement, 0, 0);
        if (popupExportCanvas) octx.drawImage(popupExportCanvas, 0, 0);
      }
      if (import.meta.env.DEV) {
        const st = (window as any).__exportStats || ((window as any).__exportStats = { frames: 0, rasterMs: 0, totalMs: 0 });
        st.frames += 1;
        st.totalMs += performance.now() - __t0;
      }
      // 自检指纹(96×54 缩放哈希,每帧 <1ms)
      const sig = frameSignature();
      if (sig !== -1) {
        if (prevSig === sig) { dupFrames++; if (firstDup < 0) firstDup = checkedFrames; }
        prevSig = sig;
        checkedFrames++;
      }
    };
    // 各导出函数统一从合成画布取帧:它们只管编码与封装,不关心画面上叠了哪些图层
    const srcCanvas = outCanvas;

    // 走兼容录制(本机没有 H.264 编码器)时,尾部文案要换一套说法
    let usedRecorder = false;

    /* 格式分发 —— 每条路都要能在手机上走通:
     *  AVI + 透明   → 无压缩 BGRA,不经过编码器(手机上的内存护栏见上方 dibBytes 那段);
     *  AVI + 非透明 → 有方案走 H.264,方案被拒或压根没有就退 MJPEG 兼容格式(老浏览器也能出片);
     *  MP4         → H.264 是唯一通路:先按方案导,被拒时自动降一档重试,
     *                完全没有可用方案时改走 MediaRecorder 兼容录制(录出 MP4 或 WebM,手机上能直接播)。 */
    const onAviH264 = (p: number, detail?: string) => {
      updateExportProgress(p, '正在导出 AVI(H.264)', detail ?? '');
      setStatus('导出 AVI(H.264): ' + p + '%');
    };
    const onMjpeg = (p: number, detail?: string) => {
      updateExportProgress(p, '正在导出 AVI(MJPEG 兼容格式)', detail ?? '');
      setStatus('导出 AVI(MJPEG): ' + p + '%');
    };
    const onMp4 = (p: number, detail?: string) => {
      updateExportProgress(p, usedRecorder ? '正在兼容录制' : '正在导出 MP4(H.264)', detail ?? '');
      setStatus((usedRecorder ? '兼容录制: ' : '导出 MP4: ') + p + '%');
    };

    if (format === 'avi') {
      if (wantTransparent) {
        await exportVideoAvi(data, srcCanvas, renderFrame, totalFrames, fr, (p, detail) => {
          updateExportProgress(p, '正在导出透明 AVI(无压缩)', detail ?? '');
          setStatus('导出透明 AVI(无压缩): ' + p + '%');
        }, 'dib', animFrameOf);
      } else if (plan) {
        try {
          await exportVideoAviH264(data, srcCanvas, renderFrame, framesOfPlan(plan), plan.fps, onAviH264, plan, animFrameOfPlan(plan));
        } catch (e) {
          // 取消照原样抛出;只有「本机编不了这个尺寸」才降级到 MJPEG
          if (!(e instanceof EncoderConfigError)) throw e;
          updateExportProgress(0, 'H.264 编码不可用,改用兼容格式(MJPEG)…', (e as Error).message);
          exportFormatTag.textContent = 'AVI · MJPEG 兼容格式 · ' + fr + 'fps' + popupTag;
          await exportVideoAvi(data, srcCanvas, renderFrame, totalFrames, fr, onMjpeg, 'mjpeg', animFrameOf);
        }
      } else {
        updateExportProgress(0, '本机没有可用的 H.264 编码器,改用兼容格式(MJPEG)…', encodeSupportSummary());
        exportFormatTag.textContent = 'AVI · MJPEG 兼容格式 · ' + fr + 'fps' + popupTag;
        await exportVideoAvi(data, srcCanvas, renderFrame, totalFrames, fr, onMjpeg, 'mjpeg', animFrameOf);
      }
    } else if (plan) {
      try {
        await exportVideoMp4(data, srcCanvas, renderFrame, framesOfPlan(plan), plan.fps, onMp4, plan, animFrameOfPlan(plan));
      } catch (e) {
        /* 少数浏览器会先答「支持」再在 configure / encode 时拒绝(见 H.264 选级那段注释)。
         * 这时按更低一档重来一次,总好过让用户对着报错自己再点一遍导出。 */
        if (!(e instanceof EncoderConfigError)) throw e;
        const lower = await resolveH264Plan(w, h, fr, Math.max(0.2, plan.scale * 0.7));
        if (!lower || (lower.width >= plan.width && lower.height >= plan.height)) throw e;
        updateExportProgress(0, '编码器拒绝了 ' + plan.width + '×' + plan.height + ',正在按 ' + lower.width + '×' + lower.height + ' 重试…', (e as Error).message);
        exportFormatTag.textContent = formatLabel + ' → ' + lower.width + '×' + lower.height + '@' + lower.fps + '(重试)';
        await exportVideoMp4(data, srcCanvas, renderFrame, framesOfPlan(lower), lower.fps, onMp4, lower, animFrameOfPlan(lower));
      }
    } else {
      usedRecorder = true;
      updateExportProgress(0, '本机没有可用的 H.264 编码器,改用兼容录制…', encodeSupportSummary());
      // 浮层标题如实反映真实路径:这条录出来可能是 MP4,也可能是 WebM
      exportFormatTag.textContent = '兼容录制(无音轨) · ' + fr + 'fps' + popupTag;
      await exportVideoRecorder(srcCanvas, renderFrame, totalFrames, fr, onMp4, animFrameOf);
    }
    /* 重复帧占比很高(如约一半)时,更可能是「动画内容本身按 30fps 更新」:
     * 表达式里做时间量化(posterizeTime(30)、Math.floor(time*30)/30 等)、
     * 或 AE 里按半速/步进打的关键帧,都会让 60fps 视频每隔一帧才换一次画面。 */
    const dupNote = !wantSelfCheck
      ? ' · 移动端已跳过逐帧自检'
      : dupFrames === 0
        ? ' · 自检:未发现重复帧'
        : ' · 自检:' + dupFrames + '/' + checkedFrames + ' 帧与上一帧完全相同' + (firstDup >= 0 ? '(首处 #' + firstDup + ')' : '')
          + '(画面静止段或运动极慢时属正常,不代表导出丢帧)';
    /* 手机上下载经常「提示完成了,但相册里找不到」:把引导写进完成提示,
     * 配合浮层上那两个按钮(保存到手机 / 重新下载)给出一条明确的落地路径。 */
    const saveTip = IS_MOBILE
      ? '文件已开始下载;若相册 / 文件里没看到,点下方「保存到手机」。'
      : '文件已开始下载';
    const recNote = usedRecorder ? ' · 兼容录制模式(无音轨,时长可能与原动画略有出入)' : '';
    finishExportOverlay('done', '导出完成', saveTip + dupNote + recNote);
    setStatus('导出完成' + dupNote);
  // 取消与失败分开处理:取消是用户主动行为,静默收尾即可;失败要打完整堆栈并回显可读原因
  } catch (e) {
    if (e instanceof ExportCancelledError) {
      finishExportOverlay('cancel', '已取消导出', '未生成文件');
      setStatus('导出已取消');
    } else {
      console.error('[导出错误]', (e as Error).stack || e);
      const msg = (e as Error).message || String(e);
      /* 编码相关的失败额外附一行本机能力摘要:远程排障时(用户截图发过来)
       * 一眼就能分清是「浏览器没有 WebCodecs」「不是安全上下文」还是「编码器不认这个分辨率」。 */
      const hint = /H\.264|编码|WebCodecs/.test(msg) ? ' · 本机:' + encodeSupportSummary() : '';
      finishExportOverlay('error', '导出失败', msg + hint);
      setStatus('导出失败: ' + msg, true);
    }
  // 收尾(成功 / 失败 / 取消都会走到):释放字体 blob URL、销毁导出专用渲染器与容器、解除按钮锁,
  // 并恢复导出前的预览播放状态(导出开始时被主动暂停,见 previewWasPlaying)。
  } finally {
    releaseSvgRasterFontBlobUrls();
    if (renderAnim) { try { renderAnim.destroy(); } catch { /* ignore */ } }
    if (container) container.remove();
    if (popupExportAnim) { try { popupExportAnim.destroy(); } catch { /* ignore */ } }
    if (popupExportContainer) popupExportContainer.remove();
    // 恢复导出前的预览播放状态(含音频)
    if (previewWasPlaying && anim) { try { anim.play(); } catch { /* ignore */ } }
    releaseExportWakeLock();
    exporting = false;
    btnExport.disabled = false;
  }
}

// 导出按钮:所有选项(格式 / 透明 / 背景色 / 弹窗)都在 exportVideo 内部实时读取
btnExport.addEventListener('click', exportVideo);

/* ==================== 动画选择器(顶栏触发器 + 画廊浮层) ====================
 *
 * 要改选择动画的界面,只有三个地方需要看:
 *   1) 动画有哪些、各自叫什么/什么规格  —— 文件上方的 ANIMATIONS 注册表(新增动画只加一项);
 *   2) 动态部分(卡片怎么生成、搜索/键盘怎么响应) —— 就是本区块,函数顺序如下;
 *   3) 外观(尺寸、配色、动效) —— style.css 里「动画画廊」那一段(以 .anim-picker / .ap- 开头)。
 * 骨架(搜索框、网格容器、底部提示)在 index.html 的 #animPicker 里,id 与本区块的 DOM 引用一一对应。
 *
 * 本区块的阅读顺序:
 *   DOM 引用 → 「最近使用」读写 → 卡片规格(含实测校准)→ 过滤排序 → 渲染卡片 →
 *   键盘光标 → 顶栏触发器同步 → 开/关/选中 → 事件绑定 → 初始化
 *
 * 设计取向是「薄」:没有分组、没有收藏、没有简介。打开就是一份按「最近用过的在前」
 * 排好的完整列表 —— 多数时候第一眼就是想要的,点一下即走;要精确定位就直接打字过滤。
 * 键盘全程不用挪焦点(打开即聚焦搜索框),方向键 / Enter / 数字 1–9 都能直接用。
 *
 * 顶栏那条隐藏的原生 select(#selAnim)是给历史校验脚本用的程序化切换入口,
 * 它的 options 由本区块末尾按注册表生成,不要删。
 *
 * 常见改动从哪儿下手:
 *   • 卡片大小 / 一屏放几张        → style.css 的 .ap-grid(grid-template-columns 里的最小列宽)
 *   • 卡片上显示哪些信息           → renderAnimGallery 里拼卡片 HTML 的那段 + 注册项的 meta
 *   • 排序规则                     → animVisibleList 末尾的 sort
 *   • 新增/修改快捷键              → 下面「画廊内的键盘」那个 document keydown
 *   • 面板标题文案                 → renderAnimGallery 末尾写 animPickerSub 的那两行
 *   • 去掉搜索框                   → 删 index.html 里的 .ap-search、本区块的 animSearch /
 *                                    animSearchClear 两个 DOM 引用,以及它们的 input / click 监听
 */
const animTrigger = $<HTMLButtonElement>('animTrigger');
const animTriggerThumb = $<HTMLImageElement>('animTriggerThumb');
const animTriggerName = $<HTMLElement>('animTriggerName');
const animTriggerMeta = $<HTMLElement>('animTriggerMeta');
const animTriggerCount = $<HTMLElement>('animTriggerCount');
const animPicker = $<HTMLDivElement>('animPicker');
const animPickerBackdrop = $<HTMLDivElement>('animPickerBackdrop');
const animPickerClose = $<HTMLButtonElement>('animPickerClose');
const animPickerSub = $<HTMLElement>('animPickerSub');
const animSearch = $<HTMLInputElement>('animSearch');
const animSearchClear = $<HTMLButtonElement>('animSearchClear');
const animGrid = $<HTMLDivElement>('animGrid');
const animPickerBody = $<HTMLDivElement>('animPickerBody'); // 网格的滚动容器(滚轮转发用)
const animEmpty = $<HTMLDivElement>('animEmpty');
const animEmptyText = $<HTMLElement>('animEmptyText');
const selAnim = $<HTMLSelectElement>('selAnim'); // 兼容层:程序化切换入口

/* 「最近使用」:只存 key 数组,没有任何界面元素 —— 用过的动画下次打开就排在前面,
 * 属于纯自动的顺手优化,用户不需要关心也不需要操作。localStorage 不可用时静默降级。 */
const ANIM_PREFS_KEY = 'dfa.animPicker.v1';
let animRecent: string[] = [];
function loadAnimPrefs() {
  try {
    const raw = localStorage.getItem(ANIM_PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as { recent?: unknown }) : {};
    // 只保留注册表里还存在的 key:删掉一套动画后,残留的脏数据不会影响排序
    animRecent = (Array.isArray(p.recent) ? p.recent : [])
      .filter((k): k is string => typeof k === 'string' && !!animDef(k));
  } catch {
    animRecent = [];
  }
}
function saveAnimPrefs() {
  try { localStorage.setItem(ANIM_PREFS_KEY, JSON.stringify({ recent: animRecent })); } catch { /* 忽略 */ }
}
/* 切换成功后把该动画提到「最近使用」最前(只留 3 个,避免最近列表无限膨胀) */
function noteAnimUsed(key: string) {
  animRecent = [key, ...animRecent.filter((k) => k !== key)].slice(0, 3);
  saveAnimPrefs();
}

/* 载入过的动画用实测值校准卡片上的规格(注册表里的声明值只要求大致准确):
 * 换掉某套动画的 JSON 之后,只要进过一次,画廊显示的就是真实尺寸/帧率。
 * 总帧数对「时长可调」的动画(exposed)不校准 —— 它会随用户拖时长滑杆变化,不代表这套动画本身多长。 */
const animMeasured = new Map<string, { w: number; h: number; fps: number; frames?: number }>();
function measureAnim(def: AnimDef) {
  const d = def.data();
  if (!d) return;
  const prev = animMeasured.get(def.key);
  animMeasured.set(def.key, {
    w: Number(d.w) || def.meta.w,
    h: Number(d.h) || def.meta.h,
    fps: Number(d.fr) || def.meta.fps,
    frames: def.caps.timing ? prev?.frames : ((Number(d.op) || 0) - (Number(d.ip) || 0) || def.meta.frames),
  });
}
function animMetaOf(def: AnimDef) {
  const m = def.meta;
  const x = animMeasured.get(def.key);
  return {
    tags: m.tags, accent: m.accent, features: m.features,
    w: x?.w ?? m.w, h: x?.h ?? m.h, fps: x?.fps ?? m.fps,
    // frames 校准后可能为 undefined(时长可调且还没测过),回落到声明值
    frames: x?.frames ?? m.frames,
  };
}
/* 时长 = 总帧数 / 帧率,保留两位再去掉多余的 0(10.15s / 6s) */
function animDurationLabel(frames: number, fps: number) {
  if (!frames || !fps) return '—';
  return String(Number((frames / fps).toFixed(2))) + 's';
}

/* 画廊的临时状态:搜索词 / 键盘光标位置 */
let animQuery = '';
let animCursor = 0;
let animLastFocus: HTMLElement | null = null;

function animPickerOpen() { return !animPicker.hidden; }

/* 过滤 + 排序:搜索命中 → 最近用过的排前面(其余保持注册表顺序)。
 * 排序只用「最近使用」,没有收藏、没有分组 —— 打开就按最可能想要的顺序摆好,不需要用户先做任何筛选。 */
function animVisibleList(): AnimDef[] {
  const q = animQuery.trim().toLowerCase();
  const hit = ANIMATIONS.filter((def) => {
    if (!q) return true;
    const m = animMetaOf(def);
    return [def.label, def.key, ...m.tags, ...m.features].join(' ').toLowerCase().includes(q);
  });
  return hit.slice().sort((a, b) => {
    const ra = animRecent.indexOf(a.key);
    const rb = animRecent.indexOf(b.key);
    const ka = ra < 0 ? animRecent.length + ANIMATIONS.indexOf(a) : ra;
    const kb = rb < 0 ? animRecent.length + ANIMATIONS.indexOf(b) : rb;
    return ka - kb;
  });
}

/* 重画卡片网格。整段重写 innerHTML:卡片数量、排序、选中态都随一次交互整体变化,
 * 逐个打补丁反而更容易漏(与侧栏各列表同一套做法);事件用委托挂在容器上,不随重画失效。 */
function renderAnimGallery() {
  const list = animVisibleList();
  const searching = animQuery.trim().length > 0;
  animGrid.classList.toggle('is-searching', searching);
  animGrid.innerHTML = list.map((def, i) => {
    const m = animMetaOf(def);
    const isCurrent = def.key === currentAnimKey;
    const specs = m.w + '×' + m.h +
      '<i>·</i>' + m.fps + 'fps' +
      '<i>·</i>' + animDurationLabel(m.frames, m.fps);
    const feats = m.features.slice(0, 2)
      .map((f) => '<span class="ap-feat">' + esc(f) + '</span>')
      .concat(def.audioUrl ? ['<span class="ap-feat is-audio">含音效</span>'] : ['<span class="ap-feat is-mute">无音效</span>'])
      .join('');
    /* 序号角标就是「数字键直选」的提示:只给前 9 张编号(键盘就只认 1–9),
     * 搜索态下整体隐藏(见 CSS 的 .is-searching),因为那时数字键是搜索输入而不是快捷键。 */
    const num = (!searching && i < 9) ? '<span class="ap-card-num">' + (i + 1) + '</span>' : '';
    // 悬停提示 = 动作 + 快捷键,无需去底部找说明
    const tip = isCurrent
      ? '「' + def.label + '」正在编辑中'
      : '切换到「' + def.label + '」' + (num ? '(数字键 ' + (i + 1) + ')' : '');
    // --ap-glow / --ap-accent 由注册项的 accent 注入:没有预览图时卡片照样有色可辨
    return '<article class="ap-card' + (isCurrent ? ' is-current' : '') +
      '" data-key="' + esc(def.key) + '" style="--ap-accent:' + esc(m.accent) + ';--ap-glow:' + esc(m.accent) + '33">' +
      '<button type="button" class="ap-card-pick" data-pick="' + esc(def.key) + '" title="' + esc(tip) + '">' +
      '<span class="ap-card-cover">' +
      (def.poster ? '<img src="' + esc(def.poster) + '" alt="" loading="lazy" decoding="async" />' : '') +
      num +
      (isCurrent ? '<span class="ap-card-badge">当前</span>' : '') +
      '</span>' +
      '<span class="ap-card-info">' +
      '<span class="ap-card-name">' + esc(def.label) + '</span>' +
      '<span class="ap-card-specs">' + specs + '</span>' +
      '<span class="ap-card-feats">' + feats + '</span>' +
      '</span>' +
      '</button>' +
      '</article>';
  }).join('');
  const total = ANIMATIONS.length;
  animEmpty.hidden = list.length > 0;
  if (!list.length) animEmptyText.textContent = '没有匹配「' + animQuery + '」的动画';
  animPickerSub.textContent = list.length === total
    ? '共 ' + total + ' 套动画 · 点卡片任意位置即可切换'
    : '匹配 ' + list.length + ' / ' + total + ' 套动画';
  animSearchClear.hidden = !animQuery;
  animCursor = Math.min(animCursor, Math.max(0, list.length - 1));
  paintAnimCursor();
}

/* 键盘光标:给当前卡片加 .is-cursor 外描边(点卡片切换,方向键只是移动焦点) */
function animCardEls(): HTMLElement[] {
  return Array.from(animGrid.querySelectorAll<HTMLElement>('.ap-card'));
}
function paintAnimCursor(focus = false) {
  animCardEls().forEach((el, i) => {
    const on = i === animCursor;
    el.classList.toggle('is-cursor', on);
    if (on && focus) {
      el.querySelector<HTMLButtonElement>('.ap-card-pick')?.focus();
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}
/* 网格列数:靠首行卡片的 offsetTop 归组算出来,不依赖 CSS 里写死的断点 */
function animGridColumns(): number {
  const cards = animCardEls();
  if (cards.length < 2) return 1;
  const top = cards[0].offsetTop;
  let n = 0;
  for (const c of cards) { if (c.offsetTop === top) n++; else break; }
  return Math.max(1, n);
}
function moveAnimCursor(delta: number) {
  const n = animCardEls().length;
  if (!n) return;
  animCursor = Math.max(0, Math.min(n - 1, animCursor + delta));
  paintAnimCursor(true);
}

/* 顶栏触发器与兼容 select 的同步:名称 / 规格 / 总数 / 缩略图都来自当前注册项 */
function syncAnimTrigger() {
  const def = animDef();
  if (!def) return;
  const m = animMetaOf(def);
  animTriggerName.textContent = def.label;
  animTriggerMeta.textContent = m.w + '×' + m.h + ' · ' + m.fps + 'fps';
  animTriggerCount.textContent = ANIMATIONS.length + ' 套';
  animTrigger.style.setProperty('--ap-accent', m.accent);
  if (def.poster) {
    animTriggerThumb.src = def.poster;
    animTriggerThumb.hidden = false;
  } else {
    animTriggerThumb.removeAttribute('src');
    animTriggerThumb.hidden = true;
  }
  selAnim.value = def.key;
  if (animPickerOpen()) renderAnimGallery();
}

function openAnimPicker() {
  if (animPickerOpen()) return;
  animLastFocus = document.activeElement as HTMLElement | null;
  animQuery = '';
  animSearch.value = '';
  // 光标先停在「当前动画」上,按 Enter 不会误切到别的动画
  const list = animVisibleList();
  const idx = list.findIndex((d) => d.key === currentAnimKey);
  animCursor = idx >= 0 ? idx : 0;
  animPicker.hidden = false;
  animTrigger.setAttribute('aria-expanded', 'true');
  renderAnimGallery();
  paintAnimCursor(true);
  animSearch.focus();
}
/* 关闭画廊。restoreFocus 默认为 true(Esc / 点背景 / 点关闭按钮都走这条):
 * 焦点回到打开画廊之前的位置,符合键盘用户预期。
 * 但「选完动画就走」那条路径必须传 false —— 焦点若留在触发器上,用户接着按空格
 * 会再次打开画廊而不是播放/暂停,那正是最别扭的一种"不顺手"。 */
function closeAnimPicker(restoreFocus = true) {
  if (!animPickerOpen()) return;
  animPicker.hidden = true;
  animTrigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    const back = animLastFocus && document.contains(animLastFocus) ? animLastFocus : animTrigger;
    back.focus();
  } else {
    (document.activeElement as HTMLElement | null)?.blur();
  }
  animLastFocus = null;
}
/* 选中某套动画:关掉画廊再切。
 * 选中的就是当前这套时只关画廊,不做无谓的重新载入(重新载入还会重置编辑状态)。 */
function pickAnimation(key: string) {
  closeAnimPicker(false);
  if (key === currentAnimKey) return;
  void switchAnimation(key);
}

animTrigger.addEventListener('click', () => (animPickerOpen() ? closeAnimPicker() : openAnimPicker()));
/* 点背景 / 关闭按钮 / Esc 都只是"关掉",焦点回到原处 */
animPickerBackdrop.addEventListener('click', () => closeAnimPicker());
animPickerClose.addEventListener('click', () => closeAnimPicker());
/* 卡片事件用委托:画廊每次重画都会换掉全部 DOM,逐个绑定等于每次都要重挂。
 * 整张卡片就是一个按钮,点哪儿都算 —— 不用瞄准标题或封面。 */
animGrid.addEventListener('click', (e) => {
  const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
  if (pick) pickAnimation(pick.dataset.pick ?? '');
});
/* 鼠标移到哪儿,光标就跟到哪儿:滚轮浏览时不必先点一下再按方向键,
 * 移开鼠标后键盘继续从最后停留的那张开始移动。 */
animGrid.addEventListener('mousemove', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.ap-card');
  if (!card || card.classList.contains('is-cursor')) return;
  const i = animCardEls().indexOf(card);
  if (i >= 0) { animCursor = i; paintAnimCursor(false); }
});
/* 滚轮在面板任意位置都能滚动卡片网格:头部/底部/搜索框上滚也不会"卡住" ——
 * 少了"先把鼠标挪到网格上"这一步。 */
animPicker.addEventListener('wheel', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('.ap-body')) return; // 网格自己会滚
  if (!animPickerBody) return;
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  animPickerBody.scrollTop += d;
  e.preventDefault();
}, { passive: false });
animSearch.addEventListener('input', () => {
  animQuery = animSearch.value;
  animCursor = 0;
  renderAnimGallery();
});
animSearchClear.addEventListener('click', () => {
  animSearch.value = '';
  animQuery = '';
  animCursor = 0;
  renderAnimGallery();
  animSearch.focus();
});
/* 画廊内的键盘(监听挂在 document 上,所以焦点在搜索框里也一样生效):
 *   方向键移动光标 · Enter 切换 · 数字 1–9 直选 · Home/End 跳首尾 · Esc 关闭。
 * 速度优先的几条捷径都做成了「不用先挪焦点」:打开即聚焦搜索框,输入的每个键都直接生效。 */
document.addEventListener('keydown', (e) => {
  if (!animPickerOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeAnimPicker(); return; }
  if (e.key === 'Enter') {
    const key = animCardEls()[animCursor]?.dataset.key;
    if (key) { e.preventDefault(); pickAnimation(key); }
    return;
  }
  if (e.key === 'Home') { e.preventDefault(); animCursor = 0; paintAnimCursor(true); return; }
  if (e.key === 'End') { e.preventDefault(); animCursor = animCardEls().length - 1; paintAnimCursor(true); return; }
  /* 数字键直选:只在「搜索框为空」时生效 —— 那时数字没有任何别的含义,直接当快捷键最省事。
   * 一旦开始输入(卡片上的序号角标也会随之隐藏,见 .is-searching),数字就还给搜索框,
   * 免得想搜「1080」却被当成按了 1。 */
  if (!e.ctrlKey && !e.metaKey && !e.altKey && animQuery.trim() === '' && /^[1-9]$/.test(e.key)) {
    const key = animCardEls()[Number(e.key) - 1]?.dataset.key;
    if (key) { e.preventDefault(); pickAnimation(key); }
    return;
  }
  const cols = animGridColumns();
  const step = e.key === 'ArrowRight' ? 1
    : e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowDown' ? cols
        : e.key === 'ArrowUp' ? -cols
          : 0;
  if (!step) return;
  e.preventDefault();
  moveAnimCursor(step);
});
/* 全局快捷键:斜杠 / 或 Ctrl(Cmd)+K 打开画廊。焦点在输入控件里时不抢按键,
 * 否则编辑文字图层时打不出「/」(与空格播放的守卫同一套判断)。 */
window.addEventListener('keydown', (e) => {
  if (animPickerOpen()) return;
  const t = e.target as HTMLElement | null;
  const typing = !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
  const modK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
  if (modK || (e.key === '/' && !typing)) {
    e.preventDefault();
    openAnimPicker();
  }
});

/* 初始化:兼容 select 的 options 按注册表生成(历史脚本用 page.select 驱动),
 * 再按当前动画同步一次触发器。「最近使用」从 localStorage 读回。 */
selAnim.innerHTML = ANIMATIONS.map((a) => '<option value="' + esc(a.key) + '">' + esc(a.label) + '</option>').join('');
selAnim.addEventListener('change', () => void switchAnimation(selAnim.value));
loadAnimPrefs();
syncAnimTrigger();

/* 启动流程:声音已在模块加载时预载(prefetchAudios,先于数据包),
 * 此处只等待默认动画数据包按需加载完成,再构建动画与弹窗。 */
async function bootApp() {
  await ensureExtractionData();
  // 等待期间用户可能已切换到位置暴露动画:由 switchAnimation 负责加载,跳过默认加载
  if (currentAnimKey === 'extraction' && bootAnimation) {
    void loadData(bootAnimation, '撤离动画');
  }
  /* 弹窗初始化:记录原始状态、渲染编辑列表、定位图标、加载弹窗叠加层(字体就绪后) */
  if (currentAnimKey === 'extraction' && popupData) {
    capturePopupOriginalState();
    renderPopupLists();
    void loadEmbeddedFonts(popupData).then(() => {
      positionPopupIcon(0); // 感叹号图标初始定位到文字图层左侧
      if (chkPopup.checked) rebuildPopupOverlay();
    });
  }
}
// 立即启动且不 await:数据包下载与首屏渲染互不阻塞,进度交给加载界面呈现
void bootApp();
