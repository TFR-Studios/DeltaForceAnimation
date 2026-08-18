import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

// 遍历所有图层,找含有 sl(图层样式)/ ef(效果) 的图层,尤其是文字层
function findShadow(l, path) {
  const hits = [];
  const hasSl = l.sl && (Array.isArray(l.sl) ? l.sl.length : Object.keys(l.sl).length);
  const hasEf = l.ef && (Array.isArray(l.ef) ? l.ef.length : Object.keys(l.ef).length);
  if (hasSl || hasEf) {
    hits.push({ ind: l.ind, ty: l.ty, nm: (l.nm||'').trim(), sl: l.sl, ef: l.ef, path });
  }
  if (l.layers) for (const c of l.layers) hits.push(...findShadow(c, path + '/' + (l.nm||'').trim()));
  return hits;
}
const hits = findShadow({layers: j.layers}, 'ROOT');
console.log('找到含 sl/ef 的图层数量:', hits.length);
for (const h of hits) {
  console.log('\n==== ind' + h.ind + ' ty=' + h.ty + ' [' + h.nm + '] ====');
  if (h.sl) console.log('  sl(图层样式):', JSON.stringify(h.sl).slice(0, 1500));
  if (h.ef) console.log('  ef(效果):', JSON.stringify(h.ef).slice(0, 1500));
}

// 也直接统计所有图层里有没有 "ds" 关键字段
const raw = JSON.stringify(j);
console.log('\n全文件关键词统计:');
for (const kw of ['"ds"', '"sl"', '"ef"', 'Drop Shadow', '投影']) {
  let count = 0, idx = 0;
  while ((idx = raw.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
  console.log('  ' + kw + ' 出现 ' + count + ' 次');
}
