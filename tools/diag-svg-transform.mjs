// 以 SVG 渲染器隔离6个图层,打印其 DOM 结构(找 transform 和 scale(-))
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
await sleep(1200);

const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

const res = await page.evaluate(async ({ d }) => {
  if (window.__anim) window.__anim.destroy();
  const container = document.getElementById('previewInner');
  container.innerHTML = '';
  const anim = window.__lottie.loadAnimation({ container, renderer: 'svg', loop: false, autoplay: false, animationData: d });
  window.__anim = anim;
  await new Promise((r) => setTimeout(r, 2000));
  anim.goToAndStop(120, true);
  await new Promise((r) => setTimeout(r, 800));
  const inds = [7,18,20,21,22,23];
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  for (const e of all) e.data.hd = !inds.includes(e.data.ind);
  // 重新触发渲染
  anim.renderer.renderFrame(120, true);
  await new Promise((r) => setTimeout(r, 400));
  const svg = container.querySelector('svg');
  // 抓所有带 transform 的节点及其祖先结构
  const out = [];
  const walker = (node, depth) => {
    if (node.nodeType !== 1) return;
    const t = node.getAttribute('transform');
    const nm = node.getAttribute('data-name');
    const cls = node.getAttribute('class');
    if (t || nm) {
      out.push({ depth, tag: node.tagName, name: nm, cls, transform: t });
    }
    Array.from(node.children).forEach(c => walker(c, depth + 1));
  };
  walker(svg, 0);
  for (const e of all) e.data.hd = false;
  return out;
}, { d: data });
// 只打印目标图层的部分(按 class 或结构过滤会比较杂,先全量前60条)
res.filter(r => r.transform && r.transform.includes('-') ).slice(0, 40).forEach(r => console.log('[neg] ' + ' '.repeat(r.depth) + r.tag + ' name=' + r.name + ' cls=' + r.cls + ' tr=' + r.transform));
console.log('---- 有 transform 的其他节点 ----');
res.slice(0, 80).forEach(r => { if (!r.transform || !r.transform.includes('-')) console.log('      ' + ' '.repeat(r.depth) + r.tag + ' name=' + r.name + ' tr=' + r.transform); });
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();

