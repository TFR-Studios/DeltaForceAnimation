// 对比 AVI 解码帧与页面渲染帧:验证导出的 AVI 数据是否与页面渲染内容完全一致。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const AVI = 'I:/Delta Force custom animation/tools/animation.avi';
const FRAMES = [0, 304, 608];
const TMP = 'I:/Delta Force custom animation/tools/.cmp';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// 1. ffmpeg 从 AVI 提取帧 → raw RGBA
for (const f of FRAMES) {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', AVI,
    '-vf', `select='eq(n\\,${f})'`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    `${TMP}/avi-${f}.raw`,
  ]);
}
console.log('AVI 帧已提取');

// 2. 页面渲染同帧号 → raw RGBA
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('已载入'),
    { timeout: 30000 }
  );
  const raws = await page.evaluate(async (frames) => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') {
      sel.value = 'canvas';
      sel.dispatchEvent(new Event('change'));
    }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) {
          clearInterval(timer); resolve();
        } else if (Date.now() - t0 > 20000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const anim = window.__anim;
    const renderer = anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');
    const out = {};
    for (const f of frames) {
      renderer.renderFrame(f, true);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const arr = new Uint8ClampedArray(img.data.buffer);
      let bin = '';
      const STEP = 0x8000;
      for (let i = 0; i < arr.length; i += STEP) {
        bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
      }
      out[f] = { w: canvas.width, h: canvas.height, b64: btoa(bin) };
    }
    return out;
  }, FRAMES);
  for (const f of FRAMES) {
    fs.writeFileSync(`${TMP}/page-${f}.raw`, Buffer.from(raws[f].b64, 'base64'));
  }
  console.log('页面帧已提取');

  // 3. 对比:直接 / 垂直翻转 / 水平翻转
  const frameStat = (buf) => {
    let r = 0, g = 0, b = 0, nonZero = 0, nonTransparent = 0;
    const n = buf.length / 4;
    for (let i = 0; i < buf.length; i += 4) {
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      if (buf[i] + buf[i + 1] + buf[i + 2] > 0) nonZero++;
      if (buf[i + 3] > 0) nonTransparent++;
    }
    return `RGB均值 ${(r / n).toFixed(1)},${(g / n).toFixed(1)},${(b / n).toFixed(1)} | 非黑像素 ${((nonZero / n) * 100).toFixed(2)}% | 不透明 ${((nonTransparent / n) * 100).toFixed(2)}%`;
  };
  for (const f of FRAMES) {
    const avi = fs.readFileSync(`${TMP}/avi-${f}.raw`);
    const pageRaw = fs.readFileSync(`${TMP}/page-${f}.raw`);
    console.log(`frame ${f}: AVI[${frameStat(avi)}]`);
    console.log(`frame ${f}: PAGE(透明)[${frameStat(pageRaw)}]`);
    // 页面帧 alpha 合成到导出背景色 #16181d(与导出管线一致)
    const page = Buffer.alloc(pageRaw.length);
    const bg = [0x16, 0x18, 0x1d];
    for (let i = 0; i < pageRaw.length; i += 4) {
      const a = pageRaw[i + 3] / 255;
      page[i] = pageRaw[i] * a + bg[0] * (1 - a);
      page[i + 1] = pageRaw[i + 1] * a + bg[1] * (1 - a);
      page[i + 2] = pageRaw[i + 2] * a + bg[2] * (1 - a);
      page[i + 3] = 255;
    }
    console.log(`frame ${f}: PAGE(合成背景)[${frameStat(page)}]`);
    if (avi.length !== page.length) {
      console.log(`frame ${f}: ✗ 长度不一致 avi=${avi.length} page=${page.length}`);
      continue;
    }
    const W = 1920, H = 1080;
    // 用合理阈值判定"真正不同"(JPEG 有损量化差通常 <10/通道)
    const stat = (a, b, thr) => {
      let diff = 0, maxD = 0, sumD = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > thr) diff++;
        if (d > maxD) maxD = d;
        sumD += d; n++;
      }
      return { diff, pct: ((diff / n) * 100).toFixed(3), maxD, avg: (sumD / n).toFixed(2) };
    };
    const flipV = Buffer.alloc(avi.length);
    const flipH = Buffer.alloc(avi.length);
    const row = W * 4;
    for (let y = 0; y < H; y++) {
      avi.copy(flipV, y * row, (H - 1 - y) * row, (H - 1 - y) * row + row);
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const d = (y * W + (W - 1 - x)) * 4;
        flipH[s] = avi[d]; flipH[s + 1] = avi[d + 1]; flipH[s + 2] = avi[d + 2]; flipH[s + 3] = avi[d + 3];
      }
    }
    for (const [name, ref] of [['直接', page], ['垂直翻转', flipV], ['水平翻转', flipH]]) {
      const s = stat(ref, avi, 40);
      console.log(`  ${name}: 真正不同 ${s.pct}% | 平均差 ${s.avg} | 最大差 ${s.maxD} ${s.pct < 1 ? '✓ 内容一致(仅 JPEG 量化差)' : ''}`);
    }
  }
} finally {
  await browser.close();
}
