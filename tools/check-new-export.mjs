// 分析新导出:帧内容是否在动 + 中部区域 ASCII
import { execFileSync } from 'node:child_process';

const SRC = 'I:/Delta Force custom animation/tools/user-export.avi';
const W = 1920, H = 1080;
const CH = ' .:-=+*#%@';
const get = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 300 * 1024 * 1024 });

const a = get(100), b = get(300), c = get(600);
let d1 = 0, d2 = 0;
for (let p = 0; p < a.length; p += 4) {
  if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 3] - b[p + 3]) > 30) d1++;
  if (Math.abs(b[p] - c[p]) + Math.abs(b[p + 3] - c[p + 3]) > 30) d2++;
}
console.log('新导出: 帧100→300 差异像素', d1, ' 帧300→600 差异像素', d2);

const show = (raw, label) => {
  console.log('--- ' + label + ' (中部 60x12 字符) ---');
  for (let cy = 8; cy < 20; cy++) {
    let line = '';
    for (let cx = 30; cx < 90; cx++) {
      const x0 = Math.floor(cx * W / 110), x1 = Math.floor((cx + 1) * W / 110);
      const y0 = Math.floor(cy * H / 34), y1 = Math.floor((cy + 1) * H / 34);
      let as = 0, bs = 0, n = 0;
      for (let y = y0; y < y1; y += 6) for (let x = x0; x < x1; x += 6) {
        const p = (y * W + x) * 4;
        as += raw[p + 3]; bs += (raw[p] + raw[p + 1] + raw[p + 2]) / 3; n++;
      }
      const av = as / n;
      if (av < 20) { line += ' '; continue; }
      line += CH[Math.min(9, Math.floor((bs / n / 255) * 9))];
    }
    console.log(line);
  }
};
show(a, '帧100');
show(b, '帧300');
show(c, '帧600');
