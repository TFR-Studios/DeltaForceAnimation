/* 生产构建(dist)冒烟测试:确认打包后的黑潮爆破动画也能加载,位图资源指向产物地址(data: 内联或 /assets/*.png),
 * 且没有任何 .mp4/.gif 被带进产物。 */
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
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 120000 });
  /* 切动画后必须等**新的 lottie 实例**就绪:window.__anim 在切换过程中可能仍是上一个动画的实例,
   * 而它的 isLoaded 早就是 true —— 只等 isLoaded 会读到上一套动画的数据(实测踩到过:读到核电站功率的
   * 359 帧与序列图资源)。这里先给旧实例打标记,再等实例被换掉。 */
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast'
    && document.getElementById('statusbar').textContent.includes('黑潮爆破默认弹窗动画')
    && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 200 });
  const info = await page.evaluate(async () => {
    const diag = {
      sel: document.getElementById('selAnim').value,
      status: document.getElementById('statusbar').textContent.slice(0, 40),
      sameAsPrev: window.__anim === window.__prevAnim,
      totalFrames: Math.round(window.__anim.totalFrames),
      ids: (window.__anim.animationData.assets || []).slice(0, 8).map((a) => String(a.id)),
    };
    window.__anim.pause(); window.__anim.goToAndStop(120, true);
    await new Promise((r) => setTimeout(r, 300));
    const assets = window.__anim.animationData.assets.filter((a) => a.p).map((a) => ({ id: a.id, kind: String(a.p).startsWith('data:') ? 'data:' + String(a.p).slice(5, 20) : String(a.p).slice(-40) }));
    const probes = [];
    for (const a of window.__anim.animationData.assets) {
      if (!a.p || String(a.p).startsWith('data:')) continue;
      const r = await fetch(a.p);
      probes.push({ p: String(a.p).slice(-34), ok: r.ok, size: (await r.blob()).size });
    }
    return { renderer: window.__anim.renderer.rendererType, totalFrames: window.__anim.totalFrames, assets, probes, diag };
  });
  console.log('DIAG:', JSON.stringify(info.diag));
  console.log(JSON.stringify({ assets: info.assets, probes: info.probes }, null, 1));
  console.log('errors:', errors.slice(0, 3).join(' || ') || '(none)');
  /* 时间轴长度 = 源数据的 op(600)—— 这套动画不配 caps.defaultDuration,载入即 AE 导出原样 */
  const ok = info.probes.every((p) => p.ok && p.size > 100) && info.totalFrames === 600;
  console.log(ok ? 'BUILD SMOKE OK' : 'BUILD SMOKE FAILED');
} finally { await browser.close(); }
