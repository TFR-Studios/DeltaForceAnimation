// Dump idx1 raw entries from an AVI (top-level chunk walk), compare std vs ours.
import fs from 'node:fs';

function walk(path, label) {
  const fd = fs.openSync(path, 'r');
  const b = Buffer.alloc(8);
  fs.readSync(fd, b, 0, 8, 0);
  const riffTag = b.toString('ascii', 0, 4);
  const riffSize = b.readUInt32LE(4);
  console.log(`\n=== ${label}: ${path}`);
  console.log(`riff=${riffTag} size=${riffSize} (0x${riffSize.toString(16)})`);
  let pos = 12; // past RIFF + size
  let idx1Pos = -1, idx1Size = 0, moviList = -1, moviSize = 0, hdrlSize = 0;
  while (pos + 8 <= riffSize + 8) {
    fs.readSync(fd, b, 0, 8, pos);
    const tag = b.toString('ascii', 0, 4);
    const size = b.readUInt32LE(4);
    if (tag === 'movi') { moviList = pos; moviSize = size; }
    if (tag === 'hdrl') hdrlSize = size;
    if (tag === 'idx1') { idx1Pos = pos; idx1Size = size; }
    pos += 8 + size;
    if (pos >= riffSize + 8) break;
    if (pos + 8 > riffSize + 8) { console.log('  (walk fell off end)'); break; }
  }
  console.log(`hdrl=${hdrlSize} movi@${moviList} size=${moviSize} (0x${moviSize.toString(16)}) idx1@${idx1Pos} size=${idx1Size} entries=${idx1Size / 16}`);
  if (idx1Pos < 0) { console.log('  NO idx1 found!'); return; }
  const e = Buffer.alloc(16);
  const n = idx1Size / 16;
  const show = (i) => {
    fs.readSync(fd, e, 0, 16, idx1Pos + 8 + i * 16);
    const tag = e.toString('ascii', 0, 4);
    const flags = e.readUInt32LE(4);
    const off = e.readUInt32LE(8);
    const size = e.readUInt32LE(12);
    console.log(`  [${i}] ${tag} flags=0x${flags.toString(16)} off=${off} size=${size}  (pos=${moviList + 4 + off})`);
  };
  for (let i = 0; i < Math.min(4, n); i++) show(i);
  if (n > 8) { console.log('  ...'); for (let i = n - 3; i < n; i++) show(i); }
  fs.closeSync(fd);
}

walk(process.argv[2], process.argv[3] || 'file');
