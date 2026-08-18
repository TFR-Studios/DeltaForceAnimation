import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
// 内容中心 X = pos.x + scale.x*anchor.x (无旋转),用于判断图层内容的实际水平位置
function contentX(l) {
  try {
    const a = l.ks && l.ks.a && l.ks.a.k;
    const p = l.ks && l.ks.p && l.ks.p.k;
    const s = l.ks && l.ks.s;
    if (s && s.a === 1) return 'anim-scale'; // 缩放动画无法简算
    const sx = s && s.a === 0 ? s.k[0] : 100;
    const ax = a && a.a === 0 ? a.k[0] : 0;
    const px = p && p.a === 0 ? p.k[0] : (Array.isArray(p) && p[0] && p[0].s ? p[0].s[0] : 'anim-pos');
    if (typeof px !== 'number') return 'anim-pos';
    return Math.round(px + sx * ax);
  } catch { return '?'; }
}
function walk(layers, out) {
  for (const l of layers || []) {
    out.push(l);
    if (l.layers) walk(l.layers, out);
  }
}
const all = [];
walk(j.layers, all);
console.log('全部图层(含预合成内)按内容中心X:');
for (const l of all) {
  const cx = contentX(l);
  const side = (typeof cx === 'number') ? (cx < 960 ? ' 左' : cx > 960 ? ' 右' : ' 中') : '';
  if (l.ty !== 3 && l.ty !== 6) { // 排除 null-control 和 audio
    console.log('ind=' + String(l.ind).padStart(2) + ' ty=' + l.ty + ' contentX=' + String(cx).padStart(6) + side + '  "' + (l.nm||'').trim() + '" parent=' + (l.parent??''));
  }
}
