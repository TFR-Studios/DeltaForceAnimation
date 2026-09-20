/* 生产构建(dist)冒烟测试:确认打包后的任务弹窗动画也能加载、图标资源指向带 hash 的产物地址。 */
import puppeteer from 'puppeteer-core';
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/net::|Failed to load resource/i.test(t)) errors.push('[console] ' + t); });
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  const info = await page.evaluate(async () => {
    window.__anim.pause(); window.__anim.goToAndStop(140, true);
    await new Promise((r) => setTimeout(r, 300));
    const asset = window.__anim.animationData.assets.find((a) => a.id === 'image_0');
    let probe = null;
    try { const r = await fetch(asset.p); const b = await r.blob(); probe = { ok: r.ok, size: b.size, type: b.type }; } catch (e) { probe = { error: String(e) }; }
    return {
      assetUrl: asset.p,
      probe,
      iconOpacityRowHidden: document.getElementById('iconOpacityRow').hidden,
      iconNames: [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent).slice(0, 2),
      texts: [...document.querySelectorAll('#textList .t-name')].map((n) => n.textContent),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('errors:', errors.slice(0, 3).join(' || ') || '(none)');
  console.log(/\/assets\/MallIcon_HafuCoins-[\w-]+\.png$/.test(info.assetUrl) && info.probe.ok && info.probe.size > 100000 ? 'BUILD SMOKE OK' : 'BUILD SMOKE FAILED');
} finally { await browser.close(); }
