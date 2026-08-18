import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const l = j.layers.find(x => x.ind === 19);
const s = l.ks.s;
if (s.a === 0) { s.k[0] = -s.k[0]; }
else if (Array.isArray(s.k)) { for (const f of s.k) if (f.s) f.s[0] = -f.s[0]; }
fs.writeFileSync(SRC, JSON.stringify(j));
console.log('线长左 2 (ind19) 缩放已镜像:');
console.log('  scale =', JSON.stringify(l.ks.s.k));
console.log('  pos(不变) =', JSON.stringify(l.ks.p.k));
