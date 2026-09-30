/* 黑潮爆破默认弹窗动画(animations/animation_6)的开发期校验:
 * 切到该动画 → 等载入 → 检查渲染器/资源改写/侧栏列表/是否有多余 404 → 逐帧截图供人眼核对。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.DEV_ORIGIN || 'http://127.0.0.1:5173';
const OUT = path.resolve(import.meta.dirname, '.blast-check');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], defaultViewport: { width: 1700, height: 1000 } });
try {
  const page = await browser.newPage();
  const errors = [];
  const reqs = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/Failed to load resource/i.test(t)) errors.push('[console] ' + t.slice(0, 200)); });
  page.on('requestfailed', (r) => reqs.push('FAIL ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) reqs.push(r.status() + ' ' + r.url()); });

  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 300000, polling: 200 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 120000 });

  const options = await page.evaluate(() => [...document.querySelectorAll('#selAnim option')].map((o) => o.value + '=' + o.textContent));
  console.log('options:', options.join(' | '));

  // 先切到别的动画,确认切换路径(而不是只走首屏默认)也正常
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded && document.getElementById('selAnim').value === 'mission', { timeout: 120000 });

  /* 等「新的 lottie 实例」就绪,而不是只等 isLoaded —— 切换期间 window.__anim 可能还是上一套动画的实例 */
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast'
    && document.getElementById('statusbar').textContent.includes('黑潮爆破')
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 200 });
  await sleep(600);

  const info = await page.evaluate(() => {
    const anim = window.__anim;
    const data = anim.animationData;
    const usedRefs = new Set();
    const walk = (ls) => { for (const l of ls || []) { if (typeof l.refId === 'string') usedRefs.add(l.refId); if (Array.isArray(l.layers)) walk(l.layers); } };
    walk(data.layers);
    for (const a of data.assets || []) if (Array.isArray(a.layers)) walk(a.layers);
    return {
      renderer: anim.renderer.rendererType,
      rendererSelect: document.getElementById('selRenderer').value,
      totalFrames: anim.totalFrames,
      assets: (data.assets || []).map((a) => a.id + '|' + (a.p || '(precomp)')),
      layers: data.layers.length,
      videoLayersLeft: JSON.stringify(data).includes('"ty":9'),
      unusedAssets: (data.assets || []).filter((a) => !usedRefs.has(String(a.id))).map((a) => String(a.id)),
      fonts: (data.fonts && data.fonts.list || []).map((f) => f.fName),
      texts: [...document.querySelectorAll('#textList .t-name')].map((n) => n.textContent),
      shapes: [...document.querySelectorAll('#shapeList .s-name')].map((n) => n.textContent).slice(0, 8),
      images: [...document.querySelectorAll('#imageList .img-name')].map((n) => n.textContent),
      statusText: document.getElementById('statusbar').textContent,
    };
  });
  console.log('info:', JSON.stringify(info, null, 1));

  // 逐帧截图(预览舞台)
  const stage = await page.$('#stage');
  for (const f of [0, 40, 80, 140, 200, 300, 420, 520, 599]) {
    await page.evaluate((fr) => { window.__anim.pause(); window.__anim.goToAndStop(fr, true); }, f);
    await sleep(280);
    await stage.screenshot({ path: path.join(OUT, 'blast-f' + String(f).padStart(3, '0') + '.png') });
  }
  // 资源可达性
  const probe = await page.evaluate(async () => {
    const out = [];
    for (const a of window.__anim.animationData.assets) {
      if (!a.p) continue;
      const r = await fetch(a.p);
      out.push({ p: String(a.p).slice(-46), ok: r.ok, size: (await r.blob()).size });
    }
    return out;
  });
  console.log('asset probe:', JSON.stringify(probe));
  console.log('bad requests:', reqs.filter((u) => !/favicon/.test(u)).slice(0, 6).join(' || ') || '(none)');
  console.log('errors:', errors.slice(0, 4).join(' || ') || '(none)');
} finally {
  await browser.close();
}
