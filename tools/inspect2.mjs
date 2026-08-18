import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

// asset 名字补全
const assetName = (id) => {
  const a = j.assets.find(x => x.id === id);
  return a ? { id: a.id, hasP: a.p ? (typeof a.p === 'string' ? a.p.slice(0, 5) + '..' : 'obj') : null, u: a.u } : null;
};

function walk(layers, depth, out) {
  for (const l of layers || []) {
    const ks = l.ks || {};
    const getK = (prop) => {
      if (!prop) return null;
      if (prop.a === 0) return JSON.stringify(prop.k);
      if (Array.isArray(prop.k)) return 'anim(' + prop.k.length + 'key) prop:a=' + prop.a;
      return '?';
    };
    out.push({
      d: Array(depth).fill('  ').join(''),
      ind: l.ind, ty: l.ty, nm: (l.nm || '').trim(),
      ref: l.refId || '', parent: l.parent ?? '',
      scale: getK(ks.s), pos: ks.p ? (ks.p.a === 0 ? JSON.stringify(ks.p.k) : 'anim') : null,
      op: getK(ks.o),
    });
    if (l.layers) walk(l.layers, depth + 1, out);
  }
}
const flat = [];
walk(j.layers, 0, flat);

console.log('=== 所有图层(含预合成) ===');
for (const a of flat) {
  console.log(a.d + 'ind=' + a.ind + ' ty=' + a.ty + ' nm=[' + a.nm + ']' + (a.ref ? ' ref=' + a.ref : '') + ' scale=' + a.scale + ' parent=' + a.parent + ' op=' + a.op);
}

console.log('\n=== 引用图片的图层与对应 asset ===');
for (const a of flat) if (a.ref) {
  const info = assetName(a.ref);
  console.log('  ind=' + a.ind + ' nm=[' + a.nm + '] ref=' + a.ref + ' scale=' + a.scale + ' parent=' + a.parent + ' -> ' + JSON.stringify(info));
}
