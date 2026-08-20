// 决定性验证:10 帧真实透明 DIB AVI,解码后逐帧检查序列内容独立(无叠加残影)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.dib10';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const W = 1920, H = 1080;
const START = 300, COUNT = 10;

function ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function dibStrf(w, h) {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true); df.setInt32(4, w, true); df.setInt32(8, h, true);
  df.setUint16(12, 1, true); df.setUint16(14, 32, true);
  df.setUint32(16, 0, true); df.setUint32(20, w * h * 4, true);
  return strf;
}
function rgbaToBgraBottomUp(img, w, h) {
  const src = img; const out = new Uint8Array(w * h * 4); const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const s = y * rowBytes; const d = (h - 1 - y) * rowBytes;
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
  const bytesPerSample = numCh * 2;
  const hasAudio = numCh > 0;
  const audioSlices = [];
  if (hasAudio) {
    const samplesPerFrame = Math.max(1, Math.round(audioRate / fr));
    const frameAudioBytes = samplesPerFrame * bytesPerSample;
    for (let f = 0; f < totalFrames; f++) {
      const start = f * frameAudioBytes;
      if (start >= pcm16.length) break;
      const end = Math.min(pcm16.length, start + frameAudioBytes);
      let slice = pcm16.subarray(start, end);
      if (slice.length % 2) { const c = new Uint8Array(slice.length + 1); c.set(slice); slice = c; }
      audioSlices.push(slice);
    }
  }
  const avihChunkSize = 8 + 56, strhChunkSize = 8 + 56, strfVideoChunkSize = 8 + strf.length, strfAudioChunkSize = 8 + 18;
  const videoStrlContent = 4 + strhChunkSize + strfVideoChunkSize;
  const audioStrlContent = 4 + strhChunkSize + strfAudioChunkSize;
  const hdrlContent = 4 + avihChunkSize + (8 + videoStrlContent) + (hasAudio ? 8 + audioStrlContent : 0);
  const moviContent = 4 + frameChunks.reduce((s, c) => s + 8 + c.length, 0) + audioSlices.reduce((s, c) => s + 8 + c.length, 0);
  const idxEntries = totalFrames + audioSlices.length;
  const idxDataBytes = idxEntries * 16;
  const riffSize = 28 + hdrlContent + moviContent + idxDataBytes;
  const parts = [];
  parts.push(ascii('RIFF'), u32(riffSize), ascii('AVI '));
  parts.push(ascii('LIST'), u32(hdrlContent), ascii('hdrl'));
  {
    const microSecPerFrame = Math.round(1e6 / fr);
    const avihChunk = new Uint8Array(56);
    const d = new DataView(avihChunk.buffer);
    d.setUint32(0, microSecPerFrame, true); d.setUint32(4, isDib ? frameBytes * fr : 0, true);
    d.setUint32(8, 0, true); d.setUint32(12, 0x10, true); d.setUint32(16, totalFrames, true);
    d.setUint32(20, 0, true); d.setUint32(24, hasAudio ? 2 : 1, true); d.setUint32(28, 0, true);
    d.setUint32(32, w, true); d.setUint32(36, h, true);
    parts.push(ascii('avih'), u32(56), avihChunk);
  }
  {
    parts.push(ascii('LIST'), u32(videoStrlContent), ascii('strl'));
    const strh = new Uint8Array(56);
    const d = new DataView(strh.buffer);
    strh.set(ascii('vids'), 0); strh.set(ascii(videoFcc), 4);
    d.setUint32(8, 0, true); d.setUint16(12, 0, true); d.setUint16(14, 0, true);
    d.setUint32(16, 0, true); d.setUint32(20, 1, true); d.setUint32(24, fr, true);
    d.setUint32(28, 0, true); d.setUint32(32, totalFrames, true);
    d.setUint32(36, isDib ? frameBytes : 0, true); d.setUint32(40, 0xffffffff, true); d.setUint32(44, isDib ? frameBytes : 0, true);
    parts.push(ascii('strh'), u32(56), strh);
    parts.push(ascii('strf'), u32(strf.length), strf);
  }
  parts.push(ascii('LIST'), u32(moviContent), ascii('movi'));
  let moviOffset = 4;
  const idx = [];
  for (let i = 0; i < frameChunks.length; i++) {
    const c = frameChunks[i];
    parts.push(ascii(frameFcc), u32(c.length), c);
    idx.push({ fourcc: frameFcc, flags: 0x10, offset: moviOffset, size: c.length });
    moviOffset += 8 + c.length;
    const a = audioSlices[i];
    if (a) { parts.push(ascii('01wb'), u32(a.length), a); idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: a.length }); moviOffset += 8 + a.length; }
  }
  parts.push(ascii('idx1'), u32(idxDataBytes));
  for (const e of idx) {
    const entry = new Uint8Array(16);
    const d = new DataView(entry.buffer);
    entry.set(ascii(e.fourcc), 0);
    d.setUint32(4, e.flags, true); d.setUint32(8, e.offset + 4, true); d.setUint32(12, e.size, true);
    parts.push(entry);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// 页面渲染帧 START..START+COUNT-1
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  const frames = await page.evaluate(async (start, count) => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#previewInner canvas') && window.__anim && window.__anim.isLoaded) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 100);
    });
    const renderer = window.__anim.renderer;
    const canvas = document.querySelector('#previewInner canvas');
    const ctx = canvas.getContext('2d');
    const out = [];
    for (let i = 0; i < count; i++) {
      renderer.renderFrame(start + i, true);
      const img = ctx.getImageData(0, 0, 1920, 1080);
      let bin = '';
      const arr = new Uint8ClampedArray(img.data.buffer);
      const STEP = 0x8000;
      for (let j = 0; j < arr.length; j += STEP) bin += String.fromCharCode.apply(null, arr.subarray(j, j + STEP));
      out.push(btoa(bin));
    }
    return out;
  }, START, COUNT);

  // 构建 DIB AVI(带音频切片,模拟真实导出)
  const frameChunks = [];
  for (const b64 of frames) {
    const rgba = Buffer.from(b64, 'base64');
    fs.writeFileSync(TMP + '/page.raw', rgba);
    frameChunks.push(rgbaToBgraBottomUp(rgba, W, H));
  }
  const pcm = new Uint8Array(Math.round((COUNT / 60) * 44100) * 2 * 2); // 10帧 44.1k 立体声
  const avi = buildAvi(W, H, 60, 'DIB ', dibStrf(W, H), '00db', frameChunks, pcm, 2, 44100);
  fs.writeFileSync(TMP + '/dib10.avi', avi);
  console.log('10帧 DIB AVI 构建:', avi.length, 'bytes');

  // ffmpeg 解码每帧,检查序列区域内容是否与对应序列帧匹配且无残影
  for (let i = 0; i < COUNT; i++) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', TMP + '/dib10.avi', '-vf', `select='eq(n\\,${i})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/dec${i}.raw`]);
    const dec = fs.readFileSync(TMP + `/dec${i}.raw`);
    // 序列 PNG 直通(未预乘)对比:解码帧是预乘值,需要反预乘或对比预乘后的期望值
    const n = String(START + i).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    // 期望值 = 序列帧 premultiplied(与文件一致)
    let seqPx = 0, matched = 0;
    for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
      const j = (y * 1920 + x) * 4;
      if (seq[j + 3] > 8) {
        seqPx++;
        const a = seq[j + 3];
        const er = Math.round((seq[j] * a) / 255), eg = Math.round((seq[j + 1] * a) / 255), eb = Math.round((seq[j + 2] * a) / 255);
        // 注意:解码帧是 top-down RGBA(ffmpeg 已翻转),直接对比
        const diff = Math.abs(dec[j] - er) + Math.abs(dec[j + 1] - eg) + Math.abs(dec[j + 2] - eb);
        if (diff < 40) matched++;
      }
    }
    console.log(`帧 ${START + i}: 序列像素 ${seqPx}, 匹配 ${matched} (${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}%) ${seqPx && matched / seqPx > 0.9 ? '✓ 独立无残影' : '✗'}`);
  }
} finally {
  await browser.close();
}
