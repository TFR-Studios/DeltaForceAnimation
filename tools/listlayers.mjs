import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const flat = [];
function walk(layers, path, out) {
  for (const l of layers || []) {
    const ks = l.ks || {};
    const scale = ks.s ? (ks.s.a === 0 ? JSON.stringify(ks.s.k) : 'anim(' + (Array.isArray(ks.s.k)?ks.s.k.length:ks.s.k)+')') : null;
    const pos = ks.p ? (ks.p.a === 0 ? JSON.stringify(ks.p.k) : 'anim') : null;
    out.push({ ind: l.ind, ty: l.ty===0?'PRE':l.ty===2?'IMG':l.ty===4?'SHAPE':l.ty===5?'TEXT':l.ty===3?'NULL':l.ty===6?'AUD':'?'+l.ty, nm:(l.nm||'').trim(), scale, pos, ref:l.refId||'', parent:l.parent??'', path });
    if (l.layers) walk(l.layers, path + '/' + (l.nm||'').trim(), out);
  }
}
walk(j.layers, '', flat);
// 只列形状和图片
for (const a of flat) {
  if (a.ty === 'SHAPE' || a.ty === 'IMG') {
    console.log('ind=' + a.ind + ' [' + a.ty + '] nm="' + a.nm + '" scale=' + a.scale + ' pos=' + a.pos + ' ref=' + a.ref + ' parent=' + a.parent);
  }
}
console.log('\n--- 全部图层类型统计 ---');
const cnt = {};
for (const a of flat) cnt[a.ty] = (cnt[a.ty]||0)+1;
console.log(JSON.stringify(cnt));
