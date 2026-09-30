/* 校验:载入黑潮爆破后站点**没有动过任何关键帧** —— 时间轴 = 源数据 op(600),
 * 且图片图层(提示条 image_1 / 图标 image_3)的透明度关键帧与 JSON 完全一致。 */
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1600, height: 950 } });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast' && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 150 });
  await sleep(900);
  const info = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const kf = (l) => { const o = l.ks.o; return o.a === 0 ? 'static ' + o.k : o.k.map((k) => k.t + '=' + JSON.stringify(k.s)).join(' '); };
    const byInd = {};
    for (const l of d.layers) if (l.ty === 2) byInd['ind' + l.ind] = kf(l);
    return {
      op: d.op, ip: d.ip, totalFrames: Math.round(window.__anim.totalFrames),
      durationVal: document.getElementById('durationVal').textContent,
      nextScanRowHidden: document.getElementById('nextScanRow').hidden,
      timingVisible: !document.getElementById('timingSection').hidden,
      imageOpacity: byInd,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  // 图层实际渲染出的透明度(不四舍五入),验证淡出仍发生在 192→216 / 114→145
  const curve = await page.evaluate(async () => {
    const anim = window.__anim;
    const want = [10, 12, 22];
    const els = anim.renderer.elements.filter((e) => e && e.data && want.includes(e.data.ind));
    const frames = [100, 180, 190, 200, 210, 216, 220, 240];
    const out = {};
    for (const el of els) {
      out['ind' + el.data.ind] = [];
      for (const f of frames) { anim.goToAndStop(f, true); await new Promise((r) => setTimeout(r, 40)); out['ind' + el.data.ind].push(Number((el.finalTransform.mProp.o.v * 100).toFixed(1))); }
    }
    return { frames, out };
  });
  console.log('有效不透明度(%):', JSON.stringify(curve));
} finally { await browser.close(); }
