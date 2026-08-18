import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

function walkLayers(layers, path, out) {
  for (const l of layers || []) {
    const ks = l.ks || {};
    let scaleStr = null;
    if (ks.s && ks.s.a === 0) scaleStr = JSON.stringify(ks.s.k);
    else if (ks.s && Array.isArray(ks.s.k)) scaleStr = ks.s.k.map(f => f && f.s ? JSON.stringify(f.s) : null).filter(Boolean).join(';');
    out.push({
      ind: l.ind, ty: l.ty, nm: (l.nm||'').trim(), path,
      hasRef: !!(l.refId), refId: l.refId, parent: l.parent,
      scale: scaleStr, singleShape: l.singleShape ? true : false,
    });
    if (l.layers) walkLayers(l.layers, path + ' > ' + (l.nm||'').trim(), out);
  }
}
const all = [];
walkLayers(j.layers, 'ROOT', all);

console.log('=== 负缩放(镜像)图层 ===');
let mirrorFound = false;
for (const a of all) {
  if (!a.scale) continue;
  const m = String(a.scale).match(/-?\d+(?:\.\d+)?/g);
  if (m && m.map(Number).some(v => v < 0)) {
    mirrorFound = true;
    console.log('  ind=' + a.ind + ' ty=' + a.ty + ' nm=[' + a.nm + '] scale=' + JSON.stringify(a.scale) + ' path=' + a.path);
  }
}
if (!mirrorFound) console.log('  (无)');

console.log('\n=== 含"左中上"的图层 ===');
for (const a of all) if (a.nm.includes('左中上'))
  console.log('  ind=' + a.ind + ' ty=' + a.ty + ' nm=[' + a.nm + '] hasRef=' + a.hasRef + ' refId=' + a.refId + ' scale=' + JSON.stringify(a.scale) + ' path=' + a.path);

console.log('\n=== 所有含图片资产(refId)的图层 ===');
for (const a of all) if (a.hasRef) {
  const asset = j.assets.find(x => x.id === a.refId);
  console.log('  ind=' + a.ind + ' ty=' + a.ty + ' nm=[' + a.nm + '] refId=' + a.refId + ' assetNm=' + (asset ? asset.nm : '?') + ' u='+(asset&&asset.u||'')+' p='+(asset&&asset.p||'')+' hasDataURI='+(asset&&typeof asset.p==='string'&&asset.p.startsWith('data:')));
}

console.log('\n=== 资产清单(u/p不空的是图片) ===');
for (const a of j.assets.filter(x => x.u || x.p)) {
  console.log('  id=' + a.id + ' nm=' + a.nm + ' u=' + a.u + ' p=' + (typeof a.p==='string' ? String(a.p).slice(0,30) : '?'));
}
