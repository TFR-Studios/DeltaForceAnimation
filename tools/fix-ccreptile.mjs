import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.pre-ccreptile-fix.json';
fs.copyFileSync(SRC, BACKUP);

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const l = j.layers.find(x => x.ind === 56);

// 1) 移除 CC RepeTile 效果(唯一效果,直接删 ef)
if (Array.isArray(l.ef)) {
  delete l.ef;
  console.log('已移除 CC RepeTile 效果');
}

// 2) 位置:x=260.7, y=417.6(静态)
l.ks.p.x.k = 260.7;
l.ks.p.y = { a: 0, k: 417.6 };

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('位置已设为 x=260.7, y=417.6');
console.log('备份: ' + BACKUP);

// 打印确认
console.log('\n确认:');
console.log('  anchor:', JSON.stringify(l.ks.a.k));
console.log('  position.x:', JSON.stringify(l.ks.p.x));
console.log('  position.y:', JSON.stringify(l.ks.p.y));
console.log('  scale:', JSON.stringify(l.ks.s.k));
console.log('  ef:', l.ef === undefined ? '已删除' : '仍在');
