// 模拟导出合成:提升 alpha 后的序列合成到背景,检查可见亮度
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const TMP = 'I:/Delta Force custom animation/tools/.exp';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'I:/Delta Force custom animation/animation/ccreptile/ccreptitle_00304.png', '-vf', "format=rgba,lut=a='clip(val*8,0,255)'", '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
const seq = fs.readFileSync(TMP + '/seq.raw');
let bright = 0, visible = 0;
for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
  const i = (y * 1920 + x) * 4;
  const a = seq[i + 3] / 255;
  const r = Math.round(seq[i] * a + 22 * (1 - a));
  const g = Math.round(seq[i + 1] * a + 24 * (1 - a));
  const b = Math.round(seq[i + 2] * a + 29 * (1 - a));
  if (r > 150 && g > 150 && b > 150) bright++;
  if (Math.abs(r - 22) + Math.abs(g - 24) + Math.abs(b - 29) > 40) visible++;
}
console.log('导出合成后: 亮色像素 =', bright, '| 可见(异于背景)像素 =', visible);
console.log(bright > 200 ? '✓ 序列在导出视频中明显可见' : '✗ 仍不可见');
