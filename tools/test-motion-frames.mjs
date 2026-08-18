import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);
const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
data.layers = data.layers.filter(function(l){ return l.ty !== 5 && l.ty !== 6; });
const res = await page.evaluate(async function(dStr) {
  const data = JSON.parse(dStr);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + data.w + 'px;height:' + data.h + 'px;';
  document.body.appendChild(container);
  const anim = window.__lottie.loadAnimation({ container: container, renderer: 'canvas', rendererSettings: { dpr: 1 }, loop: false, autoplay: false, animationData: data });
  await new Promise(function(r){ setTimeout(r, 2500); });
  const canvas = container.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  // 采样中心 400x400 区域
  const grab = function() {
    const d = ctx.getImageData(760, 340, 400, 400).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) { sum = sum + d[i] + d[i+1] + d[i+2] + d[i+3]; }
    return sum;
  };
  const diffs = [];
  let prev = null;
  for (let f = 8; f <= 30; f++) {
    anim.renderer.renderFrame(f, true);
    await new Promise(function(r){ setTimeout(r, 30); });
    const cur = grab();
    if (prev !== null) { diffs.push({ pair: (f-1) + '->' + f, changed: prev !== cur }); }
    prev = cur;
  }
  container.remove();
  anim.destroy();
  return diffs;
}, JSON.stringify(data));
console.log(JSON.stringify(res, null, 1));
await browser.close();
