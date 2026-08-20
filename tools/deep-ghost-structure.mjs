// 深挖:有残影的视频.avi 的实际内容结构
import fs from 'node:fs';

const AVI = 'I:/Delta Force custom animation/有残影的视频.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
console.log('文件大小:', (stat.size / 1024 / 1024 / 1024).toFixed(2), 'GB');

const headBuf = Buffer.alloc(4 * 1024 * 1024);
fs.readSync(fd, headBuf, 0, headBuf.length, 0);
const riffSize = headBuf.readUInt32LE(4);
const hdrlListSize = headBuf.readUInt32LE(16);
const moviPos = 12 + 8 + hdrlListSize;
const moviSize = headBuf.readUInt32LE(moviPos + 4);
const moviDataStart = moviPos + 8;
console.log('RIFF size:', riffSize, '| hdrl:', hdrlListSize, '| movi @', moviPos, 'size:', moviSize);

// 从 movi 数据区顺序解析,直到 idx1 或文件尾
const chunkHead = Buffer.alloc(8);
let pos = moviDataStart;
let frameCount = 0;
let audioCount = 0;
let otherCount = 0;
let maxPos = moviDataStart;
const frameSizes = new Map();
let firstFrames = [];
let stopReason = '';

while (pos + 8 <= stat.size) {
  fs.readSync(fd, chunkHead, 0, 8, pos);
  const id = chunkHead.toString('latin1', 0, 4);
  const size = chunkHead.readUInt32LE(4);
  if (id === '00db' || id === '00dc' || id === '00wb' || id === '01wb' || id === '00dc') {
    if (id === '00db' || id === '00dc') {
      frameCount++;
      frameSizes.set(size, (frameSizes.get(size) || 0) + 1);
      if (firstFrames.length < 5) firstFrames.push({ idx: frameCount - 1, size });
    } else {
      audioCount++;
    }
    pos += 8 + size;
    maxPos = Math.max(maxPos, pos);
    if (frameCount > 620) { stopReason = '帧数超限'; break; }
  } else if (id === 'idx1') {
    stopReason = '遇到 idx1';
    break;
  } else if (id === 'LIST') {
    // 可能是嵌套 LIST
    const sub = chunkHead.toString('latin1', 8, 12);
    if (sub === 'movi') { pos += 8; continue; }
    pos += 8 + size;
    otherCount++;
  } else {
    // 未知块:可能是音频块(如 00wb/01wb 之外的)或垃圾
    otherCount++;
    pos += 8 + size;
  }
  if (pos > stat.size) { stopReason = '越界'; break; }
}
console.log('解析停止:', stopReason, '@', pos);
console.log('视频帧数:', frameCount, '| 音频块:', audioCount, '| 其他块:', otherCount);
console.log('前5帧大小:', JSON.stringify(firstFrames));
console.log('帧大小分布:', JSON.stringify([...frameSizes.entries()].slice(0, 10)));
console.log('解析到的最大位置:', maxPos, '文件大小:', stat.size, '剩余:', stat.size - maxPos);

// 文件末尾是什么(idx1 前)?
const tailStart = Math.max(0, stat.size - 4096);
const tail = Buffer.alloc(stat.size - tailStart);
fs.readSync(fd, tail, 0, tail.length, tailStart);
const tailStr = tail.toString('latin1');
console.log('文件末尾包含 idx1:', tailStr.includes('idx1'));
console.log('文件末尾包含 RIFF:', tailStr.includes('RIFF'));

// 检查文件中间是否有第二个 RIFF/AVI(拼接文件?)
const midBuf = Buffer.alloc(2 * 1024 * 1024);
let extraRiff = 0;
for (let off = 4 * 1024 * 1024; off < stat.size - 12; off += 2 * 1024 * 1024) {
  const n = Math.min(2 * 1024 * 1024, stat.size - off);
  fs.readSync(fd, midBuf, 0, n, off);
  for (let i = 0; i < n - 12; i++) {
    if (midBuf[i] === 0x52 && midBuf[i + 1] === 0x49 && midBuf[i + 2] === 0x46 && midBuf[i + 3] === 0x46) extraRiff++;
  }
}
console.log('文件中部额外 RIFF 标记数:', extraRiff);
fs.closeSync(fd);
