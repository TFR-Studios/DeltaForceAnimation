// 帧内容分析:非透明像素数 + 内容边界框 + 帧间差异区域
import { execFileSync } from 'node:child_process';

const SRC = 'K:/下载/animation_transparent.avi';
const W = 1920, H = 1080;
const frames = [];
for (const f of [0, 20, 40, 100, 300, 600]) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 300 * 1024 * 1024 });
  let minX = 9999, maxX = 0, minY = 9999, maxY = 0, nonZero = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (raw[p + 3] !== 0) { nonZero++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  frames.push({ f, raw, nonZero, box: `x[${minX}-${maxX}] y[${minY}-${maxY}]` });
  console.log(`帧${f}: 非透明像素 ${nonZero} 内容框 ${frames[frames.length - 1].box}`);
}
// 帧0 与帧100 的差异区域(运动发生在哪)
{
  const a = frames[0].raw, b = frames[2].raw;
  let diff = 0, minX = 9999, maxX = 0, minY = 9999, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const da = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) + Math.abs(a[p + 3] - b[p + 3]);
    if (da > 30) { diff++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  console.log(`帧0→帧100 差异像素 ${diff} 区域 x[${minX}-${maxX}] y[${minY}-${maxY}]`);
}
// 帧100→帧300 差异(应为 0,验证静止)
{
  const a = frames[2].raw, b = frames[4].raw;
  let diff = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 3] - b[p + 3]) > 30) diff++;
  }
  console.log(`帧100→帧300 差异像素 ${diff}`);
}
