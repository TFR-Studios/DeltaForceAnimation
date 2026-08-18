import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

async function measureCharPositions(dataPath) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  data.layers = data.layers.filter(l => l.ind !== 1);
  return await page.evaluate(async (dStr) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
    await new Promise((r) => setTimeout(r, 2500));
    anim.renderer.renderFrame(200, true);
    await new Promise((r) => setTimeout(r, 500));
    const svg = c.querySelector('svg');
    // 找 撤离成功 的四个字
    const chars = ['撤','离','成','功'];
    const rects = [];
    for (const el of Array.from(svg.querySelectorAll('text'))) {
      if (chars.includes(el.textContent)) {
        const r = el.getBoundingClientRect();
        rects.push({ ch: el.textContent, left: Math.round(r.left), right: Math.round(r.right), center: Math.round((r.left + r.right) / 2) });
      }
    }
    // 合并去重(每个字可能出现两次?取最后一组)
    const seen = {};
    for (const r of rects) seen[r.ch] = r;
    const uniq = Object.values(seen).sort((a,b) => a.left - b.left);
    const minL = Math.min(...uniq.map(r => r.left));
    const maxR = Math.max(...uniq.map(r => r.right));
    return { chars: uniq, groupLeft: minL, groupRight: maxR, groupCenter: Math.round((minL + maxR) / 2) };
  }, JSON.stringify(data));
}

const cur = await measureCharPositions('I:/Delta Force custom animation/animation/animation_data.json');
console.log('当前(j=0) 撤离成功:', JSON.stringify(cur, null, 2));
await browser.close();
