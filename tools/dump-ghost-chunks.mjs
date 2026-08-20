// 打印 ghost AVI 前 30 个块的 ID/size
import fs from 'node:fs';

const AVI = 'I:/Delta Force custom animation/有残影的视频.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
const headBuf = Buffer.alloc(4 * 1024 * 1024);
fs.readSync(fd, headBuf, 0, headBuf.length, 0);
const hdrlListSize = headBuf.readUInt32LE(16);
const moviPos = 12 + 8 + hdrlListSize;
let pos = moviPos + 8;
const chunkHead = Buffer.alloc(8);
console.log('movi @', moviPos, 'size', headBuf.readUInt32LE(moviPos + 4));
for (let k = 0; k < 30; k++) {
  if (pos + 8 > stat.size) break;
  fs.readSync(fd, chunkHead, 0, 8, pos);
  const id = chunkHead.toString('latin1', 0, 4);
  const size = chunkHead.readUInt32LE(4);
  const sizeHex = '0x' + chunkHead.readUInt32LE(4).toString(16);
  console.log(`块 ${k}: offset=${pos} id='${id}' size=${size} (${sizeHex})`);
  if (id === 'idx1') break;
  pos += 8 + size;
  if (pos > stat.size) { console.log('越界,停止'); break; }
}
fs.closeSync(fd);
