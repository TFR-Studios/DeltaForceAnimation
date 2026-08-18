// 将 animation/ccreptile/ 的 PNG 序列打包进 animation_data.json:
// 1) 删除名为「左中上」的图片图层及其 asset(image_2)
// 2) 在相同层级位置插入 ccreptile 序列图层(ty=2, ks.src 关键帧 0..608)
// 3) 追加 609 个 image_ccr_* 的 base64 asset
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'I:/Delta Force custom animation/animation/animation_data.json';
const BACKUP = 'I:/Delta Force custom animation/animation/animation_data.pre-ccreptile-seq.json';
const SEQ_DIR = 'I:/Delta Force custom animation/animation/ccreptile';

fs.copyFileSync(SRC, BACKUP);

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const W = j.w, H = j.h, TOTAL = Math.round((j.op ?? 0) - (j.ip ?? 0));

// --- 1) 删除「左中上」图层 ---
const removeIdx = j.layers.findIndex((l) => String(l.nm).includes('左中上'));
if (removeIdx < 0) { console.error('未找到「左中上」图层'); process.exit(1); }
const removed = j.layers[removeIdx];
console.log('删除图层:', JSON.stringify({ ind: removed.ind, nm: removed.nm, refId: removed.refId }));
if (removed.refId) {
  const assetIdx = j.assets.findIndex((a) => a.id === removed.refId);
  if (assetIdx >= 0) {
    const a = j.assets.splice(assetIdx, 1)[0];
    console.log('删除 asset:', a.id, '(' + Math.round(a.p.length / 1024) + 'KB)');
  }
}
j.layers.splice(removeIdx, 1);

// --- 2) 读取序列 PNG ---
const files = fs.readdirSync(SEQ_DIR)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
console.log('序列帧数:', files.length, '动画总帧:', TOTAL);
if (files.length < TOTAL) {
  console.error(`序列帧数(${files.length}) < 动画总帧(${TOTAL}),请检查`);
  process.exit(1);
}

const seqAssets = [];
const srcKeys = [];
for (let i = 0; i < TOTAL; i++) {
  const f = files[i];
  const b64 = fs.readFileSync(path.join(SEQ_DIR, f)).toString('base64');
  const id = 'image_ccr_' + String(i).padStart(5, '0');
  seqAssets.push({ id, w: W, h: H, u: '', p: 'data:image/png;base64,' + b64, e: 1 });
  srcKeys.push({ t: i, s: [id] });
}

// --- 3) 构造序列图层(插入原「左中上」位置,层级不变) ---
const seqLayer = {
  ddd: 0,
  ind: removed.ind,
  ty: 2,
  nm: 'ccreptile',
  refId: seqAssets[0].id,
  ks: {
    o: { a: 0, k: 100, ix: 11 },
    r: { a: 0, k: 0, ix: 10 },
    p: { a: 0, k: [0, 0, 0], ix: 2 },
    a: { a: 0, k: [0, 0, 0], ix: 1 },
    s: { a: 0, k: [100, 100, 100], ix: 6 },
    // 图片序列语义:每帧切换 asset(lottie-web 不原生支持,由编辑器运行时驱动)
    src: { k: srcKeys },
  },
  ip: 0,
  op: TOTAL,
  st: 0,
  bm: 0,
  sr: 1,
};

j.layers.splice(removeIdx, 0, seqLayer);
j.assets.push(...seqAssets);

fs.writeFileSync(SRC, JSON.stringify(j));
console.log('完成:');
console.log('  插入序列图层 ind=' + seqLayer.ind + ' nm=' + seqLayer.nm + ' @数组位置 ' + removeIdx);
console.log('  新增 asset 数:', seqAssets.length, 'JSON 大小:', Math.round(fs.statSync(SRC).size / 1024 / 1024 * 10) / 10 + 'MB');
console.log('  备份:', BACKUP);
