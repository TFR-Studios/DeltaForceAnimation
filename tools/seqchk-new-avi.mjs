// 连续帧残影检测:新文件帧 300-310 序列区域逐帧 vs 素材
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const AVI = 'K:\\下载\\animation_transparent.avi';
const TMP = 'I:/Delta Force custom animation/tools/.seqchk';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// 预转素材
for (let f = 300; f <= 310; f++) {
  const n = String(f).padStart(5, '0');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/seq${f}.raw`], { timeout: 60000 });
}

let allOk = true;
for (let f = 300; f <= 310; f++) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', AVI, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/f${f}.raw`], { timeout: 120000 });
  const frame = fs.readFileSync(TMP + `/f${f}.raw`);
  const seq = fs.readFileSync(TMP + `/seq${f}.raw`);
  let seqPx = 0, matched = 0;
  for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
    const i = (y * 1920 + x) * 4;
    if (seq[i + 3] > 8) {
      seqPx++;
      const a = frame[i + 3];
      if (a > 8) {
        const r = Math.min(255, Math.round((frame[i] * 255) / a));
        const g = Math.min(255, Math.round((frame[i + 1] * 255) / a));
        const b = Math.min(255, Math.round((frame[i + 2] * 255) / a));
        const diff = Math.abs(r - seq[i]) + Math.abs(g - seq[i + 1]) + Math.abs(b - seq[i + 2]);
        if (diff < 80) matched++;
      }
    }
  }
  const pct = seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0;
  const ok = seqPx > 0 && matched / seqPx > 0.8;
  if (!ok) allOk = false;
  console.log(`帧 ${f}: 素材 ${seqPx}px, 匹配 ${matched} (${pct}%) ${ok ? '✓' : '✗'}`);
}
console.log(allOk ? '\n✅ 全部连续帧序列内容正确,文件无残影' : '\n✗ 存在异常帧');
