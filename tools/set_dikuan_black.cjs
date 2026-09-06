/* 将「底框」「底框(可见)」图层的所有填充颜色改为黑色 [0,0,0,1] */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'animation_2', 'animation_data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let changed = 0;
for (const l of data.layers ?? []) {
  if (l.nm !== '底框' && l.nm !== '底框(可见)') continue;
  const walk = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'fl' && Array.isArray(it.c?.k)) {
        it.c.k = [0, 0, 0, 1];
        changed++;
      }
      if (Array.isArray(it.it)) walk(it.it);
    }
  };
  walk(l.shapes);
}

fs.writeFileSync(file, JSON.stringify(data));
console.log('已修改填充数量:', changed);
