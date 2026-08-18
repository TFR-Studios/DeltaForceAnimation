import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

// 递归找形状项里的颜色(fl 填充 / st 描边 / gf 渐变填充 / gs 渐变描边)
function collectColors(shapes, depth, out) {
  for (const sh of shapes || []) {
    const pad = '  '.repeat(depth);
    if (sh.ty === 'fl') {
      out.push({ type: '填充fl', nm: sh.nm, color: sh.c && sh.c.a === 0 ? sh.c.k : (Array.isArray(sh.c && sh.c.k) ? 'anim' : null), depth });
    } else if (sh.ty === 'st') {
      out.push({ type: '描边st', nm: sh.nm, color: sh.c && sh.c.a === 0 ? sh.c.k : (Array.isArray(sh.c && sh.c.k) ? 'anim' : null), depth });
    } else if (sh.ty === 'gf' || sh.ty === 'gs') {
      const stops = sh.g && sh.g.k && sh.g.k.k ? sh.g.k.k : null;
      out.push({ type: sh.ty === 'gf' ? '渐变填充gf' : '渐变描边gs', nm: sh.nm, gradient: stops ? stops.map(s => s.s) : null, depth });
    }
    if (sh.it) collectColors(sh.it, depth + 1, out);
  }
}

for (const l of j.layers) {
  if (l.ty !== 4) continue;
  const out = [];
  collectColors(l.shapes, 0, out);
  console.log('ind' + l.ind + ' [' + l.nm.trim() + ']:');
  for (const o of out) {
    console.log('   ' + o.type + ' ' + (o.nm || '') + ' = ' + JSON.stringify(o.color !== undefined ? o.color : o.gradient));
  }
}
