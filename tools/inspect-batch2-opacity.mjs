import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirrored.json','utf8'));

function showOpacity(ind, label) {
  const l = j.layers.find(x => x.ind === ind);
  const o = l.ks.o;
  let desc;
  if (o.a === 0) desc = '静态 ' + o.k;
  else if (Array.isArray(o.k)) desc = o.k.map(k => 't' + k.t + '→' + JSON.stringify(k.s)).join('; ');
  else desc = JSON.stringify(o).slice(0, 200);
  console.log(label + ' (ind' + ind + '): ' + desc);
}

console.log('=== 目标图层不透明度 ===');
showOpacity(13, '形状图层 7');
showOpacity(14, '形状图层 6');
showOpacity(17, '形状图层 5');

console.log('\n=== 父级空对象位置动画 ===');
for (const ind of [15, 16]) {
  const l = j.layers.find(x => x.ind === ind);
  const p = l.ks.p;
  if (Array.isArray(p.k)) {
    console.log('ind' + ind + ' [' + l.nm.trim() + '] 位置关键帧:');
    for (const kf of p.k) {
      console.log('   t=' + kf.t + ' → ' + JSON.stringify(kf.s));
    }
  }
}
