// 诊断 v4:用「透明图标」作基线,量化图标在各帧的可见面积(彩色差分量),
// 对比 页面默认图标 / 点选预设图标 / 上传自定义图标 三条曲线。
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TMP = process.env.TEMP;
const FRAMES = Array.from({ length: 81 }, (_, i) => i);

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  await page.select('#selAnim', 'exposed');
  await page.waitForFunction(() => { const a = window.__anim; return document.getElementById('selAnim').value === 'exposed' && a && a.isLoaded && a.totalFrames < 200; }, { timeout: 120000 });
  await page.evaluate(() => { const sel = document.getElementById('selRenderer'); if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); } });
  await page.waitForFunction(() => { const a = window.__anim; return a && a.isLoaded && a.totalFrames < 200 && !!document.querySelector('#previewInner canvas'); }, { timeout: 60000 });

  await page.evaluate(() => {
    const W = 480, H = 135;
    window.__grab = (frames, baseKey) => {
      const anim = window.__anim;
      try { anim.pause(); } catch (e) { /* ignore */ }
      anim.renderer.renderFrame(30, true);
      const canvas = anim.renderer.canvas || document.querySelector('#previewInner canvas');
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const octx = off.getContext('2d');
      const base = baseKey ? null : window.__base;
      const store = baseKey ? {} : null;
      const curve = [];
      for (const f of frames) {
        anim.renderer.renderFrame(f, true);
        octx.clearRect(0, 0, W, H);
        octx.drawImage(canvas, 0, 0, W, H);
        const px = octx.getImageData(0, 0, W, H).data;
        const rgb = new Uint8Array(W * H * 3);
        for (let i = 0; i < W * H; i++) { rgb[i*3] = px[i*4]; rgb[i*3+1] = px[i*4+1]; rgb[i*3+2] = px[i*4+2]; }
        if (store) { store[f] = rgb; curve.push({ n: 0, mean: 0 }); }
        else {
          const b = base[f]; let n = 0; let sum = 0;
          for (let i = 0; i < W * H; i++) {
            const d0 = Math.abs(rgb[i*3] - b[i*3]), d1 = Math.abs(rgb[i*3+1] - b[i*3+1]), d2 = Math.abs(rgb[i*3+2] - b[i*3+2]);
            if (d0 > 24 || d1 > 24 || d2 > 24) n++;
            sum += d0 + d1 + d2;
          }
          curve.push({ n, mean: Math.round((sum / (W * H * 3)) * 1000) / 1000 });
        }
      }
      if (store) window.__base = store;
      const el = (anim.renderer.elements || []).find((e) => e && e.data && e.data.ind === 5);
      const op = el && el.finalTransform && el.finalTransform.mProp && el.finalTransform.mProp.o;
      return { curve, opAtF60: op ? Math.round(op.v * 1000) / 1000 : null };
    };
  });

  const setIcon = async (kind, arg) => {
    await page.evaluate(() => { window.__prevAnim = window.__anim; });
    if (kind === 'preset') {
      const ok = await page.evaluate((name) => {
        const li = Array.from(document.querySelectorAll('#iconList .icon-item')).find((e) => e.dataset.name === name);
        if (!li) return false;
        li.click();
        return true;
      }, arg);
      if (!ok) throw new Error('找不到预设图标: ' + arg);
    } else {
      const input = await page.$('#iconFile');
      await input.uploadFile(arg);
    }
    await page.waitForFunction(() => window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 900));
  };
  const grab = async (tag, baseKey) => {
    const res = await page.evaluate((frames, k) => window.__grab(frames, k), FRAMES, baseKey || null);
    console.log('[' + tag + '] opAtF60=' + res.opAtF60);
    return res.curve;
  };

  // 1) 透明图标 → 基线
  await setIcon('upload', path.join(TMP, 'probe_blank.png'));
  await grab('基线(透明图标)', '__base'); // baseKey 有值 → 存基线
  // 2) 点选预设图标(applyIconByName 路径)
  await setIcon('preset', 'Hero_Sp_03.webp');
  const cPreset = await grab('点选预设 Hero_Sp_03.webp', null);
  // 3) 上传自定义图标
  await setIcon('upload', path.join(TMP, 'probe_magenta.png'));
  const cUpload = await grab('上传自定义(洋红)', null);

  console.log('');
  const peak = (c) => Math.max.apply(null, c.map((x) => x.mean));
  const pp = peak(cPreset), pu = peak(cUpload);
  console.log('峰值 meanDiff: 预设=' + pp + ' 上传=' + pu);
  console.log('帧 | 预设 meanDiff (归一) | count | 上传 meanDiff (归一) | count');
  for (const f of FRAMES) {
    const a = cPreset[f], b = cUpload[f];
    if (f > 80) continue;
    console.log(String(f).padStart(3) + ' | ' + String(a.mean).padStart(7) + ' (' + (a.mean / pp).toFixed(3) + ') | ' + String(a.n).padStart(5) + ' | ' +
      String(b.mean).padStart(7) + ' (' + (b.mean / pu).toFixed(3) + ') | ' + String(b.n).padStart(5));
  }
} finally { await browser.close(); }
