// 把 animation_2 中「百叶窗.png」图层的透明度关键帧中间值从 34 调高到 100
// (保持 0/60 帧的淡入淡出端点不变)
const fs = require('fs');
const path = 'i:/Delta Force custom animation/animation_2/animation_data.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const layer = data.layers.find((l) => l.nm === '百叶窗.png' && l.ty === 2);
if (!layer) {
  console.error('未找到百叶窗.png 图层');
  process.exit(1);
}
const kf = layer.ks.o.k;
let changed = 0;
for (const k of kf) {
  if (Array.isArray(k.s) && k.s[0] === 34) {
    k.s[0] = 100;
    changed++;
  }
}
fs.writeFileSync(path, JSON.stringify(data));
console.log('已将百叶窗透明度关键帧 34 -> 100, 共修改 ' + changed + ' 处');
