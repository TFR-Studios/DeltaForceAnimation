import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

function dump(ind, label) {
  const l = j.layers.find(x => x.ind === ind);
  if (!l) { console.log(label + ' (ind' + ind + '): 未找到'); return; }
  const ks = l.ks || {};
  const a = ks.a ? (ks.a.a===0 ? JSON.stringify(ks.a.k) : 'anim') : '?';
  const p = ks.p ? (ks.p.a===0 ? JSON.stringify(ks.p.k) : (Array.isArray(ks.p.k)?ks.p.k.map(f=>f.t+'→'+JSON.stringify(f.s)).join('; '):'anim')) : '?';
  const s = ks.s ? (ks.s.a===0 ? JSON.stringify(ks.s.k) : (Array.isArray(ks.s.k)?ks.s.k.map(f=>f.t+'→'+JSON.stringify(f.s)).join('; '):'anim')) : '?';
  const o = ks.o ? (ks.o.a===0 ? ks.o.k : (Array.isArray(ks.o.k)?ks.o.k.map(f=>f.t+'→'+JSON.stringify(f.s)).join('; '):'anim')) : '?';
  console.log(label + ' (ind' + ind + ') ty=' + l.ty + ' parent=' + (l.parent ?? '(无)'));
  console.log('   anchor=' + a);
  console.log('   pos=' + p);
  console.log('   scale=' + s);
  console.log('   opacity=' + o);
}

dump(19, '线长左 2');
dump(30, '线长左');
