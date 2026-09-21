import fs from 'fs';
const p = 'I:/Delta Force custom animation/animations/animation_1/animation_data.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log('canvas', j.w, 'x', j.h, 'fr', j.fr, 'ip', j.ip, 'op', j.op, 'dur=', ((j.op-j.ip)/j.fr).toFixed(2)+'s');
console.log('=== top layers (' + j.layers.length + ') ===');
for (const L of j.layers) {
  let txt = '';
  if (L.t && L.t.d && L.t.d.k && L.t.d.k[0] && L.t.d.k[0].s) txt = JSON.stringify(L.t.d.k[0].s.t);
  let extra = '';
  if (L.refId) extra += ' refId=' + L.refId;
  if (L.shapes) extra += ' shapes=' + L.shapes.length;
  const hasKey = L.ks && Object.entries(L.ks).filter(([k,v]) => v && v.a === 1).map(([k])=>k);
  if (hasKey && hasKey.length) extra += ' animatedKS=' + hasKey.join(',');
  console.log('ind=' + L.ind, 'ty=' + L.ty, 'nm=' + L.nm, 'parent=' + (L.parent ?? '-'),
    'tt=' + (L.tt ?? '-'), 'ip=' + L.ip, 'op=' + L.op, txt, extra);
}
console.log('=== assets by kind ===');
let imgs = 0, b64 = 0, pre = [];
for (const a of j.assets) {
  if (a.layers) pre.push(a);
  else { imgs++; if (typeof a.p === 'string' && a.p.startsWith('data:')) b64++; }
}
console.log('image assets:', imgs, '(inline base64:', b64 + ')', 'precomps:', pre.length);
for (const a of pre) console.log('  PRECOMP id=' + a.id + ' layers=' + a.layers.length);
console.log('=== precomp layer names ===');
for (const a of pre) {
  for (const L of a.layers) {
    let txt = '';
    if (L.t && L.t.d && L.t.d.k && L.t.d.k[0] && L.t.d.k[0].s) txt = JSON.stringify(L.t.d.k[0].s.t);
    console.log('  [' + a.id + '] ind=' + L.ind, 'ty=' + L.ty, 'nm=' + L.nm, 'tt=' + (L.tt ?? '-'), txt);
  }
}
