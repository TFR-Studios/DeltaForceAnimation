import fs from 'node:fs';
const BASE = 'I:/Delta Force custom animation/animation/animation_data.mirrored.json';
const OUT = 'I:/Delta Force custom animation/animation/animation_data.json';
const W = 1920;

const j = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const byInd = (ind) => j.layers.find(x => x.ind === ind);

function mirrorScaleX(prop) {
  if (prop.a === 0) { prop.k[0] = -prop.k[0]; }
  else if (Array.isArray(prop.k)) { for (const f of prop.k) if (f.s) f.s[0] = -f.s[0]; }
}
function mirrorPosX(prop) {
  if (prop.a === 0) { prop.k[0] = W - prop.k[0]; }
  else if (Array.isArray(prop.k)) { for (const f of prop.k) if (f.s) f.s[0] = W - f.s[0]; }
}

const report = [];
// 镜像父级空对象 15、16(子图层 13、14 自动跟随)
for (const ind of [15, 16]) {
  const l = byInd(ind);
  mirrorScaleX(l.ks.s);
  mirrorPosX(l.ks.p);
  report.push('null ind' + ind + ' [' + l.nm.trim() + ']: 已镜像(scale.x取负 + pos.x反射)');
}
// 镜像无父级的 形状图层5
{
  const l = byInd(17);
  mirrorScaleX(l.ks.s);
  mirrorPosX(l.ks.p);
  report.push('ind17 [' + l.nm.trim() + ']: 已镜像');
}

fs.writeFileSync(OUT, JSON.stringify(j));
console.log('已写入 ' + OUT);
report.forEach(r => console.log('  ' + r));

// 打印修改后的值确认
console.log('\n验证:');
for (const ind of [15, 16, 17]) {
  const l = byInd(ind);
  const sx = l.ks.s.a===0 ? JSON.stringify(l.ks.s.k) : 'anim';
  const px = l.ks.p.a===0 ? JSON.stringify(l.ks.p.k) : l.ks.p.k.map(f=>f.t+'→'+JSON.stringify(f.s)).join('; ');
  console.log('  ind' + ind + ' [' + l.nm.trim() + '] scale=' + sx + ' pos=' + px);
}
