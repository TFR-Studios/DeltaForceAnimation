import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.preshadow.json';
fs.copyFileSync(SRC, BACKUP);

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const shadowInds = [40, 41, 43, 44, 46, 47, 48];
let stripped = 0;
for (const ind of shadowInds) {
  const l = j.layers.find(x => x.ind === ind);
  if (!l) { console.log('未找到 ind' + ind); continue; }
  if (Array.isArray(l.ef)) {
    const before = l.ef.length;
    const kept = l.ef.filter(e => e.ty !== 25); // 移除 ADBE Drop Shadow(ty=25)
    if (kept.length === 0) { delete l.ef; } else { l.ef = kept; }
    if (before !== kept.length) stripped++;
    console.log('ind' + ind + ' [' + l.nm.trim() + ']: ef ' + before + ' -> ' + (l.ef ? kept.length : '删除'));
  }
}
fs.writeFileSync(SRC, JSON.stringify(j));
console.log('\n已移除 ' + stripped + ' 个文字层的投影效果');
console.log('备份: ' + BACKUP);
