const fs=require('fs');
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
function show(nm){
  const l=d.layers.find(x=>x.nm===nm);
  if(!l){console.log('NOT FOUND',nm);return;}
  const k=l.ks||{};
  console.log('===',nm,'ind='+l.ind,'parent='+(l.parent??''),'td='+(l.td||''),'tt='+(l.tt||''));
  for(const p of ['a','p','s','r','o']){
    const v=k[p];
    if(!v){console.log('  '+p+': none');continue;}
    if(v.a){
      console.log('  '+p+': ANIM kf='+v.k.length);
      for(const kf of v.k){
        const t=kf.t;
        const val=kf.s?JSON.stringify(kf.s):(kf.e?JSON.stringify(kf.e):JSON.stringify(kf.v));
        const o=kf.o?JSON.stringify(kf.o):'';
        const i=kf.i?JSON.stringify(kf.i):'';
        console.log('    t='+t+' s='+val+' o='+o+' i='+i);
      }
    }else{
      console.log('  '+p+': '+JSON.stringify(v.k));
    }
  }
}
['空 3','空 2','底框 可见','底框','形状图层 4'].forEach(show);