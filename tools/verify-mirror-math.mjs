import fs from 'node:fs';
const ORIG = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirror-backup.json','utf8'));
const MIRR = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const W = 1920;
const inds = [7,18,20,21,22,23];

// 计算图层内容在画面内的中心 X
// 变换: pos + scale·(v + anchor),scale.x 可为负。内容相对锚点的局部 bbox 我们取 anchor 作为内容近似中心,
// 实际内容中心 = pos.x + scale.x * anchor.x (当 scale.x=1) ;镜像后 scale.x=-1,内容中心 = pos.x + (-1)*anchor.x
function contentCenterX(l, scaleNow) {
  const a = l.ks.a.k[0];
  const p = l.ks.p.k[0];
  const s = l.ks.s.a === 0 ? l.ks.s.k[0] : (scaleNow ? (Array.isArray(l.ks.s.k) ? l.ks.s.k[0].s[0] : 100) : 100);
  return p + s * a;
}
console.log('图层 | 原始内容X | 镜像后内容X | 期望(1920-原始) | 一致?');
let allOk = true;
for (const ind of inds) {
  const lo = ORIG.layers.find(x=>x.ind===ind);
  const lm = MIRR.layers.find(x=>x.ind===ind);
  const origX = contentCenterX(lo, false);
  const mirX = contentCenterX(lm, true);
  const expect = W - origX;
  const ok = Math.abs(mirX - expect) < 0.01;
  if (!ok) allOk = false;
  console.log((lm.nm||'').trim() + ' | ' + origX.toFixed(1) + ' | ' + mirX.toFixed(1) + ' | ' + expect.toFixed(1) + ' | ' + (ok?'✔':'✘'));
}
console.log('全部一致:', allOk);
