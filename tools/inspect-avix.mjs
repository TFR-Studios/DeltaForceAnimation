// 解析 ffmpeg 生成的 >1GB AVI,观察 AVIX(ODML)扩展结构
import fs from 'node:fs';

const AVI = 'I:/Delta Force custom animation/tools/.big.avi';
const fd = fs.openSync(AVI, 'r');
const stat = fs.fstatSync(fd);
console.log('文件大小:', stat.size, 'bytes (', (stat.size / 1073741824).toFixed(2), 'GB)');

// 头部 1MB
const head = Buffer.alloc(1024 * 1024);
fs.readSync(fd, head, 0, head.length, 0);
console.log('RIFF:', head.toString('latin1', 0, 4), 'size=', head.readUInt32LE(4));
const riffSize = head.readUInt32LE(4);
console.log('RIFF size 实际-8:', stat.size - 8, riffSize === stat.size - 8 ? '✓' : '(可能截断/AVIX)');
const hdrlSize = head.readUInt32LE(16);
console.log('hdrl LIST size:', hdrlSize, 'fourcc:', head.toString('latin1', 20, 24));
const moviPos = 12 + 8 + hdrlSize;
console.log('movi LIST @', moviPos, 'size=', head.readUInt32LE(moviPos + 4), 'fourcc:', head.toString('latin1', moviPos + 8, moviPos + 12));

// 从 movi 数据区顺序解析块,记录 LIST/AVIX/movi/idx1 结构
const ch = Buffer.alloc(8);
const sub = Buffer.alloc(4);
let pos = moviPos + 12;
const structure = [];
let cnt = 0;
while (pos + 8 <= stat.size && cnt < 100000) {
  fs.readSync(fd, ch, 0, 8, pos);
  const id = ch.toString('latin1', 0, 4);
  const size = ch.readUInt32LE(4);
  if (id === 'LIST') {
    fs.readSync(fd, sub, 0, 4, pos + 8);
    const subId = sub.toString('latin1');
    structure.push({ off: pos, type: 'LIST', sub: subId, size });
    if (subId === 'idx1') break;
    pos += 8 + size;
  } else if (id === '00db' || id === '00dc' || id === '01wb' || id === '00wb') {
    if (structure.length < 12) structure.push({ off: pos, type: id, size });
    pos += 8 + size;
  } else if (id === 'idx1') {
    structure.push({ off: pos, type: 'idx1', size });
    break;
  } else {
    structure.push({ off: pos, type: id, size });
    pos += 8 + size;
  }
  cnt++;
}
console.log('\n结构摘要:');
for (const s of structure) {
  const gb = (s.size / 1073741824).toFixed(3);
  console.log(`  @${s.off} ${s.type}${s.sub ? '/' + s.sub : ''} size=${s.size} (${gb}GB)`);
}
console.log('(结构条目数:', structure.length, ')');
fs.closeSync(fd);
