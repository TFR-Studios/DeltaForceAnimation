import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const l = j.layers.find(x => x.ind === 19);
console.log('线长左 2 的形状内容(结构摘要):');
function summarize(shapes, depth) {
  for (const sh of shapes || []) {
    const pad = '  '.repeat(depth);
    if (sh.ty === 'sh') {
      const path = sh.ks.k;
      console.log(pad + '路径(sh): ' + (path.v ? path.v.length + ' 个顶点' : '?'));
      if (path.v) {
        for (const v of path.v) console.log(pad + '  顶点: ' + JSON.stringify(v));
      }
    } else if (sh.ty === 'st') {
      console.log(pad + '描边(st) 颜色=' + JSON.stringify(sh.c.k) + ' 宽度=' + JSON.stringify(sh.w.k));
    } else if (sh.ty === 'fl') {
      console.log(pad + '填充(fl) 颜色=' + JSON.stringify(sh.c.k));
    } else if (sh.ty === 'gr') {
      console.log(pad + '组(gr), 内含:');
      summarize(sh.it, depth + 1);
    } else {
      console.log(pad + 'ty=' + sh.ty + ' nm=' + (sh.nm||''));
    }
  }
}
summarize(l.shapes, 0);
