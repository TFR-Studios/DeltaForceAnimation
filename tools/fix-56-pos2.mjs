import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const l = j.layers.find(x => x.ind === 56);

// 用标准非分离静态位置覆盖(分离格式解析有偏差)
l.ks.p = { a: 0, k: [260.7, 417.6, 0], ix: 2, l: 2 };

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('位置已改为标准静态格式:');
console.log('  p =', JSON.stringify(l.ks.p));
