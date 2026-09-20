/* 把 animation_4 里**可见形状图层**的颜色归到最接近的参考色:
 *   参考色 #77B0F0 / #78C5F3(sRGB 欧氏距离取最近)
 * 不动的:占位色(纯红填充 #ff0000 / 纯白描边 #ffffff)、蒙版图层(td=1)、以及离两个参考色都很远的
 *         非蓝系颜色(例如 mask 2 的黄绿 #A3FF00 —— 蒙版层本来也不在编辑列表里)。
 * 其它形状组(第 2 个及以后的填充/描边)一起改,避免出现"列表显示改了、画面还有旧色"的不一致。
 * 首次运行前自动备份为 animation_data.pre-color-normalize.json;--revert 可还原。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'animation_4', 'animation_data.json');
const BACKUP = path.join(ROOT, 'animation_4', 'animation_data.pre-color-normalize.json');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const revert = argv.includes('--revert');

if (revert) {
  if (!fs.existsSync(BACKUP)) { console.error('没有备份:' + BACKUP); process.exit(1); }
  fs.copyFileSync(BACKUP, FILE);
  console.log('已从备份还原 ' + path.relative(ROOT, FILE));
  process.exit(0);
}

const REF = [
  { hex: '#77B0F0', rgb: [0x77, 0xb0, 0xf0] },
  { hex: '#78C5F3', rgb: [0x78, 0xc5, 0xf3] },
];
const PLACEHOLDER = new Set(['#ff0000', '#ffffff']);   // 占位色:不参与归一
const MAX_DIST = 60;                                     // 与参考色差超过这个值就认为不是同一族颜色

const hexOf = (fc) => '#' + fc.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
const toFc = (hex, original) => {
  const h = hex.replace('#', '');
  const out = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  if (original && original.length > 3) out.push(original[3]); // 保留可能存在的第 4 个分量
  return out;
};

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const changes = [];
let skippedMask = 0;
let skippedFar = 0;

function walkItems(items, cb) {
  for (const it of items ?? []) {
    if (it.ty === 'fl' || it.ty === 'st') cb(it);
    if (Array.isArray(it.it)) walkItems(it.it, cb);
  }
}

for (const l of data.layers ?? []) {
  if (l.ty !== 4) continue;
  if (l.td === 1) { skippedMask++; continue; }   // 蒙版源图层:不渲染,不参与
  walkItems(l.shapes, (it) => {
    const c = it.c;
    if (!c || c.a !== 0 || !Array.isArray(c.k) || c.k.length < 3) return;  // 只处理静态色
    const cur = hexOf(c.k);
    if (PLACEHOLDER.has(cur)) return;
    const [r, g, b] = [Math.round(c.k[0] * 255), Math.round(c.k[1] * 255), Math.round(c.k[2] * 255)];
    let best = null;
    for (const ref of REF) {
      const d = Math.sqrt((r - ref.rgb[0]) ** 2 + (g - ref.rgb[1]) ** 2 + (b - ref.rgb[2]) ** 2);
      if (!best || d < best.d) best = { hex: ref.hex, d };
    }
    if (!best || best.d > MAX_DIST) { skippedFar++; return; }
    if (cur === best.hex) { changes.push({ nm: l.nm, ind: l.ind, kind: it.ty === 'fl' ? '填充' : '描边', from: cur, to: best.hex, d: best.d, unchanged: true }); return; }
    changes.push({ nm: l.nm, ind: l.ind, kind: it.ty === 'fl' ? '填充' : '描边', from: cur, to: best.hex, d: best.d, unchanged: false });
    if (!dryRun) it.c = { ...c, k: toFc(best.hex, c.k) };
  });
}

console.log((dryRun ? '[dry-run] ' : '') + '可见形状图层的颜色归一(参考色 #77B0F0 / #78C5F3):');
for (const c of changes) {
  console.log('  ind' + String(c.ind).padEnd(4) + (c.nm || '').padEnd(16) + c.kind + '  ' + c.from + ' → ' + (c.unchanged ? '(已是 ' + c.to + ')' : c.to) + '  距离 ' + c.d.toFixed(1));
}
const changed = changes.filter((c) => !c.unchanged);
console.log('需要改写:' + changed.length + ' 处  |  本来就是这个色:' + (changes.length - changed.length) + ' 处  |  跳过蒙版图层:' + skippedMask + ' 个  |  离参考色太远而跳过:' + skippedFar + ' 处');

if (dryRun) process.exit(0);
if (!changed.length) { console.log('没有需要改写的颜色,未写入文件。'); process.exit(0); }
if (!fs.existsSync(BACKUP)) { fs.copyFileSync(FILE, BACKUP); console.log('已备份原始文件 → ' + path.relative(ROOT, BACKUP)); }
else console.log('备份已存在,保留不动:' + path.relative(ROOT, BACKUP));
fs.writeFileSync(FILE, JSON.stringify(data));
console.log('已写回 ' + path.relative(ROOT, FILE));
