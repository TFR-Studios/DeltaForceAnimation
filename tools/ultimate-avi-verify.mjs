// 终极验证:完整导出透明 AVI(真实文件),页面内解析帧数据,逐帧检测残影
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  await page.evaluate(() => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (!t.checked) t.click(); // 勾选透明
    const f = document.getElementById('selFormat');
    f.value = 'avi';
    f.dispatchEvent(new Event('change'));
    window.__capturedBlob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type && blob.type.indexOf('x-msvideo') !== -1) window.__capturedBlob = blob;
      return orig.call(this, blob);
    };
    document.getElementById('btnExport').click();
  });
  console.log('透明 AVI 导出已启动,等待完成…');

  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 1800000 });
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('导出完成, blob size =', size);

  // 页面内解析 AVI:定位 movi,顺序读取 00db 帧块,验证残影
  const result = await page.evaluate(async () => {
    const blob = window.__capturedBlob;
    const W = 1920, H = 1080;
    const frameBytes = W * H * 4;
    // 读前 64KB 找 'movi'
    const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    const findFourcc = (buf, fourcc, from) => {
      for (let i = from; i <= buf.length - 4; i++) {
        if (buf[i] === fourcc.charCodeAt(0) && buf[i + 1] === fourcc.charCodeAt(1) && buf[i + 2] === fourcc.charCodeAt(2) && buf[i + 3] === fourcc.charCodeAt(3)) return i;
      }
      return -1;
    };
    const moviPos = findFourcc(head, 'movi', 0);
    if (moviPos < 0) return { error: '找不到 movi' };
    // movi LIST: 'movi' + u32 size(4),内容从 moviPos+8 开始
    const dataStart = moviPos + 8;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const moviSize = view.getUint32(moviPos + 4, true);
    console.log('movi @', moviPos, 'size', moviSize);

    // 预加载素材帧对比数据(只取需要的帧)
    const checkFrames = [];
    for (let f = 0; f < 609; f += 12) checkFrames.push(f);
    for (let f = 295; f <= 340; f++) checkFrames.push(f);
    const materialCache = {};
    for (const f of checkFrames) {
      const n = String(f).padStart(5, '0');
      try {
        const res = await fetch(`/animation/ccreptile/ccreptitle_${n}.png`);
        const buf = new Uint8Array(await res.arrayBuffer());
        // 解码 PNG 太复杂,改用 Image + canvas
        const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        materialCache[f] = ctx.getImageData(0, 0, W, H).data;
        bmp.close();
      } catch { /* 跳过 */ }
    }

    // 逐帧解析 movi:每块 id(4)+size(4)+data;00db=视频帧
    let pos = dataStart;
    const end = dataStart + moviSize;
    let frameIdx = 0;
    const report = [];
    const failures = [];
    while (pos + 8 <= end && frameIdx < 609) {
      const chunkId = String.fromCharCode(head[pos], head[pos + 1], head[pos + 2], head[pos + 3]);
      // 跨块读取需要 blob.slice
      const chunkHead = new Uint8Array(await blob.slice(pos, pos + 8).arrayBuffer());
      const dv = new DataView(chunkHead.buffer);
      const id = String.fromCharCode(chunkHead[0], chunkHead[1], chunkHead[2], chunkHead[3]);
      const size = dv.getUint32(4, true);
      if (id === '00db') {
        const frameData = new Uint8Array(await blob.slice(pos + 8, pos + 8 + frameBytes).arrayBuffer());
        // BGRA bottom-up → RGBA top-down(反转换)
        const rgba = new Uint8Array(frameBytes);
        const rowBytes = W * 4;
        for (let y = 0; y < H; y++) {
          const s = y * rowBytes;
          const d = (H - 1 - y) * rowBytes;
          for (let x = 0; x < rowBytes; x += 4) {
            rgba[d + x] = frameData[s + x + 2];     // R
            rgba[d + x + 1] = frameData[s + x + 1]; // G
            rgba[d + x + 2] = frameData[s + x];     // B
            rgba[d + x + 3] = frameData[s + x + 3]; // A
          }
        }
        // 残影检测:透明区(alpha<10)的 RGB 应为 0(预乘后);否则有残留
        let dirty = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] < 10 && (rgba[i] > 2 || rgba[i + 1] > 2 || rgba[i + 2] > 2)) dirty++;
        }
        // 序列区域与素材对比(反预乘)
        const mat = materialCache[frameIdx];
        if (mat) {
          let seqPx = 0, matched = 0;
          for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
            const i = (y * W + x) * 4;
            const a = rgba[i + 3];
            if (a > 8) {
              seqPx++;
              const r = a > 0 ? Math.min(255, Math.round((rgba[i] * 255) / a)) : 0;
              const g = a > 0 ? Math.min(255, Math.round((rgba[i + 1] * 255) / a)) : 0;
              const b = a > 0 ? Math.min(255, Math.round((rgba[i + 2] * 255) / a)) : 0;
              const diff = Math.abs(r - mat[i]) + Math.abs(g - mat[i + 1]) + Math.abs(b - mat[i + 2]);
              if (diff < 50) matched++;
            }
          }
          report.push({ frame: frameIdx, matchPct: seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0, dirty, seqPx });
        } else {
          report.push({ frame: frameIdx, dirty });
        }
        frameIdx++;
      }
      pos += 8 + size;
      if (pos + 8 > end) break;
      // 重新读块头(可能跨 64KB)
      const nh = new Uint8Array(await blob.slice(pos, pos + 8).arrayBuffer());
      head.set(nh, 0); // 复用 head 前 8 字节
      // 用 nh 直接替换循环判断
      if (frameIdx >= 609) break;
    }
    return { totalFrames: frameIdx, report: report.filter((r) => r.matchPct !== undefined), dirtyFrames: report.filter((r) => r.dirty > 100).length };
  });
  console.log(JSON.stringify(result, null, 2));
  // 汇总
  if (result.report) {
    const low = result.report.filter((r) => parseFloat(r.matchPct) < 90);
    console.log('素材对比帧数:', result.report.length, '| 匹配<90% 的帧:', JSON.stringify(low.slice(0, 10)));
    console.log('透明区 RGB 残留严重的帧数:', result.dirtyFrames);
  }
} finally {
  await browser.close();
}
