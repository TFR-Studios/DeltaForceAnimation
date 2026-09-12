import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('animation_2/animation_data.json', 'utf8'));
const BUFFER = 5; // DURATION_BUFFER
const targetEnd = Math.round(1.25 * (d.fr || 60)) + BUFFER; // 75 + 5? 见 applyMainDuration
console.log('fr=', d.fr, 'op=', d.op, 'targetEnd(seconds*fr)=', Math.round(1.25 * (d.fr||60)), 'DURATION_BUFFER=?');
const rows = [];
const walk = (layers, depth, prefix) => {
  for (const l of layers ?? []) {
    const o = l.ks && l.ks.o;
    if (o && o.a === 1 && Array.isArray(o.k) && o.k.length >= 2) {
      const kf = o.k;
      const last = kf[kf.length - 1], prev = kf[kf.length - 2];
      const lastVal = Number(Array.isArray(last.s) ? last.s[0] : last.s);
      const prevVal = Number(Array.isArray(prev.s) ? prev.s[0] : prev.s);
      const isSecond = l.ind >= 100;
      const fadesOut = lastVal < prevVal;
      rows.push({ ind: l.ind, nm: (l.nm||''), ty: l.ty, depth, second: isSecond, kf: kf.length,
        times: kf.map(k => k.t).join(','), vals: kf.map(k => Array.isArray(k.s)? k.s[0] : k.s).join(','),
        fadesOut, gap: Math.max(1, last.t - prev.t), shiftedTo: fadesOut ? (Math.round(1.25*(d.fr||60)) - Math.max(1,last.t-prev.t)) + '->' + Math.round(1.25*(d.fr||60)) : '--' });
    }
    if (Array.isArray(l.layers)) walk(l.layers, depth + 1, prefix + '/' + (l.nm||''));
  }
};
walk(d.layers, 0, '');
console.log('共 ' + rows.length + ' 个带透明度动画的图层');
for (const r of rows) {
  console.log('ind=' + String(r.ind).padStart(3) + ' ' + (r.second ? '[二段]' : '[主段]') + ' ' + JSON.stringify(r.nm).padEnd(18) + ' ty=' + r.ty + ' 帧=' + r.times.padEnd(22) + ' 值=' + r.vals.padEnd(22) + (r.fadesOut ? ' 淡出 gap=' + r.gap + ' → ' + r.shiftedTo : ' 非淡出(不平移)'));
}