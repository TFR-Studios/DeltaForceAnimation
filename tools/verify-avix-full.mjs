// Node 验证多段 AVIX:移植 buildAvi(与 main.ts 一致),构造 500 帧(4.1GB)带音频,
// ffprobe 读全 + ffmpeg 解码首/中/尾帧验证内容
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'I:/Delta Force custom animation/tools/.avix-full.avi';
const W = 1920, H = 1080;
const FRAME_BYTES = W * H * 4;
const TOTAL = 609; // 4.1GB > 4.29GB? 500×8.3MB=4.15GB < 4.29GB! 用 520 帧 = 4.31GB
// 用 520 帧:520 × 8,294,400 = 4,313,088,000 > 4,294,967,296 ✓ 触发分段

function ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }

/* ---- 移植自 main.ts buildAvi(多段版) ---- */
function buildAvi(w, h, fr, videoFcc, strf, frameFcc, frameChunks, pcm16, numCh, audioRate, frameKeyFlags) {
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
  const avihChunkSize = 8 + 56, strhChunkSize = 8 + 56, strfVideoChunkSize = 8 + strf.length, strfAudioChunkSize = 8 + 18;
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
      idx.push({ fourcc: frameFcc, flags: frameKeyFlags ? (frameKeyFlags[i] ? 0x10 : 0x00) : 0x10, offset: moviOffset, size: c.length });
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
      d.setUint32(8, e.offset + 4, true);
      d.setUint32(12, e.size, true);
      target.push(entry);
    }
  };
  // 预计算所有段的 idx 条目(段0 的 idx1 需包含全部帧)
  const calcIdx = (start, count, baseOffset) => {
    let moviOffset = baseOffset + 4;
    const idx = [];
    for (let i = start; i < start + count; i++) {
      idx.push({ fourcc: frameFcc, flags: frameKeyFlags ? (frameKeyFlags[i] ? 0x10 : 0x00) : 0x10, offset: moviOffset, size: frameChunks[i].length });
      moviOffset += 8 + frameChunks[i].length;
      if (audioSlices[i]) { idx.push({ fourcc: '01wb', flags: 0x10, offset: moviOffset, size: audioSlices[i].length }); moviOffset += 8 + audioSlices[i].length; }
    }
    return idx;
  };
  const allIdx = [];
  {
    let off = segments[0];
    let base = moviContentOf(0, segments[0]) + 20;
    allIdx.push(...calcIdx(0, segments[0], 0));
    for (let k = 1; k < segmentCount; k++) {
      allIdx.push(...calcIdx(off, segments[k], base));
      base += moviContentOf(off, segments[k]) + 24;
      off += segments[k];
    }
  }
  // ODML indx 索引(仅多段):idx1 的 u32 偏移 >4.29GB 回绕,indx 用 64位 base + 段内相对偏移
  const calcSegIdx = (start, count) => {
    let rel = 0;
    const idx = [];
    for (let i = start; i < start + count; i++) {
      idx.push({ fourcc: frameFcc, key: frameKeyFlags ? !!frameKeyFlags[i] : true, rel, size: frameChunks[i].length });
      rel += 8 + frameChunks[i].length;
      const a = audioSlices[i];
      if (a) { idx.push({ fourcc: '01wb', key: true, rel, size: a.length }); rel += 8 + a.length; }
    }
    return idx;
  };
  const writeIndx = (target, chunkId, entries, baseAbs) => {
    const sel = entries.filter(e => e.fourcc === chunkId);
    if (!sel.length) return;
    const head = new Uint8Array(24);
    const d = new DataView(head.buffer);
    d.setUint16(0, 4, true);
    d.setUint8(2, 0);
    d.setUint8(3, 0);
    d.setUint32(4, sel.length, true);
    head.set(ascii(chunkId), 8);
    d.setBigUint64(12, BigInt(baseAbs), true);
    d.setUint32(20, 0, true);
    target.push(ascii('indx'), u32(24 + sel.length * 16), head);
    for (const e of sel) {
      const entry = new Uint8Array(16);
      const de = new DataView(entry.buffer);
      de.setUint32(0, e.rel + 8, true);
      de.setUint32(4, e.size | (e.key ? 0x80000000 : 0), true);
      target.push(entry);
    }
  };
  const segIdxEntries = segments.map((n, k) => calcSegIdx(k === 0 ? 0 : segments.slice(0, k).reduce((a, b) => a + b, 0), n));
  const indxBytes = multi
    ? segments.reduce((s, n, k) => s + (8 + 24 + segIdxEntries[k].filter(e => e.fourcc === frameFcc).length * 16) + (hasAudio ? 8 + 24 + segIdxEntries[k].filter(e => e.fourcc === '01wb').length * 16 : 0), 0)
    : 0;
  const seg0BaseAbs = 32 + hdrlContent + indxBytes;
  const parts = [];
  {
    const seg0 = segments[0];
    const movi0Content = moviContentOf(0, seg0);
    const idxDataBytes = multi ? 0 : (totalFrames + audioSlices.length) * 16;
    const riffSize = 28 + hdrlContent + indxBytes + movi0Content + idxDataBytes;
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
    if (multi) {
      let abs = seg0BaseAbs;
      for (let k = 0; k < segmentCount; k++) {
        writeIndx(parts, frameFcc, segIdxEntries[k], abs);
        if (hasAudio) writeIndx(parts, '01wb', segIdxEntries[k], abs);
        if (k < segmentCount - 1) {
          const off = k === 0 ? 0 : segments.slice(0, k).reduce((a, b) => a + b, 0);
          abs += moviContentOf(off, segments[k]) + 20;
        }
      }
    }
    parts.push(ascii('LIST'), u32(movi0Content), ascii('movi'));
    writeMovi(0, seg0, parts, 0);
    if (!multi) writeIdx1(parts, allIdx);
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
  // 诊断:按 parts 逐项计算段0 movi 实际写入字节
  {
    let total2 = 0, moviStart = -1, moviLen = 0, inMovi0 = false, done0 = false;
    for (let idx = 0; idx < parts.length; idx++) {
      const p = parts[idx];
      total2 += p.length;
      if (done0) continue;
      if (!inMovi0) {
        // 找段0 'movi' fourcc part
        if (p.length === 4 && p[0] === 0x6d && p[1] === 0x6f && p[2] === 0x76 && p[3] === 0x69) {
          inMovi0 = true;
          moviStart = total2 - 4;
          moviLen = 4;
        }
      } else {
        moviLen += p.length;
        // 遇到段1 'RIFF' 停止
        if (p.length === 4 && p[0] === 0x52 && p[1] === 0x49 && p[2] === 0x46 && p[3] === 0x46) { done0 = true; moviLen -= 4; }
      }
    }
    console.log('parts 总长:', total2, '| 段0 movi 实际写入:', moviLen, '| moviContentOf:', moviContentOf(0, segments[0]), '| 差:', moviContentOf(0, segments[0]) - moviLen);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function dibStrf(w, h) {
  const strf = new Uint8Array(40);
  const df = new DataView(strf.buffer);
  df.setUint32(0, 40, true); df.setInt32(4, w, true); df.setInt32(8, h, true);
  df.setUint16(12, 1, true); df.setUint16(14, 32, true);
  df.setUint32(16, 0, true); df.setUint32(20, w * h * 4, true);
  return strf;
}

// 生成帧(帧 i 的 R 通道 = i%251,可验证)
console.log('生成', TOTAL, '帧…');
const frames = [];
for (let i = 0; i < TOTAL; i++) {
  const f = new Uint8Array(FRAME_BYTES);
  const c = i % 251;
  for (let p = 0; p < FRAME_BYTES; p += 4) { f[p] = 0; f[p + 1] = 0; f[p + 2] = c; f[p + 3] = 255; }
  frames.push(f);
}
const pcm = new Uint8Array(Math.round((TOTAL / 60) * 44100) * 4);
console.log('构建 AVI…');
const avi = buildAvi(W, H, 60, 'DIB ', dibStrf(W, H), '00db', frames, pcm, 2, 44100);
// 分块写盘(Node writeFileSync 单次上限 2GB)
{
  const wfd = fs.openSync(OUT, 'w');
  const CHUNK = 64 * 1024 * 1024;
  for (let off = 0; off < avi.length; off += CHUNK) {
    fs.writeSync(wfd, avi, off, Math.min(CHUNK, avi.length - off), off);
  }
  fs.closeSync(wfd);
}
console.log('已写入:', OUT, (avi.length / 1073741824).toFixed(2), 'GB');

// 结构检查
const fd = fs.openSync(OUT, 'r');
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const riff0 = head.readUInt32LE(4);
const hdrl = head.readUInt32LE(16);
// 跳过 hdrl 后的 indx 块(多段时存在),找到真正的 LIST movi
let movi0Pos = 12 + 8 + hdrl;
const th = Buffer.alloc(8);
{
  for (;;) {
    fs.readSync(fd, th, 0, 8, movi0Pos);
    if (th.toString('latin1', 0, 4) === 'indx') { movi0Pos += 8 + th.readUInt32LE(4); continue; }
    break;
  }
}
const movi0Size = th.readUInt32LE(4);
console.log('RIFF0 size:', riff0, riff0 < 4294967295 ? '✓ 未溢出' : '✗ 溢出');
// 段0 idx1 条目数(从 idx1 chunk 头读)
let pos = movi0Pos + 12 + movi0Size;
const idxHead = Buffer.alloc(8);
fs.readSync(fd, idxHead, 0, 8, pos);
console.log('movi0 后块:', idxHead.toString('latin1', 0, 4), 'size', idxHead.readUInt32LE(4));
if (idxHead.toString('latin1', 0, 4) === 'idx1') pos += 8 + idxHead.readUInt32LE(4);
// 扫描 AVIX 段
let segments = 1;
const ch = Buffer.alloc(8);
while (pos + 12 < avi.length) {
  fs.readSync(fd, ch, 0, 8, pos);
  const id = ch.toString('latin1', 0, 4);
  if (id !== 'RIFF') { console.log('扫描停止 @', pos, 'id=', id); break; }
  const form = Buffer.alloc(4);
  fs.readSync(fd, form, 0, 4, pos + 8);
  if (form.toString('latin1') !== 'AVIX') { console.log('非 AVIX:', form.toString('latin1')); break; }
  segments++;
  pos += 8 + ch.readUInt32LE(4); // RIFF 头 8 字节 + size 字段值
}
fs.closeSync(fd);
console.log('AVIX 段数:', segments, segments > 1 ? '✓ 已分段' : '✗ 未分段');

// 定位帧 250/499 的块并检查颜色
const findFrame = (target) => {
  const rfd = fs.openSync(OUT, 'r');
  let p = movi0Pos + 12;
  const mEnd0 = movi0Pos + 12 + movi0Size;
  let frameIdx = 0;
  const ch2 = Buffer.alloc(8);
  // 段0
  while (p + 8 <= mEnd0) {
    fs.readSync(rfd, ch2, 0, 8, p);
    const id = ch2.toString('latin1', 0, 4);
    const sz = ch2.readUInt32LE(4);
    if (id === '00db') {
      if (frameIdx === target) {
        const body = Buffer.alloc(8);
        fs.readSync(rfd, body, 0, 8, p + 8);
        fs.closeSync(rfd);
        return { seg: 0, off: p, color: body[2], bodyHead: [...body.slice(0, 4)] };
      }
      frameIdx++;
    }
    p += 8 + sz;
  }
  // 段0 后:单段有 idx1,多段直接是段1 'RIFF'
  const ih = Buffer.alloc(8);
  fs.readSync(rfd, ih, 0, 8, p);
  if (ih.toString('latin1', 0, 4) === 'idx1') p += 8 + ih.readUInt32LE(4);
  // AVIX 段
  let seg = 1;
  while (p + 12 < avi.length) {
    fs.readSync(rfd, ch2, 0, 8, p);
    if (ch2.toString('latin1', 0, 4) !== 'RIFF') break;
    const riffSz = ch2.readUInt32LE(4);
    const mh = Buffer.alloc(12);
    fs.readSync(rfd, mh, 0, 12, p + 12);
    const mSize = mh.readUInt32LE(4);
    let mp = p + 24;
    const mEnd = p + 24 + mSize;
    while (mp + 8 <= mEnd) {
      fs.readSync(rfd, ch2, 0, 8, mp);
      const id = ch2.toString('latin1', 0, 4);
      const sz = ch2.readUInt32LE(4);
      if (id === '00db') {
        if (frameIdx === target) {
          const body = Buffer.alloc(8);
          fs.readSync(rfd, body, 0, 8, mp + 8);
          fs.closeSync(rfd);
          return { seg, off: mp, color: body[2], bodyHead: [...body.slice(0, 4)] };
        }
        frameIdx++;
      }
      mp += 8 + sz;
    }
    p += 8 + riffSz;
    seg++;
  }
  fs.closeSync(rfd);
  return { notFound: true, frameIdx };
};
for (const t of [0, 250, 499]) {
  const r = findFrame(t);
  console.log(`帧 ${t}:`, JSON.stringify(r), r.color !== undefined ? (r.color === t % 251 ? '✓ 文件内颜色正确' : '✗ 文件内颜色错误!') : '');
}

// ffprobe
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', OUT], { encoding: 'utf8' });
const nb = probe.match(/nb_frames=(\d+)/);
const dur = probe.match(/duration=([\d.]+)/);
console.log('ffprobe: nb_frames =', nb ? nb[1] : 'N/A', '| duration =', dur ? dur[1] : 'N/A');
console.log(nb && parseInt(nb[1]) === TOTAL ? '✓ 全部帧可读!' : '✗ 帧数不完整!');

// ffmpeg 解码首/中/尾帧验证内容(解码输出 RGBA,源帧的 R 通道在 raw[0])
for (const [label, f] of [['首帧', 0], ['中帧', Math.floor(TOTAL / 2)], ['尾帧', TOTAL - 1]]) {
  const raw = execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', OUT, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 200 * 1024 * 1024 });
  const c = f % 251;
  const px = raw[0]; // R 通道(源 BGRA 的 R)
  console.log(`${label}(${f}): 期望色 ${c}, 解码像素 R=${px} ${px === c ? '✓' : '✗'}`);
}

// ===== 关键:seek 路径验证(播放器方式,跨段 seek) =====
console.log('\n--- seek 路径验证(播放器方式) ---');
const seekTargets = [0.5, 2.2, 3.5, 5.0, 6.5, 8.0, 9.5];
let seekOk = true;
for (const ss of seekTargets) {
  if (ss >= TOTAL / 60) { console.log(`seek ${ss}s: 跳过(超出时长 ${(TOTAL / 60).toFixed(2)}s)`); continue; }
  try {
    const raw = execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-i', OUT, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 200 * 1024 * 1024, timeout: 90000 });
    if (raw.length === 0) { console.log(`seek ${ss}s: ✗ 无输出`); seekOk = false; continue; }
    const frame = Math.round(ss * 60);
    const c = frame % 251;
    const px = raw[0];
    const ok = px === c;
    if (!ok) seekOk = false;
    console.log(`seek ${ss}s (帧≈${frame}, 段${Math.floor(frame / Math.ceil(TOTAL / segments.length))}): R=${px} (期望 ${c}) ${ok ? '✓' : '✗'}`);
  } catch (e) {
    console.log(`seek ${ss}s: 错误 ${String(e).slice(0, 80)}`);
    seekOk = false;
  }
}
console.log(seekOk ? '✅ seek 路径全部正确(播放器可正常跨段读取)' : '✗ seek 路径存在问题');
