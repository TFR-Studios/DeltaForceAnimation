import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);
const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
data.layers = data.layers.filter(l => l.ind !== 1);
const res = await page.evaluate(async (dStr) => {
  if (window.__anim) window.__anim.destroy();
  const c = document.getElementById('previewInner'); c.innerHTML = '';
  const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(dStr) });
  await new Promise((r) => setTimeout(r, 2500));
  anim.renderer.renderFrame(200, true);
  await new Promise((r) => setTimeout(r, 500));
  const svg = c.querySelector('svg');
  // dump 所有 text/tspan 元素
  const out = [];
  const scan = (node, depth) => {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'text' || tag === 'tspan') {
      let bbox = null;
      try { const b = node.getBBox(); bbox = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; } catch {}
      out.push({ tag, content: (node.textContent || '').slice(0, 20), anchor: node.getAttribute('text-anchor'), x: node.getAttribute('x'), bbox });
    }
    Array.from(node.children).forEach(ch => scan(ch, depth + 1));
  };
  scan(svg, 0);
  return { textCount: out.length, samples: out.slice(0, 40) };
}, JSON.stringify(data));
console.log(JSON.stringify(res, null, 2));
await browser.close();
