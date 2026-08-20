// 检查多段 AVIX:各段 RIFF 头、边界、后续结构
import fs from 'node:fs';

const OUT = 'I:/Delta Force custom animation/tools/.avix-big.avi';
const fd = fs.openSync(OUT, 'r');
const stat = fs.fstatSync(fd);
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const hdrl = head.readUInt32LE(16);
const movi0Pos = 12 + 8 + hdrl;
const movi0Size = head.readUInt32LE(movi0Pos + 4);
console.log('段0: movi @', movi0Pos, 'size', movi0Size);

let pos = movi0Pos + 12 + movi0Size;
// idx1
const ih = Buffer.alloc(8);
fs.readSync(fd, ih, 0, 8, pos);
console.log('段0后块:', ih.toString('latin1', 0, 4), 'size', ih.readUInt32LE(4));
pos += 8 + ih.readUInt32LE(4);

// 逐段打印
let seg = 1;
const ch = Buffer.alloc(12);
while (pos + 12 <= stat.size && seg < 10) {
  fs.readSync(fd, ch, 0, 12, pos);
  const id = ch.toString('latin1', 0, 4);
  if (id !== 'RIFF') { console.log(`@${pos} 非 RIFF: '${id}' 停止`); break; }
  const riffSz = ch.readUInt32LE(4);
  const form = ch.toString('latin1', 8, 12);
  // 段内 movi
  const mh = Buffer.alloc(12);
  fs.readSync(fd, mh, 0, 12, pos + 12);
  const mId = mh.toString('latin1', 0, 4);
  const mSize = mh.readUInt32LE(4);
  const mForm = mh.toString('latin1', 8, 12);
  // 数段内帧
  let mp = pos + 24;
  const mEnd = pos + 24 + mSize;
  let frames = 0;
  const ch2 = Buffer.alloc(8);
  while (mp + 8 <= mEnd && frames < 200000) {
    fs.readSync(fd, ch2, 0, 8, mp);
    const fid = ch2.toString('latin1', 0, 4);
    const fsz = ch2.readUInt32LE(4);
    if (fid === '00db') frames++;
    mp += 8 + fsz;
    if (mp > mEnd) { console.log(`  段内越界 @${mp} > ${mEnd}`); break; }
  }
  console.log(`段${seg}: RIFF@${pos} size=${riffSz} form='${form}' | movi '${mId}' size=${mSize} fourcc='${mForm}' 帧数=${frames} | 段结束=${pos + 12 + riffSz}`);
  pos += 12 + riffSz;
  seg++;
}
fs.closeSync(fd);
