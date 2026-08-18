// 诊断:序列 PNG 帧内容分布 vs MP4 帧内容分布,找 B 帧偏移
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const TMP = 'I:/Delta Force custom animation/tools/.mp4test';

for (let f = 300; f <= 310; f++) {
  const n = String(f).padStart(5, '0');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/s.raw']);
  const b = fs.readFileSync(TMP + '/s.raw');
  let nz = 0, minX = 1920, minY = 1080, maxX = -1, maxY = -1;
  for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
    const i = (y * 1920 + x) * 4;
    if (b[i + 3] > 8) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  console.log(`seq ${f}: ${nz}px bbox x[${minX}..${maxX}] y[${minY}..${maxY}]`);
}

execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', TMP + '/animation.mp4', '-vf', "select='between(n\\,300\\,310)'", '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/m.raw']);
const m = fs.readFileSync(TMP + '/m.raw');
for (let k = 0; k < 11; k++) {
  let light = 0, nz = 0;
  for (let y = 340; y < 500; y++) for (let x = 180; x < 340; x++) {
    const i = (k * 1920 * 1080 + y * 1920 + x) * 4;
    if (m[i] > 180 && m[i + 1] > 180 && m[i + 2] > 180) light++;
    if (m[i] + m[i + 1] + m[i + 2] > 60) nz++;
  }
  console.log(`mp4 frame ${300 + k}: 浅色=${light} 亮像素=${nz}`);
}
