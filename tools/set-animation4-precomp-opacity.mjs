/* 把「任务弹窗动画」预合成里「形状图层 6」的默认不透明度设为 80%。
 * 该层的不透明度是「31 帧 0 → 42 帧 100」的关键帧动画,按比例缩放关键帧(峰值 100 → 80),
 * 淡入过程保持原样,与站点侧不透明度滑块(按峰值等比缩放)完全一致。
 * 就地改 animation_4/animation_data.json,首次运行前备份;--dry-run 预览,--revert 还原。
 *
 * 用法:node tools/set-animation4-precomp-opacity.mjs [--dry-run|--revert]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'animation_4', 'animation_data.json');
const BACKUP = path.join(ROOT, 'animation_4', 'animation_data.pre-precomp-opacity.json');
const TARGET_LAYER = '形状图层 6';
const TARGET_OPACITY = 80;

const dryRun = process.argv.includes('--dry-run');
const revert = process.argv.includes('--revert');

if (revert) {
  if (!fs.existsSync(BACKUP)) { console.error('没有备份:' + BACKUP); process.exit(1); }
  fs.copyFileSync(BACKUP, FILE);
  console.log('已从备份还原 ' + path.relative(ROOT, FILE));
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const changes = [];

for (const a of data.assets ?? []) {
  if (!Array.isArray(a.layers)) continue;
  for (const l of a.layers) {
    if (l.nm !== TARGET_LAYER) continue;
    const o = l.ks?.o;
    if (!o || o.a !== 1 || !Array.isArray(o.k)) continue;
    // 峰值(所有关键帧里的最大值)—— 站点的不透明度滑块也是以它为 100% 基准
    let peak = 0;
    for (const kf of o.k) {
      const v = Number(Array.isArray(kf.s) ? kf.s[0] : kf.s);
      if (isFinite(v) && v > peak) peak = v;
    }
    if (peak <= 0) continue;
    const scale = TARGET_OPACITY / peak;
    const before = o.k.map((kf) => Number(Array.isArray(kf.s) ? kf.s[0] : kf.s));
    if (!dryRun) {
      for (const kf of o.k) {
        const v = Number(Array.isArray(kf.s) ? kf.s[0] : kf.s);
        const nv = Math.round(v * scale * 1000) / 1000;
        if (Array.isArray(kf.s)) kf.s[0] = nv; else kf.s = nv;
      }
    }
    changes.push({ asset: a.id, ind: l.ind, nm: l.nm, peak, scale, before, after: before.map((v) => Math.round(v * scale * 1000) / 1000) });
  }
}

console.log((dryRun ? '[dry-run] ' : '') + '预合成里「' + TARGET_LAYER + '」的不透明度 → 峰值 ' + TARGET_OPACITY + '%');
for (const c of changes) {
  console.log('  [' + c.asset + '] ind' + c.ind + ' ' + c.nm + '  峰值 ' + c.peak + ' → ' + TARGET_OPACITY + '(缩放 ' + c.scale.toFixed(2) + ')' + (dryRun ? '' : ''));
  console.log('      关键帧: ' + JSON.stringify(c.before) + ' → ' + JSON.stringify(c.after));
}
if (!changes.length) { console.log('没有找到目标图层(不透明度为静态值或名字变了),未改动。'); process.exit(0); }
if (dryRun) process.exit(0);
if (!fs.existsSync(BACKUP)) { fs.copyFileSync(FILE, BACKUP); console.log('已备份原始文件 → ' + path.relative(ROOT, BACKUP)); }
else console.log('备份已存在,保留不动:' + path.relative(ROOT, BACKUP));
fs.writeFileSync(FILE, JSON.stringify(data));
console.log('已写回 ' + path.relative(ROOT, FILE));
