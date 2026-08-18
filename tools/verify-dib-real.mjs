// 用真实动画帧构建 DIB(透明)AVI,ffmpeg 解码后与页面原帧对比,验证行序与 alpha。
// buildAvi / dibStrf / rgbaToBgraBottomUp 从 src/main.ts 忠实移植。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.cmp';
const W = 1920, H = 1080;
const FRAMES = [0, 304];

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
function rgbaToBgraBottomUp(img, w, h) {
  const src = img;
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const s = y * rowBytes;
    const d = (h - 1 - y) * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      out[d + x] = src[s + x + 2];
      out[d + x + 1] = src[s + x + 1];
      out[d + x + 2] = src[s + x];
      out[d + x + 3] = src[s + x + 3];
    }
  }
  return out;
}
function buildAvi(w, h, fr, videoFcc, strf, frameFcc, frameChunks, pcm16, numCh, audioRate) {
  const totalFrames = frameChunks.length;
  const isDib = videoFcc === 'DIB ';
  const frameBytes = w * h * 4;
  const audioChunks = [];
  const bytesPerSample = numCh * 2;
  const hasAudio = numCh > 0;
  const avihChunkSize = 8 + 56;
  const strhChunkSize = 8 + 56;
  const strfVideoChunkSize = 8 + 40;
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
    parts.push(ascii('strf'), u32(40), strf);
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

// 用页面真实帧构建 DIB AVI
const frames = [];
for (const f of FRAMES) {
  const rgba = fs.readFileSync(`${TMP}/page-${f}.raw`);
  frames.push(rgbaToBgraBottomUp(rgba, W, H));
}
const avi = buildAvi(W, H, 10, 'DIB ', dibStrf(W, H), '00db', frames, new Uint8Array(0), 0, 44100);
const AVI_OUT = `${TMP}/dib-real.avi`;
fs.writeFileSync(AVI_OUT, avi);
console.log('DIB AVI 已构建:', avi.length, 'bytes');

// ffmpeg 解码两帧
for (const [i, f] of FRAMES.entries()) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', AVI_OUT, '-vf', `select='eq(n\\,${i})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', `${TMP}/dib-dec-${f}.raw`]);
  const dec = fs.readFileSync(`${TMP}/dib-dec-${f}.raw`);
  const page = fs.readFileSync(`${TMP}/page-${f}.raw`);
  // 对比 RGB + alpha
  let diffRGB = 0, diffA = 0, n = 0;
  for (let i2 = 0; i2 < dec.length; i2 += 4) {
    const dr = Math.abs(dec[i2] - page[i2]) + Math.abs(dec[i2 + 1] - page[i2 + 1]) + Math.abs(dec[i2 + 2] - page[i2 + 2]);
    if (dr > 10) diffRGB++;
    if (Math.abs(dec[i2 + 3] - page[i2 + 3]) > 10) diffA++;
    n++;
  }
  const pctRGB = ((diffRGB / n) * 100).toFixed(3);
  const pctA = ((diffA / n) * 100).toFixed(3);
  console.log(`frame ${f}: 解码帧 vs 页面帧 RGB差异 ${pctRGB}%, alpha差异 ${pctA}% ${pctRGB < 0.5 && pctA < 0.5 ? '✓ 行序与透明通道完全正确' : '✗ 有问题!'}`);
}
