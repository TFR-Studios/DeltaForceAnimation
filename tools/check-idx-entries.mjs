// 对比 idx1 条目值与帧实际位置(定位 seek 错位)
import fs from 'node:fs';

const AVI = 'K:\\下载\\animation_transparent.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const hdrl = head.readUInt32LE(16);
const movi0Pos = 12 + 8 + hdrl;
const movi0Size = head.readUInt32LE(movi0Pos + 4);
console.log('movi0 @', movi0Pos, 'size', movi0Size);

// idx1 在 movi0 之后(段0 内)
const idx1Pos = movi0Pos + 8 + movi0Size;
const ih = Buffer.alloc(8);
fs.readSync(fd, ih, 0, 8, idx1Pos);
console.log('idx1 @', idx1Pos, 'id=', ih.toString('latin1', 0, 4), 'size=', ih.readUInt32LE(4));
const idxEntries = ih.readUInt32LE(4) / 16;
console.log('idx1 条目数:', idxEntries);

// 读目标帧的条目(视频帧条目,每隔一帧)
const targets = [0, 126, 127, 253, 254, 380, 381, 420, 500, 608];
const entry = Buffer.alloc(16);
const found = [];
for (let i = 0; i < idxEntries; i++) {
  fs.readSync(fd, entry, 0, 16, idx1Pos + 8 + i * 16);
  const tag = entry.toString('latin1', 0, 4);
  if (tag === '00db') {
    const off = entry.readUInt32LE(8);
    found.push({ idx: i, videoFrame: found.length, off });
  }
}
for (const t of targets) {
  const e = found[t];
  if (!e) { console.log('帧', t, '条目不存在'); continue; }
  // 条目值 = e.off。校准:data_offset = first_packet_pos - 第一条目值。第一条目 off = ? 
  // 第一条目值:
  const firstOff = found[0].off;
  console.log(`帧 ${t}: idx1 条目值 = ${e.off}, 第一条目值 = ${firstOff}`);
}
fs.closeSync(fd);
