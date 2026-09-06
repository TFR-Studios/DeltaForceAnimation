const fs=require('fs');
const main=JSON.parse(fs.readFileSync('animation_2/animation_data.json','utf8'));
const next=JSON.parse(fs.readFileSync('animation_2/animation_data_next_fixed.json','utf8'));

function prepareNextData(nd, baseOp){
  const d=JSON.parse(JSON.stringify(nd));
  const renumber=(layers)=>{ for(const l of layers??[]){ l.ind+=100; if(typeof l.parent==='number') l.parent+=100; if(Array.isArray(l.layers)) renumber(l.layers);} };
  renumber(d.layers);
  for(const l of d.layers??[]){
    if(l.ty===2 && l.tt){ delete l.tt; l.ks=l.ks??{}; l.ks.o={a:0,k:0}; }
  }
  const existingVis=(d.layers??[]).find(l=>l.ind>=100 && !l.td && /底框/.test(l.nm??'') && /可见/.test(l.nm??''));
  if(existingVis){ for(const g of existingVis.shapes??[]){ if(!g||g.ty!=='gr'||!Array.isArray(g.it))continue; const isRect=/矩形/.test(String(g.nm??'')); const tr=g.it.find(c=>c&&c.ty==='tr'); if(tr&&tr.o&&isRect) tr.o={a:0,k:55,ix:tr.o.ix}; } }
  const idMap=new Map(); for(const a of d.assets??[]){const nid=a.id+'_n'; idMap.set(a.id,nid); a.id=nid;}
  const updateRefs=(layers)=>{ for(const l of layers??[]){ if(typeof l.refId==='string'&&idMap.has(l.refId))l.refId=idMap.get(l.refId); if(Array.isArray(l.layers))updateRefs(l.layers);} };
  updateRefs(d.layers);
  const offsetKeyframes=(l,dl)=>{ const k=l.ks||{}; for(const p of ['a','p','s','r','o']) if(k[p]&&k[p].a&&Array.isArray(k[p].k)) for(const kf of k[p].k) if(kf&&typeof kf.t==='number') kf.t+=dl; const tdk=l.t?.d?.k; if(Array.isArray(tdk)) for(const kf of tdk) if(kf&&typeof kf.t==='number') kf.t+=dl; };
  const offsetLayers=(layers)=>{ for(const l of layers??[]){ l.ip+=baseOp; l.op+=baseOp; l.st+=baseOp; offsetKeyframes(l,baseOp); const tdk=l?.t?.d?.k; if(Array.isArray(tdk)) for(const kf of tdk) if(kf&&typeof kf.t==='number') kf.t+=baseOp; if(Array.isArray(l.layers)) offsetLayers(l.layers);} };
  offsetLayers(d.layers); d.ip+=baseOp; d.op+=baseOp;
  return d;
}

const merged=JSON.parse(JSON.stringify(main));
const nextP=prepareNextData(next, merged.op);
merged.layers=[...merged.layers, ...nextP.layers];

console.log('=== 合并后第二段图层 (ind>=100) ===');
for(const l of merged.layers.filter(x=>x.ind>=100)){
  const k=l.ks||{};
  const o=k.o?(k.o.a?'ANIM':JSON.stringify(k.o.k)):'-';
  const s=k.s?(k.s.a?'ANIM':JSON.stringify(k.s.k)):'100';
  const r=k.r?(k.r.a?'ANIM':JSON.stringify(k.r.k)):'0';
  const shapes=(l.shapes||[]).map(g=>g.nm).join(',');
  console.log(`ind=${String(l.ind).padStart(4)} td=${l.td||''} tt=${l.tt||''} par=${String(l.parent??'').padStart(3)} ty=${l.ty} o=${String(o).padStart(6)} s=${String(s).padStart(20)} r=${String(r).padStart(6)} [${l.nm}] shapes=[${shapes}]`);
}