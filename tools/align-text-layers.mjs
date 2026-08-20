
// 文字对齐修复脚本:
// - 居中组(撤离成功/撤离点/地点/对局时长/00:00:00/对局时间/01-01 00:00): j=2 + 锚点X=0
//   (文本绕锚点(即父级定位点)原生居中,任意自定义文字宽度都保持居中)
// - 左对齐组(地图名称/难度): j=0 + 锚点X对齐同一左边缘
//   (文本从锚点起向右排,任意自定义文字宽度都保持左对齐)
import fs from 'node:fs';
const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.pre-align-fix.json';
if (!fs.existsSync(BACKUP)) fs.copyFileSync(SRC, BACKUP);
console.log('备份: ' + BACKUP);

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const layers = [];
function walk(list){ for (const l of list||[]){ layers.push(l); if(l.ty===0) walk(l.layers);} }
walk(j.layers);
const byInd = new Map(layers.map(l => [l.ind, l]));

function setTextDoc(layer, fn) {
  const td = layer?.t?.d?.k;
  if (!td) return false;
  if (Array.isArray(td)) { for (const kf of td) if (kf.s) fn(kf.s); return true; }
  if (td.s) { fn(td.s); return true; }
  return false;
}
function setAnchorX(layer, x) {
  const a = layer?.ks?.a;
  if (!a) return false;
  if (a.a === 0) { a.k[0] = x; return true; }
  if (Array.isArray(a.k)) { for (const kf of a.k) if (kf.s) kf.s[0] = x; return true; }
  return false;
}
function setPosX(layer, x) {
  const p = layer?.ks?.p;
  if (!p) return false;
  if (p.a === 0) { p.k[0] = x; return true; }
  return false;
}

// 居中组: ind -> 中心X(合成坐标,父级定位点经 parent_p - parent_a + child_p 换算)
const centerGroup = {
  40: 60,   // 对局时间   (parent 39 @ 960.13 -> 中心 960.13)
  41: 60,   // 01-01 00:00
  43: 60,   // 对局时长   (parent 42 @ 959.94)
  44: 60,   // 00:00:00
  46: 60,   // 撤离点     (parent 45 @ 961.20)
  47: 60,   // 地点
  48: 960,  // 撤离成功   (无父级, 中心 = p.x = 960)
};
// 左对齐组: 地图名称左边缘 = 201.039 - 119.249*0.31112 = 163.939
// 难度锚点X = (186.871 - 163.939) / 0.37402 = 61.314
const leftGroup = { 49: 61.314 }; // 难度(地图名称锚点不动)

let changed = 0;
for (const [ind, cx] of Object.entries(centerGroup)) {
  const l = byInd.get(Number(ind));
  if (!l) { console.log('未找到 ind' + ind); continue; }
  const okJ = setTextDoc(l, s => { s.j = 2; });
  const okA = setAnchorX(l, 0);
  const okP = setPosX(l, cx);
  console.log('ind' + ind + ' [' + (l.nm||'').trim() + '] 居中: j=2 ' + (okJ?'✓':'✗') + ' a.x=0 ' + (okA?'✓':'✗') + ' p.x=' + cx + ' ' + (okP?'✓':'✗'));
  if (okJ && okA && okP) changed++;
}
for (const [ind, ax] of Object.entries(leftGroup)) {
  const l = byInd.get(Number(ind));
  if (!l) { console.log('未找到 ind' + ind); continue; }
  const okJ = setTextDoc(l, s => { s.j = 0; });
  const okA = setAnchorX(l, ax);
  console.log('ind' + ind + ' [' + (l.nm||'').trim() + '] 左对齐: j=0 ' + (okJ?'✓':'✗') + ' a.x=' + ax.toFixed(3) + ' ' + (okA?'✓':'✗'));
  if (okJ && okA) changed++;
}
// 地图名称保持 j=0(校验)
const m = byInd.get(50);
const mj = (Array.isArray(m?.t?.d?.k) ? m.t.d.k[0]?.s?.j : m?.t?.d?.k?.s?.j);
console.log('ind50 [地图名称] j=' + mj + ' (保持 0=左对齐)');

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('\n已处理 ' + changed + ' 个图层,已写入 ' + SRC);

