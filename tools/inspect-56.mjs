import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const l = j.layers.find(x => x.ind === 56);
const ks = l.ks || {};
console.log('图层 ind56 [' + l.nm.trim() + '] ty=' + l.ty + ' refId=' + l.refId + ' parent=' + (l.parent ?? '(无)'));
console.log('  anchor:', ks.a ? JSON.stringify(ks.a) : '(无)');
console.log('  position:', ks.p ? JSON.stringify(ks.p).slice(0, 800) : '(无)');
console.log('  scale:', ks.s ? JSON.stringify(ks.s) : '(无)');
console.log('  opacity:', ks.o ? JSON.stringify(ks.o).slice(0, 400) : '(无)');
console.log('  rotation:', ks.r ? JSON.stringify(ks.r) : '(无)');
console.log('  effects(ef):');
if (Array.isArray(l.ef)) {
  for (const e of l.ef) {
    console.log('    ty=' + e.ty + ' nm=' + e.nm + ' mn=' + e.mn + ' en=' + e.en);
  }
} else {
  console.log('    (无)');
}
console.log('  ip:', l.ip, ' op:', l.op, ' hd:', l.hd);
