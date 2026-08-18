// 单帧提取 MP4 帧 303/304/305,检查序列区域内容
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const TMP = 'I:/Delta Force custom animation/tools/.mp4test';

for (const f of [300, 304, 308]) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', TMP + '/animation.mp4', '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/m${f}.raw`]);
  const m = fs.readFileSync(TMP + `/m${f}.raw`);
  let light = 0, nz = 0;
  const samples = [];
  for (let y = 340; y < 500; y++) for (let x = 180; x < 340; x++) {
    const i = (y * 1920 + x) * 4;
    const sum = m[i] + m[i + 1] + m[i + 2];
    if (m[i] > 180 && m[i + 1] > 180 && m[i + 2] > 180) light++;
    if (sum > 60) { nz++; if (samples.length < 3) samples.push(`(${m[i]},${m[i + 1]},${m[i + 2]})`); }
  }
  console.log(`mp4 frame ${f}: 浅色=${light} 亮像素=${nz} 样本=${samples.join(' ')}`);
  // 整个帧的非背景像素统计(背景 #16181d ≈ 22,24,29)
  let whole = 0;
  for (let i = 0; i < m.length; i += 4) {
    if (Math.abs(m[i] - 22) + Math.abs(m[i + 1] - 24) + Math.abs(m[i + 2] - 29) > 80) whole++;
  }
  console.log(`  全帧非背景像素: ${whole}`);
}
