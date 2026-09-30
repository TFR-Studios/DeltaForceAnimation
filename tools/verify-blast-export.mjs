/* 验证「黑潮爆破默认弹窗动画」的导出通路:
 *  该动画含 tt:3 亮度遮罩 → needsSvgRasterExport 为真 → 导出必须自动走「SVG 逐帧光栅化」而不是 canvas 管线。
 *  步骤:切到该动画 → 把时长拖到 3.7s(剪掉空尾,导出更快)→ 点导出 → 等浮层走完 →
 *  检查下载到的 mp4(存在 / ftyp 头 / 无音轨 / 内容不是全黑)。
 *  最后一步把 mp4 交给页面里的 <video> 抽一帧画到 canvas,统计非背景像素占比 —— 只验「文件在」不够,
 *  亮度过低(整帧黑)正是亮度遮罩走错渲染器时的表现。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const URL = 'http://127.0.0.1:5173/';
const OUT = path.resolve(import.meta.dirname, '.blast-check/export');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1000 });
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast'
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 200 });
  await sleep(1200);

  // 剪掉空尾:时长 3.7s(600 帧 → 227 帧),导出更快,也顺带验一次时长滑杆
  await page.evaluate(() => {
    const rng = document.getElementById('rngDuration');
    rng.value = '3.7';
    rng.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__anim && Math.round(window.__anim.totalFrames) < 300, { timeout: 60000 });
  console.log('frames after trim:', await page.evaluate(() => window.__anim.totalFrames));

  await page.evaluate(() => document.getElementById('btnExport').click());
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 300000) {
    const st = await page.evaluate(() => ({ status: document.getElementById('exportStatus').textContent, pct: document.getElementById('exportPercent').textContent, detail: document.getElementById('exportDetail').textContent, hidden: document.getElementById('exportOverlay').hidden }));
    const line = JSON.stringify(st);
    if (line !== last) { console.log('  ' + line); last = line; }
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4') && !f.endsWith('.crdownload'));
    if (files.length && st.pct === '100%') break;
    await sleep(1500);
  }
  await sleep(2000);
  const files = fs.readdirSync(OUT);
  console.log('downloads:', files.join(', ') || '(none)');
  const mp4 = files.find((f) => f.endsWith('.mp4'));
  if (!mp4) { console.log('EXPORT FAILED: 没有下载到 mp4'); process.exitCode = 1; }
  else {
    const buf = fs.readFileSync(path.join(OUT, mp4));
    const hasAudio = buf.includes(Buffer.from('mp4a', 'latin1'));
    console.log('mp4 size:', (buf.length / 1048576).toFixed(2), 'MB  head:', JSON.stringify(buf.slice(0, 16).toString('latin1')), ' 含音轨:', hasAudio);
    // 抽帧检查内容(非背景像素占比)
    const stats = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      const v = document.createElement('video');
      v.src = url; v.muted = true;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video load failed')); setTimeout(res, 8000); });
      const dur = v.duration || 0;
      const shots = [];
      for (const ratio of [0.12, 0.3, 0.55]) {
        v.currentTime = Math.max(0, dur * ratio);
        await new Promise((res) => { v.onseeked = res; setTimeout(res, 3000); });
        const cv = document.createElement('canvas');
        cv.width = 480; cv.height = 270;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, cv.width, cv.height);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let nonBg = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - 0x16) + Math.abs(d[i + 1] - 0x18) + Math.abs(d[i + 2] - 0x1d) > 24) nonBg++;
        }
        shots.push({ t: Number((dur * ratio).toFixed(2)), pct: Number((100 * nonBg / (cv.width * cv.height)).toFixed(2)) });
      }
      URL.revokeObjectURL(url);
      return { duration: Number(dur.toFixed(2)), shots };
    }, buf.toString('base64'));
    console.log('video:', JSON.stringify(stats));
    const ok = stats.shots.some((s) => s.pct > 1);
    console.log(ok ? 'EXPORT SMOKE OK(抽帧有内容)' : 'EXPORT SMOKE FAILED(抽帧全是背景)');
    if (!ok) process.exitCode = 1;
  }
  console.log('page errors:', errors.slice(0, 4).join(' || ') || '(none)');
} finally { await browser.close(); }
