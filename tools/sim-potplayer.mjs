// 决定性验证:预乘 alpha 的 DIB AVI 在 PotPlayer(premultiplied 合成)下的显示效果。
// 模拟:out = srcRGB + bg×(1-a)  [PotPlayer/Windows 语义]
//   对比:out = srcRGB×a + bg×(1-a)  [剪辑软件/straight 语义]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.cmp';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const W = 1920, H = 1080;

function ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function dibStrf(w, h) {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true);
  df.setInt32(4, w, true);
  df.setInt32(8, h, true);
  df.setUint16(12, 1, true);
  df.setUint16(14, 32, true);
  df.setUint32(16, 0, true);
  df.setUint32(20, w * h * 4, true);
  return strf;
}
function rgbaToBgraBottomUpPremultiplied(img, w, h) {
  const src = img;
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const s = y * rowBytes;
    const d = (h - 1 - y) * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      const a = src[s + x + 3];
      out[d + x] = Math.round((src[s + x + 2] * a) / 255);
      out[d + x + 1] = Math.round((src[s + x + 1] * a) / 255);
      out[d + x + 2] = Math.round((src[s + x] * a) / 255);
      out[d + x + 3] = a;
    }
  }
  return out;
}
function buildAvi(w, h, fr, videoFcc, strf, frameFcc, frameChunks, pcm16, numCh, audioRate) {
  const totalFrames = frameChunks.length;
  const isDib = videoFcc === 'DIB ';
  const frameBytes = w * h * 4;
  const audioChunks = [];
  const hasAudio = numCh > 0;
  const avihChunkSize = 8 + 56;
  const strhChunkSize = 8 + 56;
  const strfVideoChunkSize = 8 + strf.length;
  const strfAudioChunkSize = 8 + 18;
  const videoStrlContent = 4 + strhChunkSize + strfVideoChunkSize;
  const audioStrlContent = 4 + strhChunkSize + strfAudioChunkSize;
  const hdrlContent = 4 + avihChunkSize + (8 + videoStrlContent) + (hasAudio ? 8 + audioStrlContent : 0);
  const moviContent = 4 + frameChunks.reduce((s, c) => s + 8 + c.length, 0) + audioChunks.reduce((s, c) => s + 8 + c.length, 0);
  const idxEntries = totalFrames + audioChunks.length;
  const idxDataBytes = idxEntries * 16;
  const riffSize = 28 + hdrlContent + moviContent + idxDataBytes;
  const parts = [];
  parts.push(ascii('RIFF'), u32(riffSize), ascii('AVI '));
  parts.push(ascii('LIST'), u32(hdrlContent), ascii('hdrl'));
  {
    const microSecPerFrame = Math.round(1e6 / fr);
    const avihChunk = new Uint8Array(56);
    const d = new DataView(avihChunk.buffer);
    d.setUint32(0, microSecPerFrame, true);
    d.setUint32(4, isDib ? frameBytes * fr : 0, true);
    d.setUint32(8, 0, true);
    d.setUint32(12, 0x10, true);
    d.setUint32(16, totalFrames, true);
    d.setUint32(20, 0, true);
    d.setUint32(24, hasAudio ? 2 : 1, true);
    d.setUint32(28, 0, true);
    d.setUint32(32, w, true);
    d.setUint32(36, h, true);
    parts.push(ascii('avih'), u32(56), avihChunk);
  }
  {
    parts.push(ascii('LIST'), u32(videoStrlContent), ascii('strl'));
    const strh = new Uint8Array(56);
    const d = new DataView(strh.buffer);
    strh.set(ascii('vids'), 0);
    strh.set(ascii(videoFcc), 4);
    d.setUint32(8, 0, true);
    d.setUint16(12, 0, true); d.setUint16(14, 0, true);
    d.setUint32(16, 0, true);
    d.setUint32(20, 1, true);
    d.setUint32(24, fr, true);
    d.setUint32(28, 0, true);
    d.setUint32(32, totalFrames, true);
    d.setUint32(36, isDib ? frameBytes : 0, true);
    d.setUint32(40, 0xffffffff, true);
    d.setUint32(44, isDib ? frameBytes : 0, true);
    parts.push(ascii('strh'), u32(56), strh);
    parts.push(ascii('strf'), u32(strf.length), strf);
  }
  parts.push(ascii('LIST'), u32(moviContent), ascii('movi'));
  let moviOffset = 4;
  const idx = [];
  for (const c of frameChunks) {
    parts.push(ascii(frameFcc), u32(c.length), c);
    idx.push({ fourcc: frameFcc, flags: 0x10, offset: moviOffset, size: c.length });
    moviOffset += 8 + c.length;
  }
  parts.push(ascii('idx1'), u32(idxDataBytes));
  for (const e of idx) {
    const entry = new Uint8Array(16);
    const d = new DataView(entry.buffer);
    entry.set(ascii(e.fourcc), 0);
    d.setUint32(4, e.flags, true);
    d.setUint32(8, e.offset + 4, true);
    d.setUint32(12, e.size, true);
    parts.push(entry);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 30000 });
  const raws = await page.evaluate(async (frames) => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 20000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const renderer = window.__anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');
    const out = {};
    for (const f of frames) {
      renderer.renderFrame(f, true);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let bin = '';
      const arr = new Uint8ClampedArray(img.data.buffer);
      const STEP = 0x8000;
      for (let i = 0; i < arr.length; i += STEP) bin += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
      out[f] = btoa(bin);
    }
    return out;
  }, [304]);

  const src = Buffer.from(raws[304], 'base64');
  fs.writeFileSync(`${TMP}/page-304.raw`, src);
  // 构建预乘 DIB AVI(与 main.ts 现在完全一致)
  const bgra = rgbaToBgraBottomUpPremultiplied(src, W, H);
  const avi = buildAvi(W, H, 10, 'DIB ', dibStrf(W, H), '00db', [bgra], new Uint8Array(0), 0, 44100);
  fs.writeFileSync(`${TMP}/pm.avi`, avi);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${TMP}/pm.avi`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', `${TMP}/pm-dec.raw`]);
  const dec = fs.readFileSync(`${TMP}/pm-dec.raw`);

  // 对半透明像素做双语义模拟(黑底 bg=0)
  let potPlayerOk = 0, potPlayerBad = 0, straightOk = 0;
  const samples = [];
  for (let i = 0; i < dec.length; i += 4) {
    const a = dec[i + 3];
    if (a === 0 || a === 255) continue;
    const r = dec[i], g = dec[i + 1], b = dec[i + 2];
    // PotPlayer(premultiplied):out = premul_rgb + bg×(1-a) = premul_rgb
    const outPP = r + g + b; // 黑底:直接就是预乘值
    // straight 语义读取(剪辑软件读同一文件):out = premul_rgb×a + bg×(1-a)
    const outST = (r + g + b) * (a / 255);
    if (outPP <= 150) potPlayerOk++; // 预乘值应明显小于白(255×3),即"暗色半透明"而非"不透明白"
    else potPlayerBad++;
    if (samples.length < 6) samples.push({ a, rgb: `(${r},${g},${b})`, potPlayer_blackBg: outPP.toFixed(0), straight_blackBg: outST.toFixed(1) });
  }
  const n = dec.length / 4;
  let aMid = 0;
  for (let i = 3; i < dec.length; i += 4) if (dec[i] > 0 && dec[i] < 255) aMid++;
  console.log('预乘 AVI 解码:');
  console.log(`  半透明像素: ${aMid} (与页面 ${28534} 应一致)`);
  console.log(`  PotPlayer 语义(黑底)下显示为暗色半透明: ${potPlayerOk}px, 异常亮色: ${potPlayerBad}px`);
  console.log('  半透明样本(alpha, 预乘RGB, PotPlayer黑底输出, 剪辑软件黑底输出):');
  for (const s of samples) console.log(`    a=${s.a} rgb=${s.rgb} → PotPlayer:${s.potPlayer_blackBg}  剪辑软件:${s.straight_blackBg}`);
  console.log(potPlayerBad === 0 ? '✓ PotPlayer 将正确显示半透明(暗色渐变),不再是不透明白' : '✗ 仍有异常');
} finally {
  await browser.close();
}
