// 定位运动区间:每 15 帧抽一帧,比较与前一抽样帧的灰度差异
import { execFileSync } from 'node:child_process';

const SRC = 'K:/下载/animation_transparent.avi';
let prev = null;
const motion = [];
for (let f = 0; f < 609; f += 15) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 300 * 1024 * 1024 });
  if (prev) {
    let diff = 0, total = 0;
    for (let i = 0; i < raw.length; i += 32) { total++; if (Math.abs(raw[i] - prev[i]) > 8) diff++; }
    motion.push({ f, diffPct: (diff / total * 100).toFixed(1) });
  }
  prev = raw;
}
console.log('相邻15帧差异率(%):');
for (const m of motion) console.log(`帧${String(m.f).padStart(3)}: ${m.diffPct}%`);
