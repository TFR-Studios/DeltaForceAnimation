// 用 Canvas 渲染,分别加载原始/镜像两版 JSON,隔离6个图层统计像素左右分布
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
await sleep(1200);

async function testFile(label, data) {
  // 通过页面内 lottie 直接加载指定数据到 canvas,不用改源文件
  const res = await page.evaluate(async (dataStr) => {
    const data = JSON.parse(dataStr);
    // 先销毁旧的
    if (window.__anim) window.__anim.destroy();
    const container = document.getElementById('previewInner');
    container.innerHTML = '';
    const lottie = window.__lottie;
    const anim = lottie.loadAnimation({ container, renderer: 'canvas', loop: false, autoplay: false, animationData: data });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 2000));
    // 隐藏非目标层
    const inds = [7,18,20,21,22,23];
    const all = [];
    const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
    walk(anim.renderer.elements);
    for (const e of all) e.data.hd = !inds.includes(e.data.ind);
    anim.renderer.renderFrame(120, true);
    await new Promise((r) => setTimeout(r, 800));
    const c = container.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let left = 0, right = 0, opaque = 0, minX = 1e9, maxX = -1;
    const w = c.width, mid = w / 2;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i + 3] > 0) {
        opaque++; const x = p % w;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (x < mid) left++; else right++;
      }
    }
    for (const e of all) e.data.hd = false;
    return { opaque, left, right, minX: minX===1e9?null:minX, maxX: maxX===-1?null:maxX, width: w };
  }, JSON.stringify(data));
  console.log(label + ':', JSON.stringify(res));
}

const orig = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirror-backup.json','utf8'));
const mirr = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
await testFile('原始(镜像前)', orig);
await testFile('镜像后', mirr);
await browser.close();

