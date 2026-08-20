// 完整导出透明 AVI(5GB),验证 AVIX 多段结构
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--js-flags=--max-old-space-size=16384'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  await page.evaluate(() => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (!t.checked) t.click();
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
  console.log('透明 AVI 导出启动,等待完成(5GB,约 10-20 分钟)…');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 2400000 });
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('导出完成, blob size =', size);

  // 页面内解析 AVIX 结构(逐步 try/catch 定位)
  const report = await page.evaluate(async () => {
    const blob = window.__capturedBlob;
    const step = async (name, fn) => {
      try { return await fn(); } catch (e) { return { __error: name + ': ' + String(e).slice(0, 120) }; }
    };
    const size = blob.size;
    const head = await step('head4k', async () => new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
    if (head.__error) return { size, error: head.__error };
    const dv = new DataView(head.buffer);
    const riffSize0 = dv.getUint32(4, true);
    const hdrlSize = dv.getUint32(16, true);
    const movi0Pos = 12 + 8 + hdrlSize;
    const moviHead = await step('moviHead', async () => new Uint8Array(await blob.slice(movi0Pos, movi0Pos + 16).arrayBuffer()));
    if (moviHead.__error) return { size, riffSize0, error: moviHead.__error };
    const d2 = new DataView(moviHead.buffer);
    const movi0Size = d2.getUint32(4, true);
    const fourcc = String.fromCharCode(moviHead[8], moviHead[9], moviHead[10], moviHead[11]);
    let hasOdml = false;
    for (let i = 12; i < movi0Pos - 8 && i < 380; i++) {
      if (head[i] === 0x6f && head[i + 1] === 0x64 && head[i + 2] === 0x6d && head[i + 3] === 0x6c) { hasOdml = true; break; }
    }
    // 数段0帧数(小分片扫描)
    const countFrames = async (start, end) => {
      let frames = 0;
      let p = start;
      let guard = 0;
      while (p + 8 <= end && guard < 2000) {
        const h = await step('chunk@' + p, async () => new Uint8Array(await blob.slice(p, p + 8).arrayBuffer()));
        if (h.__error) return { frames, error: h.__error };
        const id = String.fromCharCode(h[0], h[1], h[2], h[3]);
        const s = new DataView(h.buffer).getUint32(4, true);
        if (id === '00db') frames++;
        p += 8 + s;
        guard++;
      }
      return { frames };
    };
    const seg0 = await countFrames(movi0Pos + 12, movi0Pos + 12 + movi0Size);
    let frames = seg0.frames;
    // 扫描后续 AVIX 段
    let pos = movi0Pos + 12 + movi0Size;
    let segments = 1;
    const segInfo = [];
    let guard = 0;
    let scanError = null;
    while (pos + 12 <= size && guard < 50) {
      const h = await step('riff@' + pos, async () => new Uint8Array(await blob.slice(pos, pos + 12).arrayBuffer()));
      if (h.__error) { scanError = h.__error; break; }
      const id = String.fromCharCode(h[0], h[1], h[2], h[3]);
      const s = new DataView(h.buffer).getUint32(4, true);
      if (id !== 'RIFF') break;
      const form = String.fromCharCode(h[8], h[9], h[10], h[11]);
      if (form !== 'AVIX') break;
      segments++;
      const mh = await step('movi@' + (pos + 12), async () => new Uint8Array(await blob.slice(pos + 12, pos + 24).arrayBuffer()));
      if (mh.__error) { scanError = mh.__error; break; }
      const mId = String.fromCharCode(mh[0], mh[1], mh[2], mh[3]);
      const mSize = new DataView(mh.buffer).getUint32(4, true);
      const mFourcc = String.fromCharCode(mh[8], mh[9], mh[10], mh[11]);
      const segF = await countFrames(pos + 24, pos + 24 + mSize);
      segInfo.push({ riffSize: s, moviSize: mSize, moviFourcc: mFourcc, segFrames: segF.frames });
      frames += segF.frames;
      pos += 12 + s;
      guard++;
    }
    return { size, riffSize0, hdrlSize, movi0Pos, movi0Size, fourcc, hasOdml, segments, segInfo: segInfo.slice(0, 10), totalFrames: frames, seg0Err: seg0.error, scanError };
  });
  console.log(JSON.stringify(report, null, 2));
  const ok = report.riffSize0 < 4294967295 && report.totalFrames === 609 && report.segments > 1;
  console.log(ok ? '✓ 多段 AVIX 结构正确:RIFF 未溢出,全部 609 帧在文件中' : '✗ 结构异常!');
} finally {
  await browser.close();
}
