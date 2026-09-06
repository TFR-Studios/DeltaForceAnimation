// 用用户真实导出内容重建"压平透明"版:解码 RGBA → 强制 alpha=255 → 重建 AVI(同 buildAvi 结构)
// 验证 PotPlayer 残影是否由 alpha 合成导致
import fs from 'node:fs';

const W = 1920, H = 1080, FR = 60, TOTAL = 609;
const FRAME_BYTES = W * H * 4;
const OUT = 'K:/下载/测试G_压平透明.avi';
const RAW = 'I:/Delta Force custom animation/tools/.frames.raw';
const PCM = 'I:/Delta Force custom animation/tools/.audio.pcm';

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

function dibStrf(w, h) {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true); df.setInt32(4, w, true); df.setInt32(8, h, true);
  df.setUint16(12, 1, true); df.setUint16(14, 32, true);
  df.setUint32(16, 0, true); df.setUint32(20, w * h * 4, true);
  return strf;
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
  const SEGMENT_LIMIT = 0x3F000000;
  const segments = [];
  {
    let cur = 0, curBytes = 0;
    for (let i = 0; i < totalFrames; i++) {
      const fb = 8 + frameChunks[i].length + (audioSlices[i] ? 8 + audioSlices[i].length : 0);
      if (cur > 0 && curBytes + fb > SEGMENT_LIMIT) { segments.push(cur); cur = 0; curBytes = 0; }
      cur++; curBytes += fb;
    }
    if (cur > 0) segments.push(cur);
  }
  const segmentCount = segments.length;
  const multi = segmentCount > 1;
  const avihChunkSize = 8 + 56;
  const strhChunkSize = 8 + 56;
  const strfVideoChunkSize = 8 + strf.length;
  const strfAudioChunkSize = 8 + 18;
  const videoStrlContent = 4 + strhChunkSize + strfVideoChunkSize;
  const audioStrlContent = 4 + strhChunkSize + strfAudioChunkSize;
  const odmlContent = 4 + (8 + 20);
  const hdrlContent = 4 + avihChunkSize + (8 + videoStrlContent) + (hasAudio ? 8 + audioStrlContent : 0) + (multi ? 8 + odmlContent : 0);
  const moviContentOf = (start, count) => {
    let s = 4;
    for (let i = start; i < start + count; i++) { s += 8 + frameChunks[i].length; if (audioSlices[i]) s += 8 + audioSlices[i].length; }
    return s;
  };
  const writeMovi = (start, count, target, baseOffset) => {
    let moviOffset = baseOffset + 4;
    const idx = [];
    for (let i = start; i < start + count; i++) {
      const c = frameChunks[i];
      target.push(ascii(frameFcc), u32(c.length), c);
      idx.push({ fourcc: frameFcc, flags: 0x10, offset: moviOffset, size: c.length });
      moviOffset += 8 + c.length;
      const a = audioSlices[i];
      if (a) { target.push(ascii('01wb'), u32(a.length), a); idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: a.length }); moviOffset += 8 + a.length; }
    }
    return idx;
  };
  const writeIdx1 = (target, idx) => {
    target.push(ascii('idx1'), u32(idx.length * 16));
    for (const e of idx) {
      const entry = new Uint8Array(16);
      const d = new DataView(entry.buffer);
      entry.set(ascii(e.fourcc), 0);
      d.setUint32(4, e.flags, true);
      d.setUint32(8, e.offset, true);
      d.setUint32(12, e.size, true);
      target.push(entry);
    }
  };
  const calcIdx = (start, count, baseOffset) => {
    let moviOffset = baseOffset + 4;
    const idx = [];
    for (let i = start; i < start + count; i++) {
      idx.push({ fourcc: frameFcc, flags: 0x10, offset: moviOffset, size: frameChunks[i].length });
      moviOffset += 8 + frameChunks[i].length;
      if (audioSlices[i]) { idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: audioSlices[i].length }); moviOffset += 8 + audioSlices[i].length; }
    }
    return idx;
  };
  const calcAllIdx = (idxData) => {
    const out = [];
    let off = segments[0];
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
  const idxCut = multi ? allIdx.findIndex((e) => e.offset > 0xFFFFF000) : -1;
  if (multi) allIdx = calcAllIdx((idxCut < 0 ? allIdx.length : idxCut) * 16);
  const idx1Entries = idxCut < 0 ? allIdx : allIdx.slice(0, idxCut);
  const idxDataBytes = idx1Entries.length * 16;
  const parts = [];
  {
    const seg0 = segments[0];
    const movi0Content = moviContentOf(0, seg0);
    const riffSize = 28 + hdrlContent + movi0Content + idxDataBytes;
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
      d.setUint32(8, 0, true); d.setUint16(12, 0, true); d.setUint16(14, 0, true);
      d.setUint32(16, 0, true); d.setUint32(20, 1, true); d.setUint32(24, fr, true);
      d.setUint32(28, 0, true); d.setUint32(32, totalFrames, true);
      d.setUint32(36, isDib ? frameBytes : 0, true); d.setUint32(40, 0xffffffff, true); d.setUint32(44, 0, true);
      parts.push(ascii('strh'), u32(56), strh);
      parts.push(ascii('strf'), u32(strf.length), strf);
    }
    if (hasAudio) {
      parts.push(ascii('LIST'), u32(audioStrlContent), ascii('strl'));
      const strh = new Uint8Array(56);
      const d = new DataView(strh.buffer);
      strh.set(ascii('auds'), 0);
      d.setUint32(4, 0, true); d.setUint32(8, 0, true);
      d.setUint16(12, 0, true); d.setUint16(14, 0, true);
      d.setUint32(16, 0, true); d.setUint32(20, 1, true); d.setUint32(24, audioRate, true);
      d.setUint32(28, 0, true); d.setUint32(32, Math.floor(pcm16.length / bytesPerSample), true);
      d.setUint32(36, 0, true); d.setUint32(40, 0xffffffff, true); d.setUint32(44, bytesPerSample, true);
      parts.push(ascii('strh'), u32(56), strh);
      const strf = new Uint8Array(18);
      const df = new DataView(strf.buffer);
      df.setUint16(0, 1, true); df.setUint16(2, numCh, true);
      df.setUint32(4, audioRate, true); df.setUint32(8, audioRate * bytesPerSample, true);
      df.setUint16(12, bytesPerSample, true); df.setUint16(14, 16, true); df.setUint16(16, 0, true);
      parts.push(ascii('strf'), u32(18), strf);
    }
    if (multi) {
      const dmlh = new Uint8Array(20);
      const dd = new DataView(dmlh.buffer);
      dd.setUint32(0, totalFrames, true);
      parts.push(ascii('LIST'), u32(odmlContent), ascii('odml'));
      parts.push(ascii('dmlh'), u32(20), dmlh);
    }
    parts.push(ascii('LIST'), u32(movi0Content), ascii('movi'));
    writeMovi(0, seg0, parts, 0);
    writeIdx1(parts, idx1Entries);
  }
  {
    let offset = segments[0];
    let baseOffset = moviContentOf(0, segments[0]) + 20;
    for (let k = 1; k < segmentCount; k++) {
      const seg = segments[k];
      const moviKContent = moviContentOf(offset, seg);
      const riffSize = 12 + moviKContent;
      parts.push(ascii('RIFF'), u32(riffSize), ascii('AVIX'));
      parts.push(ascii('LIST'), u32(moviKContent), ascii('movi'));
      writeMovi(offset, seg, parts, baseOffset);
      baseOffset += moviKContent + 24;
      offset += seg;
    }
  }
  return new Blob ? parts : parts; // parts 数组,由调用方拼写
}

// 读 raw 帧(RGBA 顶向下)→ 转 BGRA 底向上 + alpha 强制 255(分块读,>2GB 文件)
console.log('读取 raw 帧…');
const rfd = fs.openSync(RAW, 'r');
const frames = [];
const row = W * 4;
const frameBuf = Buffer.alloc(FRAME_BYTES);
for (let f = 0; f < TOTAL; f++) {
  fs.readSync(rfd, frameBuf, 0, FRAME_BYTES, f * FRAME_BYTES);
  const bgra = new Uint8Array(FRAME_BYTES);
  for (let y = 0; y < H; y++) {
    const srcRow = frameBuf.subarray(y * row, (y + 1) * row);
    const dstRow = bgra.subarray((H - 1 - y) * row, (H - y) * row);
    for (let x = 0; x < W; x++) {
      const s = x * 4, d = s;
      dstRow[d] = srcRow[s + 2];     // B
      dstRow[d + 1] = srcRow[s + 1]; // G
      dstRow[d + 2] = srcRow[s];     // R
      dstRow[d + 3] = 255;           // 压平:alpha 强制不透明
    }
  }
  frames.push(bgra);
  if (f % 100 === 0) console.log('帧', f);
}
fs.closeSync(rfd);
console.log('帧转换完成,共', frames.length);

const pcm16 = fs.readFileSync(PCM);
console.log('音频字节', pcm16.length, '→ 构建 AVI…');
const parts = buildAvi(W, H, FR, 'DIB ', dibStrf(W, H), '00db', frames, pcm16, 2, 48000);

// 拼装 Blob 部分
let total = 0;
for (const p of parts) total += p.length;
console.log('总字节', total);
{
  const wfd = fs.openSync(OUT, 'w');
  const CHUNK = 64 * 1024 * 1024;
  let off = 0;
  for (const p of parts) {
    const b = p instanceof Uint8Array ? p : p;
    let pos = 0;
    while (pos < b.length) {
      const n = Math.min(CHUNK, b.length - pos);
      fs.writeSync(wfd, b, pos, n, off + pos);
      pos += n;
    }
    off += b.length;
  }
  fs.closeSync(wfd);
}
console.log('已写入', OUT, (total / 1073741824).toFixed(2), 'GB');
