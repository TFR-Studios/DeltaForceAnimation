import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const inds = [7,18,20,21,22,23];
const names = {7:'绿色 2',18:'长白线 2',20:'最短线左 2',21:'短线左 2',22:'方框左 2',23:'点左 2'};
for (const ind of inds) {
  const l = j.layers.find(x => x.ind === ind);
  const o = l.ks.o;
  console.log('ind' + ind + ' [' + names[ind] + '] 不透明度:');
  if (o.a === 0) console.log('   静态:', o.k);
  else if (Array.isArray(o.k)) {
    for (const kf of o.k) {
      console.log('   t=' + kf.t + ' → ' + JSON.stringify(kf.s) + (kf.i ? ' 缓动in' : '') + (kf.o ? ' 缓动out' : ''));
    }
  } else {
    console.log('   ', JSON.stringify(o).slice(0, 300));
  }
}
// 也看看对应的非2图层是否透明度不同
console.log('\n对照:非2版本的不透明度');
const map2 = {12:'绿色',29:'长白线',31:'最短线左',32:'短线左',33:'方框左',34:'点左'};
for (const [ind,nm] of Object.entries(map2)) {
  const l = j.layers.find(x => x.ind === Number(ind));
  const o = l.ks.o;
  const val = o.a === 0 ? o.k : (Array.isArray(o.k) ? o.k.map(k=>k.t+'→'+k.s).join('; ') : '?');
  console.log('  ' + nm + ' (ind' + ind + '): ' + val);
}
