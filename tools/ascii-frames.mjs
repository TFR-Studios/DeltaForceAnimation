// ASCII 可视化帧内容:下采样到字符画,看帧里到底有什么
import { execFileSync } from 'node:child_process';

const SRC = 'I:/Delta Force custom animation/tools/user-export.avi';
const W = 1920, H = 1080;
const CW = 110, CH = 34; // 字符网格
const CHARS = ' .:-=+*#%@';

function render(raw) {
  const out = [];
  for (let cy = 0; cy < CH; cy++) {
    let line = '';
    for (let cx = 0; cx < CW; cx++) {
      const x0 = Math.floor(cx * W / CW), x1 = Math.floor((cx + 1) * W / CW);
      const y0 = Math.floor(cy * H / CH), y1 = Math.floor((cy + 1) * H / CH);
      let aSum = 0, bSum = 0, n = 0;
      for (let y = y0; y < y1; y += 6) for (let x = x0; x < x1; x += 6) {
        const p = (y * W + x) * 4;
        aSum += raw[p + 3]; bSum += (raw[p] + raw[p + 1] + raw[p + 2]) / 3; n++;
      }
      const a = aSum / n;
      if (a < 20) { line += ' '; continue; }
      const b = bSum / n;
      const idx = Math.min(CHARS.length - 1, Math.floor((b / 255) * (CHARS.length - 1)));
      line += CHARS[idx];
    }
    out.push(line);
  }
  return out.join('\n');
}

for (const f of [0, 20, 40, 100, 300, 600]) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 300 * 1024 * 1024 });
  console.log(`\n===== 帧 ${f} =====`);
  console.log(render(raw));
}
