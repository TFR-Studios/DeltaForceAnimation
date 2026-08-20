// 分析用户提供的「有残影的视频.avi」:流式解析帧,检测残影(序列区域 vs 素材匹配 + 透明区残留)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const AVI = 'I:/Delta Force custom animation/有残影的视频.avi';
const TMP = 'I:/Delta Force custom animation/tools/.ghost';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const W = 1920, H = 1080;
const FRAME_BYTES = W * H * 4;

const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
console.log('文件大小:', (stat.size / 1024 / 1024 / 1024).toFixed(2), 'GB');

// 按 RIFF 结构定位 movi
const headBuf = Buffer.alloc(4 * 1024 * 1024);
fs.readSync(fd, headBuf, 0, headBuf.length, 0);
if (headBuf.toString('latin1', 0, 4) !== 'RIFF') { console.log('不是 RIFF 文件'); process.exit(1); }
const riffSize = headBuf.readUInt32LE(4);
console.log('RIFF size:', riffSize, '实际-8:', stat.size - 8, riffSize === stat.size - 8 ? '✓' : '✗ 不一致!');
// offset 12: LIST hdrl
const hdrlListSize = headBuf.readUInt32LE(16);
console.log('hdrl LIST size:', hdrlListSize, 'fourcc:', headBuf.toString('latin1', 12, 16), headBuf.toString('latin1', 20, 24));
const moviPos = 12 + 8 + hdrlListSize;
const moviSize = headBuf.readUInt32LE(moviPos + 4);
console.log('movi LIST @', moviPos, 'size:', moviSize, 'fourcc:', headBuf.toString('latin1', moviPos, moviPos + 4), headBuf.toString('latin1', moviPos + 8, moviPos + 12));
const moviDataStart = moviPos + 12; // LIST 头(8) + 'movi' fourcc(4)
const moviEnd = moviDataStart + moviSize;
console.log('movi 数据区:', moviDataStart, '->', moviEnd, '(文件尾:', stat.size, ')');
console.log('movi 覆盖帧数估算:', Math.floor(moviSize / (1920 * 1080 * 4 + 2940)), '帧');

// 抽样帧:全部 300-340 + 每 60 帧
const sampleFrames = new Set();
for (let f = 0; f < 609; f += 60) sampleFrames.add(f);
for (let f = 295; f <= 345; f++) sampleFrames.add(f);

// 预转换素材到 raw
const materialCache = {};
for (const f of sampleFrames) {
  const n = String(f).padStart(5, '0');
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgba', `${TMP}/m${f}.raw`]);
    materialCache[f] = fs.readFileSync(`${TMP}/m${f}.raw`);
  } catch { /* 帧素材缺失 */ }
}
console.log('素材预加载:', Object.keys(materialCache).length, '帧');

// 流式解析 movi
const chunkHead = Buffer.alloc(8);
let pos = moviDataStart;
let frameIdx = 0;
const report = [];
let prevRegion = null; // 上一帧序列区域内容(检测残留)

while (pos + 8 <= moviEnd) {
  fs.readSync(fd, chunkHead, 0, 8, pos);
  const id = chunkHead.toString('latin1', 0, 4);
  const size = chunkHead.readUInt32LE(4);
  if (id === '00db') {
    if (sampleFrames.has(frameIdx)) {
      const frame = Buffer.alloc(FRAME_BYTES);
      fs.readSync(fd, frame, 0, FRAME_BYTES, pos + 8);
      // BGRA bottom-up → RGBA top-down
      const rgba = Buffer.alloc(FRAME_BYTES);
      const rowBytes = W * 4;
      for (let y = 0; y < H; y++) {
        const s = y * rowBytes;
        const d = (H - 1 - y) * rowBytes;
        for (let x = 0; x < rowBytes; x += 4) {
          rgba[d + x] = frame[s + x + 2];
          rgba[d + x + 1] = frame[s + x + 1];
          rgba[d + x + 2] = frame[s + x];
          rgba[d + x + 3] = frame[s + x + 3];
        }
      }
      // 检测1:透明区残留(alpha<10 但 RGB 非 0)
      let dirty = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < 10 && (rgba[i] > 3 || rgba[i + 1] > 3 || rgba[i + 2] > 3)) dirty++;
      }
      // 检测2:序列区域 vs 素材(反预乘)
      const mat = materialCache[frameIdx];
      let seqPx = 0, matched = 0, sumDiff = 0;
      if (mat) {
        for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
          const i = (y * W + x) * 4;
          const a = rgba[i + 3];
          if (a > 8) {
            seqPx++;
            const r = a > 0 ? Math.min(255, Math.round((rgba[i] * 255) / a)) : 0;
            const g = a > 0 ? Math.min(255, Math.round((rgba[i + 1] * 255) / a)) : 0;
            const b = a > 0 ? Math.min(255, Math.round((rgba[i + 2] * 255) / a)) : 0;
            const diff = Math.abs(r - mat[i]) + Math.abs(g - mat[i + 1]) + Math.abs(b - mat[i + 2]);
            sumDiff += diff;
            if (diff < 60) matched++;
          }
        }
      }
      // 检测3:与上一帧序列区域的差异(残影特征:本帧含上帧内容)
      let ghostLike = -1;
      if (prevRegion) {
        let ghostPx = 0;
        for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
          const i = (y * W + x) * 4;
          // 上帧有内容而本帧该位置 alpha 也>0 且颜色接近上帧 → 疑似残留
          if (prevRegion[i + 3] > 8 && rgba[i + 3] > 8) {
            const diff = Math.abs(rgba[i] - prevRegion[i]) + Math.abs(rgba[i + 1] - prevRegion[i + 1]) + Math.abs(rgba[i + 2] - prevRegion[i + 2]);
            if (diff < 30) ghostPx++;
          }
        }
        ghostLike = ghostPx;
      }
      // 保存序列区域(仅当有内容)
      prevRegion = Buffer.alloc(66 * 76 * 4);
      for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
        const i = (y * W + x) * 4;
        prevRegion[(y - 382) * 66 * 4 + (x - 227) * 4] = rgba[i];
        prevRegion[(y - 382) * 66 * 4 + (x - 227) * 4 + 1] = rgba[i + 1];
        prevRegion[(y - 382) * 66 * 4 + (x - 227) * 4 + 2] = rgba[i + 2];
        prevRegion[(y - 382) * 66 * 4 + (x - 227) * 4 + 3] = rgba[i + 3];
      }
      report.push({ frame: frameIdx, seqPx, matchPct: seqPx ? +((matched / seqPx) * 100).toFixed(1) : 0, avgDiff: seqPx ? +(sumDiff / seqPx).toFixed(1) : 0, dirty, ghostLike });
    }
    frameIdx++;
  }
  pos += 8 + size;
  if (frameIdx >= 609) break;
}
fs.closeSync(fd);

// 输出报告
const withMat = report.filter((r) => r.seqPx > 0);
const low = withMat.filter((r) => r.matchPct < 90);
console.log('\n=== 分析结果 ===');
console.log('素材对比帧数:', withMat.length);
console.log('匹配 <90% 的帧:', JSON.stringify(low.slice(0, 20)));
console.log('匹配 <80% 的帧数:', low.filter((r) => r.matchPct < 80).length);
console.log('透明区 RGB 残留(dirty>500)帧数:', report.filter((r) => r.dirty > 500).length);
console.log('疑似残影(ghostLike>300)帧数:', report.filter((r) => r.ghostLike > 300).length);
console.log('\n连续帧段 295-345 匹配明细:');
for (const r of report.filter((r) => r.frame >= 295 && r.frame <= 345)) {
  console.log(`  帧 ${r.frame}: 匹配 ${r.matchPct}% (${r.seqPx}px) dirty=${r.dirty} ghost=${r.ghostLike}`);
}
