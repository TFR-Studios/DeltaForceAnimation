import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.pre-center-text.json';
fs.copyFileSync(SRC, BACKUP);

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const inds = [40, 41, 43, 44, 46, 47, 48];
let changed = 0;

for (const ind of inds) {
  const l = j.layers.find(x => x.ind === ind);
  if (!l) { console.log('未找到 ind' + ind); continue; }
  const td = l.t?.d?.k;
  if (!td) continue;
  if (Array.isArray(td)) {
    for (const kf of td) {
      if (kf.s) { kf.s.j = 2; changed++; }
    }
  } else if (td.s) {
    td.s.j = 2;
    changed++;
  }
  console.log('ind' + ind + ' [' + l.nm.trim() + '] 已居中(j=2), 关键帧数=' + (Array.isArray(td) ? td.length : 1));
}

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('\n已修改 ' + changed + ' 处文字对齐');
console.log('备份: ' + BACKUP);
