// 看 ffmpeg AVI 主 RIFF 之后的结构(AVIX 扩展段)
import fs from 'node:fs';

const AVI = 'I:/Delta Force custom animation/tools/.big.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);

// 主 RIFF 结束位置 = 12 + riffSize
const head = Buffer.alloc(1024);
fs.readSync(fd, head, 0, 1024, 0);
const riffSize = head.readUInt32LE(4);
const riffEnd = 12 + riffSize;
console.log('主 RIFF 结束 @', riffEnd, '文件大小:', stat.size, '剩余:', stat.size - riffEnd);

// dump riffEnd 处 64 字节
const buf = Buffer.alloc(64);
fs.readSync(fd, buf, 0, 64, riffEnd);
console.log('riffEnd 处内容:', buf.toString('latin1', 0, 16).split('').map((c, i) => (c.charCodeAt(0) > 31 ? c : `\\x${c.charCodeAt(0).toString(16)}`)).join(''));
console.log('bytes:', [...buf.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' '));

// 从 riffEnd 开始解析块
const ch = Buffer.alloc(8);
let pos = riffEnd;
const items = [];
while (pos + 8 <= stat.size && items.length < 20) {
  fs.readSync(fd, ch, 0, 8, pos);
  const id = ch.toString('latin1', 0, 4);
  const size = ch.readUInt32LE(4);
  items.push({ off: pos, id, size });
  if (id === 'LIST') {
    const sub = Buffer.alloc(4);
    fs.readSync(fd, sub, 0, 4, pos + 8);
    items[items.length - 1].sub = sub.toString('latin1');
  }
  if (id === 'idx1') break;
  pos += 8 + size;
}
for (const it of items) console.log(`  @${it.off} ${it.id}${it.sub ? '/' + it.sub : ''} size=${it.size} (${(it.size / 1073741824).toFixed(3)}GB)`);
fs.closeSync(fd);
