import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const MIRRORED_BACKUP = 'I:/Delta Force custom animation/animation/animation_data.mirrored.json';
const targets = new Set([7, 18, 20, 21, 22, 23]);

// 1) 先把当前(已镜像)版本另存一份,保留为"真实镜像版"
fs.copyFileSync(SRC, MIRRORED_BACKUP);

// 2) 修改:隐藏其它所有图层,只留 6 个镜像图层,并把它们的透明度固定为 100
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));

let hiddenCount = 0, fixedCount = 0;
for (const l of j.layers) {
  if (targets.has(l.ind)) {
    l.hd = false;
    // 固定透明度 100%,始终可见
    if (l.ks && l.ks.o) {
      const ix = l.ks.o.ix, ll = l.ks.o.l;
      l.ks.o = { a: 0, k: 100 };
      if (ix !== undefined) l.ks.o.ix = ix;
      if (ll !== undefined) l.ks.o.l = ll;
      fixedCount++;
    }
  } else {
    l.hd = true;
    hiddenCount++;
  }
}

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('已生成"只看镜像图层"调试版: ' + SRC);
console.log('隐藏图层数: ' + hiddenCount);
console.log('保留并固定透明度的镜像图层数: ' + fixedCount);
console.log('真实镜像版备份: ' + MIRRORED_BACKUP);
