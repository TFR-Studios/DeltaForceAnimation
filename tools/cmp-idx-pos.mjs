// 对比 idx1 条目值 vs 帧实际位置
import fs from 'node:fs';

const AVI = 'I:/Delta Force custom animation/tools/.avix-big.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const hdrl = head.readUInt32LE(16);
const movi0Pos = 12 + 8 + hdrl;
const movi0Size = head.readUInt32LE(movi0Pos + 4);
console.log('movi0 @', movi0Pos, 'size', movi0Size);

// idx1 位置 = movi0 结束
const idx1Pos = movi0Pos + 8 + movi0Size;
const ih = Buffer.alloc(8);
fs.readSync(fd, ih, 0, 8, idx1Pos);
console.log('idx1 @', idx1Pos, 'id=', ih.toString('latin1', 0, 4), 'size=', ih.readUInt32LE(4));

// 读 idx1 前 12 条目的值
const entry = Buffer.alloc(16);
console.log('--- idx1 条目(视频/音频) ---');
for (let i = 0; i < 12; i++) {
  fs.readSync(fd, entry, 0, 16, idx1Pos + 8 + i * 16);
  const tag = entry.toString('latin1', 0, 4);
  const flags = entry.readUInt32LE(4);
  const off = entry.readUInt32LE(8);
  const sz = entry.readUInt32LE(12);
  console.log(`条目 ${i}: ${tag} flags=${flags} off=${off} (0x${off.toString(16)}) size=${sz}`);
}

// 帧实际位置(顺序扫段0 movi)
console.log('--- 帧实际块头位置(相对 movi 起点) ---');
let p = movi0Pos + 12;
const ch = Buffer.alloc(8);
let frameIdx = 0;
let audioIdx = 0;
while (p + 8 <= idx1Pos && frameIdx < 3) {
  fs.readSync(fd, ch, 0, 8, p);
  const id = ch.toString('latin1', 0, 4);
  const sz = ch.readUInt32LE(4);
  if (id === '00db') {
    console.log(`帧 ${frameIdx}: 块头 @ ${p - (movi0Pos + 4)} (绝对 ${p}), size=${sz}`);
    frameIdx++;
  } else if (id === '01wb') {
    if (audioIdx < 3) console.log(`音频 ${audioIdx}: 块头 @ ${p - (movi0Pos + 4)} (绝对 ${p}), size=${sz}`);
    audioIdx++;
  }
  p += 8 + sz;
}
fs.closeSync(fd);
