import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

const inds = [7, 18, 20, 21, 22, 23];
const names = { 7:'绿色 2', 18:'长白线 2', 20:'最短线左 2', 21:'短线左 2', 22:'方框左 2', 23:'点左 2' };

function dumpLayer(l, label) {
  const ks = l.ks || {};
  console.log('==== ' + label + ' (ind=' + l.ind + ' nm="' + l.nm + '") ====');
  // 锚点 a
  console.log('anchor (a):', ks.a ? JSON.stringify(ks.a) : '(无)');
  // 位置 p
  console.log('position (p):', ks.p ? JSON.stringify(ks.p).slice(0, 600) : '(无)');
  // 缩放 s
  console.log('scale (s):', ks.s ? JSON.stringify(ks.s).slice(0, 600) : '(无)');
  // 旋转 r
  console.log('rotation (r):', ks.r ? JSON.stringify(ks.r).slice(0, 300) : '(无)');
  // 形状内容(用于更好描述)
  console.log('has shapes:', l.shapes ? l.shapes.length : 0, '| singleShape:', l.singleShape ? 'Y' : 'N');
  console.log('---');
}

for (const ind of inds) {
  const l = j.layers.find(x => x.ind === ind);
  if (l) dumpLayer(l, names[ind] + ' @ind' + ind);
  else console.log('!! 未找到 ind=' + ind);
}
