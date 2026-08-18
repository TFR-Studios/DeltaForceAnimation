// 验证透明 AVI(DIB 无压缩 32bpp)容器与帧布局。
// buildAvi / dibStrf / rgbaToBgraBottomUp 从 src/main.ts 忠实移植(与浏览器内完全一致),
// 生成合成文件后:① 用 RIFF 解析器逐块核对声明大小;② 由外部 ffprobe 复验。
import fs from 'node:fs';

function ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }

function dibStrf(w, h) {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true);
  df.setInt32(4, w, true);
  df.setInt32(8, h, true);
  df.setUint16(12, 1, true);
  df.setUint16(14, 32, true);
  df.setUint32(16, 0, true); // BI_RGB
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
  const CHUNK = 8192 * numCh * 2;
  for (let off = 0; off < pcm16.length; off += CHUNK) {
    const n = Math.min(CHUNK, pcm16.length - off);
    const pad = n % 2 ? 1 : 0;
    const c = new Uint8Array(n + pad); c.set(pcm16.subarray(off, off + n));
    audioChunks.push(c);
  }
  const bytesPerSample = numCh * 2;
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
    d.setUint32(40, 0xffffffff, true);
    d.setUint32(44, bytesPerSample, true);
    parts.push(ascii('strh'), u32(56), strh);
    const strf = new Uint8Array(18);
    const df = new DataView(strf.buffer);
    df.setUint16(0, 1, true);
    df.setUint16(2, numCh, true);
    df.setUint32(4, audioRate, true);
    df.setUint32(8, audioRate * bytesPerSample, true);
    df.setUint16(12, bytesPerSample, true);
    df.setUint16(14, 16, true);
    df.setUint16(16, 0, true);
    parts.push(ascii('strf'), u32(18), strf);
  }
  parts.push(ascii('LIST'), u32(moviContent), ascii('movi'));
  let moviOffset = 4;
  const idx = [];
  for (const c of frameChunks) {
    parts.push(ascii(frameFcc), u32(c.length), c);
    idx.push({ fourcc: frameFcc, flags: 0x10, offset: moviOffset, size: c.length });
    moviOffset += 8 + c.length;
  }
  for (const c of audioChunks) {
    parts.push(ascii('01wb'), u32(c.length), c);
    idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: c.length });
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

/* RIFF 校验器:按声明大小逐块走查,核对每个块的声明大小与实际布局一致
 * 规则:LIST 的 size 字段 = 内容字节数(含 fourcc 4 字节 + 全部子块,不含自身 8 字节头) */
function validateRiff(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const errors = [];
  const asciiAt = (off, len) => String.fromCharCode(...buf.subarray(off, off + len));
  const walk = (start, end, depth) => {
    let p = start;
    while (p + 8 <= end) {
      const id = asciiAt(p, 4);
      const size = dv.getUint32(p + 4, true);
      const dataStart = p + 8;
      if (id === 'LIST') {
        const fourcc = asciiAt(dataStart, 4);
        const contentEnd = dataStart + size;
        if (contentEnd > end) { errors.push(`LIST ${fourcc} 越界: 声明 ${size} 超出剩余 ${end - dataStart}`); return; }
        const childrenBytes = walk(dataStart + 4, contentEnd, depth + 1);
        if (4 + childrenBytes !== size) errors.push(`LIST ${fourcc} 大小不一致: 声明 ${size},实际 ${4 + childrenBytes}`);
        p = contentEnd;
      } else {
        if (dataStart + size > end) { errors.push(`chunk ${id} 越界`); return; }
        p = dataStart + size;
      }
    }
    return p - start;
  };
  if (asciiAt(0, 4) !== 'RIFF') errors.push('缺少 RIFF 头');
  const riffSize = dv.getUint32(4, true);
  if (riffSize !== buf.length - 8) errors.push(`RIFF 大小字段 ${riffSize} != 实际 ${buf.length - 8}`);
  if (asciiAt(8, 4) !== 'AVI ') errors.push('缺少 AVI 标识');
  const consumed = walk(12, buf.length, 0);
  if (consumed !== buf.length - 12) errors.push(`RIFF 内容走查 ${consumed} != 实际 ${buf.length - 12}`);
  return errors;
}

// 用例 1:64×64,3 帧,带 alpha,无音频
const W = 64, H = 64, FR = 10;
const frames = [];
for (let f = 0; f < 3; f++) {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255 - f * 60;
    rgba[i * 4 + 1] = f * 80;
    rgba[i * 4 + 2] = 128;
    rgba[i * 4 + 3] = 255 - f * 80;
  }
  frames.push(rgbaToBgraBottomUp(rgba, W, H));
}
const out1 = 'I:/Delta Force custom animation/tools/e2e-test-transparent.avi';
fs.writeFileSync(out1, buildAvi(W, H, FR, 'DIB ', dibStrf(W, H), '00db', frames, new Uint8Array(0), 0, 44100));
console.log('用例1(无音频):', fs.statSync(out1).size, 'bytes');
const e1 = validateRiff(fs.readFileSync(out1));
console.log(e1.length ? '✗ ' + e1.join('; ') : '✓ RIFF 结构全部一致');

// 用例 2:带音频(2 通道 PCM,2 帧)
const frames2 = [];
for (let f = 0; f < 2; f++) {
  const rgba = new Uint8Array(W * H * 4).fill(0);
  rgba[0] = 255; rgba[3] = 128;
  frames2.push(rgbaToBgraBottomUp(rgba, W, H));
}
const pcm = new Uint8Array(48000 * 0.2 * 2 * 2); // 0.2s @ 48k,2ch,16bit
const out2 = 'I:/Delta Force custom animation/tools/e2e-test-transparent-audio.avi';
fs.writeFileSync(out2, buildAvi(W, H, FR, 'DIB ', dibStrf(W, H), '00db', frames2, pcm, 2, 48000));
console.log('用例2(带音频):', fs.statSync(out2).size, 'bytes');
const e2 = validateRiff(fs.readFileSync(out2));
console.log(e2.length ? '✗ ' + e2.join('; ') : '✓ RIFF 结构全部一致');
