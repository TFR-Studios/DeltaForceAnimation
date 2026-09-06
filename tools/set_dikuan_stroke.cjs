/* 修改「底框」「底框(可见)」图层的红色描边为 #e23b3b */
const fs = require('fs');
const path = 'i:/Delta Force custom animation/animation_2/animation_data.json';
const d = JSON.parse(fs.readFileSync(path, 'utf8'));

const OLD = [0.882352941176, 0.224842505362, 0.221453273998, 1];
const NEW = [0.8862745098, 0.231372549, 0.231372549, 1]; // #e23b3b

const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

let changed = 0;
const walk = (layers) => {
  for (const l of layers ?? []) {
    if (/底框/.test(l.nm || '')) {
      for (const s of l.shapes ?? []) {
        if (s.ty !== 'gr') continue;
        for (const it of s.it ?? []) {
          if (it.ty === 'st' && it.c && close(it.c.k, OLD)) {
            it.c.k = NEW.slice();
            changed++;
          }
        }
      }
    }
    if (Array.isArray(l.layers)) walk(l.layers);
  }
};
walk(d.layers);

fs.writeFileSync(path, JSON.stringify(d));
console.log('changed strokes:', changed);
