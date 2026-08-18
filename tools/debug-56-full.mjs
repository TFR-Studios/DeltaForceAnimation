// 全面排查 ind56:去掉音频层避免崩溃,检查透明度/位置/可见性,对比备份
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

async function check(dataPath, label) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // 去掉音频层 ind1,避免 audioFactory 崩溃
  data.layers = data.layers.filter(l => l.ind !== 1);
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 2500));
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    const t = all.find(e => e.data.ind === 56);
    let tInfo = null;
    if (t) {
      tInfo = {
        opacityProp: t.opacity ? (t.opacity.v !== undefined ? t.opacity.v : 'no-v') : 'no-opacity-prop',
        isInRange: t.isInRange, hidden: t.hidden, hd: t.data.hd,
        dataOpacityAnim: !!t.data.ks.o.a,
      };
    }
    for (const e of all) e.data.hd = !(e.data.ind === 56);
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 500));
    const cv = c.querySelector('canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i+3] > 0) opaque++;
    for (const e of all) e.data.hd = false;
    return { opaque, tInfo };
  }, JSON.stringify(data));
}

console.log('备份(原始动画位置):', JSON.stringify(await check('I:/Delta Force custom animation/animation/animation_data.pre-ccreptile-fix.json', 'before')));
console.log('当前(新位置):', JSON.stringify(await check('I:/Delta Force custom animation/animation/animation_data.json', 'after')));
await browser.close();

