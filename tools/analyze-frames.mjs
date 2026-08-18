// 分析帧内容分布:页面帧(透明)内容包围盒 vs AVI 帧(非背景色)内容包围盒
import fs from 'node:fs';

const TMP = 'I:/Delta Force custom animation/tools/.cmp';
const FRAMES = [0, 304, 608];
const W = 1920, H = 1080;

const bg = [0x16, 0x18, 0x1d];
const distBg = (r, g, b) => Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);

for (const f of FRAMES) {
  const avi = fs.readFileSync(`${TMP}/avi-${f}.raw`);
  const page = fs.readFileSync(`${TMP}/page-${f}.raw`);

  // 页面帧:非透明像素包围盒
  let pMinX = W, pMinY = H, pMaxX = -1, pMaxY = -1, pCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (page[i + 3] > 8) {
        pCount++;
        if (x < pMinX) pMinX = x; if (x > pMaxX) pMaxX = x;
        if (y < pMinY) pMinY = y; if (y > pMaxY) pMaxY = y;
      }
    }
  }
  // AVI 帧:非背景色像素包围盒(JPEG 有损,阈值 40)
  let aMinX = W, aMinY = H, aMaxX = -1, aMaxY = -1, aCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (distBg(avi[i], avi[i + 1], avi[i + 2]) > 40) {
        aCount++;
        if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
        if (y < aMinY) aMinY = y; if (y > aMaxY) aMaxY = y;
      }
    }
  }
  console.log(`frame ${f}:`);
  console.log(`  PAGE 内容: ${pCount}px (${((pCount / (W * H)) * 100).toFixed(2)}%) bbox x[${pMinX}..${pMaxX}] y[${pMinY}..${pMaxY}]`);
  console.log(`  AVI  内容: ${aCount}px (${((aCount / (W * H)) * 100).toFixed(2)}%) bbox x[${aMinX}..${aMaxX}] y[${aMinY}..${aMaxY}]`);
}
