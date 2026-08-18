// 在 SVG 和 Canvas 两种渲染器下,分别隔离这6个图层,确认显示与位置
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);

const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

async function testRenderer(renderer, label) {
  const res = await page.evaluate(async ({ renderer, dataStr, label }) => {
    if (window.__anim) window.__anim.destroy();
    const container = document.getElementById('previewInner');
    container.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container, renderer, loop: false, autoplay: false, animationData: JSON.parse(dataStr) });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 2000));
    // 隔离6个图层,扫多个帧看它们是否显示
    const inds = [7,18,20,21,22,23];
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !inds.includes(e.data.ind);
    const out = [];
    for (const fr of [30, 60, 90, 120, 150]) {
      if (renderer === 'canvas') anim.renderer.renderFrame(fr, true);
      else anim.goToAndStop(fr, true);
      await new Promise((r) => setTimeout(r, 350));
      const c = container.querySelector(renderer === 'canvas' ? 'canvas' : 'svg');
      let opaque = -1, minX = -1, maxX = -1;
      if (renderer === 'canvas') {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        opaque = 0; minX = 1e9; maxX = -1;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) { if (d[i+3] > 0) { opaque++; const x = p % c.width; if (x < minX) minX = x; if (x > maxX) maxX = x; } }
        if (minX === 1e9) minX = -1; if (maxX === -1) maxX = -1;
      } else {
        // svg: 统计画不了像素,只确认元素存在 + 记录每层 transform
        const gs = Array.from(c.querySelectorAll('g'));
        opaque = c.querySelectorAll('path,circle,rect,ellipse,line,polygon').length;
        minX = gs.length; maxX = gs.length;
      }
      out.push({ fr, opaque, minX, maxX });
    }
    for (const e of all) e.data.hd = false;
    return out;
  }, { renderer, dataStr: JSON.stringify(data), label });
  console.log('=== ' + label + ' (' + renderer + ') ===');
  res.forEach(r => console.log('  frame ' + r.fr + ': 图形数=' + r.opaque + ' x范围=' + r.minX + '~' + r.maxX));
  // 额外:逐个图层看它在 SVG DOM 里有没有被 scale(-...) 且 transform 是多少
  if (renderer === 'svg') {
    const det = await page.evaluate(() => {
      const svg = document.querySelector('#previewInner svg');
      const names = ['绿色 2','长白线 2','最短线左 2','短线左 2','方框左 2','点左 2'];
      const res2 = {};
      const scan = (nodes) => { for (const n of nodes) { const t = n.getAttribute && n.getAttribute('transform'); const nm = n.getAttribute && n.getAttribute('data-name'); if (t) { res2[nm || n.tagName] = t; } if (n.children) scan(Array.from(n.children)); } };
      scan(Array.from(svg.querySelectorAll('*')));
      return res2;
    });
    console.log('  SVG transforms:');
    Object.entries(det).slice(0, 20).forEach(([k,v]) => console.log('   ', k, '=>', v));
  }
}

await testRenderer('svg', '镜像后图层(SVG)');
await browser.close();

