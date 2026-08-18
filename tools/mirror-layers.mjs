import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.mirror-backup.json';
const W = 1920; // 画面宽
const targets = { 7:'绿色 2', 18:'长白线 2', 20:'最短线左 2', 21:'短线左 2', 22:'方框左 2', 23:'点左 2' };
const inds = Object.keys(targets).map(Number);

fs.copyFileSync(SRC, BACKUP);
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function mirrorPx(pArr) { pArr[0] = W - pArr[0]; } // X 镜像
function mirrorSx(sArr) { sArr[0] = -sArr[0]; }   // X 缩放取负
// 若缩放有动画(关键帧数组)
function mirrorScale(prop) {
  if (prop.a === 0) { mirrorSx(prop.k); return 'static'; }
  if (Array.isArray(prop.k)) { for (const f of prop.k) if (f.s) mirrorSx(f.s); return 'anim(' + prop.k.length + ')'; }
  return '?';
}
function mirrorPos(prop) {
  if (prop.a === 0) { mirrorPx(prop.k); return; }
  if (Array.isArray(prop.k)) { for (const f of prop.k) if (f.s) mirrorPx(f.s); }
}

const report = [];
for (const ind of inds) {
  const l = j.layers.find(x => x.ind === ind);
  if (!l) { report.push('ind' + ind + ': 未找到'); continue; }
  const ks = l.ks;
  const sc = mirrorScale(ks.s);
  const hasPos = ks.p ? (mirrorPos(ks.p), true) : false;
  report.push('ind' + ind + ' [' + targets[ind] + ']: scale=' + sc + ' pos 已镜像=' + hasPos);
}

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('已修改并写回 ' + SRC);
console.log('备份: ' + BACKUP);
report.forEach(r => console.log('  ' + r));
