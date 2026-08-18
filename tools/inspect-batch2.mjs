import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirrored.json','utf8'));

function dump(ind, label) {
  const l = j.layers.find(x => x.ind === ind);
  if (!l) { console.log(label + ' (ind' + ind + '): 未找到'); return; }
  const ks = l.ks || {};
  const a = ks.a ? (ks.a.a===0 ? JSON.stringify(ks.a.k) : 'anim') : '?';
  const p = ks.p ? (ks.p.a===0 ? JSON.stringify(ks.p.k) : (Array.isArray(ks.p.k)?'anim('+ks.p.k.length+')':'anim')) : '?';
  const s = ks.s ? (ks.s.a===0 ? JSON.stringify(ks.s.k) : 'anim') : '?';
  const o = ks.o ? (ks.o.a===0 ? ks.o.k : 'anim') : '?';
  console.log(label + ' (ind' + ind + ') ty=' + l.ty + ' parent=' + (l.parent ?? '(无)') + ' hd=' + l.hd);
  console.log('   anchor=' + a + ' pos=' + p + ' scale=' + s + ' opacity=' + o);
}

console.log('=== 目标图层 ===');
dump(13, '形状图层 7');
dump(14, '形状图层 6');
dump(17, '形状图层 5');

console.log('\n=== 父级空对象 ===');
dump(15, '形状图层 2: 路径 1 [1.1.0] 2 (null)');
dump(16, '形状图层 2: 路径 1 [1.1.1] 2 (null)');

console.log('\n=== 对照(非镜像版,即原始层) ===');
dump(24, '形状图层 4');
dump(25, '形状图层 3');
dump(28, '形状图层 2');
dump(26, '形状图层 2: 路径 1 [1.1.0] (null)');
dump(27, '形状图层 2: 路径 1 [1.1.1] (null)');
