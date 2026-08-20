// 诊断:ffmpeg 对多段 AVIX 的帧读取(帧序与内容),以及各段 RIFF size
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'I:/Delta Force custom animation/tools/.avix-big.avi';

// 1) 各段 RIFF size 实际值
const fd = fs.openSync(OUT, 'r');
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const hdrl = head.readUInt32LE(16);
const movi0Pos = 12 + 8 + hdrl;
const movi0Size = head.readUInt32LE(movi0Pos + 4);
let pos = movi0Pos + 12 + movi0Size;
const ih = Buffer.alloc(8);
fs.readSync(fd, ih, 0, 8, pos);
pos += 8 + ih.readUInt32LE(4); // 跳 idx1(实际 idx1 位置理论-4,但先按声明走)
// 重新精确:idx1 实际在 movi0 结束处 - 4?用扫描找
// 直接顺序解析:从 movi0 数据起点开始数块,直到 idx1
let p = movi0Pos + 12;
const ch = Buffer.alloc(8);
let frameIdx = 0;
// 数到 idx1 为止(按块)
while (p + 8 < OUT.length) {
  fs.readSync(fd, ch, 0, 8, p);
  const id = ch.toString('latin1', 0, 4);
  const sz = ch.readUInt32LE(4);
  if (id === 'idx1') { console.log('idx1 @', p, '(movi0 数据实际长度 =', p - (movi0Pos + 12), '声明 =', movi0Size, '差 =', movi0Size - (p - (movi0Pos + 12)), ')'); break; }
  if (id === '00db') frameIdx++;
  p += 8 + sz;
  if (p > 4.5 * 1024 * 1024 * 1024) break;
}
fs.closeSync(fd);
console.log('movi0 内帧数(按块):', frameIdx);

// 2) ffmpeg 解码抽样帧,看 ffmpeg 的帧序内容
const samples = [0, 1, 2, 100, 126, 127, 128, 130, 250, 499];
for (const f of samples) {
  try {
    const raw = execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', OUT, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
    const c = f % 251;
    console.log(`ffmpeg 帧 ${f}: 解码色 B=${raw[2]} (期望 ${c}) ${raw[2] === c ? '✓' : '✗'}`);
  } catch (e) {
    console.log(`ffmpeg 帧 ${f}: 错误 ${String(e).slice(0, 100)}`);
  }
}
