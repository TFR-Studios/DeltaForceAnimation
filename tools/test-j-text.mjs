import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

const base = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
base.layers = base.layers.filter(l => l.ind !== 1);

async function dumpText(jVal) {
  const data = JSON.parse(JSON.stringify(base));
  const l = data.layers.find(x => x.ind === 48);
  l.t.d.k[0].s.j = jVal;
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    await new Promise((r) => setTimeout(r, 2000));
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 400));
    const texts = Array.from(c.querySelectorAll('text')).map(t => {
      let bbox = null;
      try { const b = t.getBBox(); bbox = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; } catch {}
      return { content: t.textContent, anchor: t.getAttribute('text-anchor'), x: t.getAttribute('x'), y: t.getAttribute('y'), bbox };
    }).filter(t => t.content && t.content.trim().length > 0);
    return texts;
  }, JSON.stringify(data));
}

const r0 = await dumpText(0);
const r2 = await dumpText(2);
console.log('=== j=0 文本元素 ===');
r0.filter(t => t.content.includes('撤离成功') || t.content.includes('地点') || t.content.includes('对局时间')).forEach(t => console.log(JSON.stringify(t)));
console.log('=== j=2 文本元素 ===');
r2.filter(t => t.content.includes('撤离成功') || t.content.includes('地点') || t.content.includes('对局时间')).forEach(t => console.log(JSON.stringify(t)));
await browser.close();
