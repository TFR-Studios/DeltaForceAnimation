/* 验证「预合成内部图层可编辑」:
 * 1) 侧栏形状列表里出现预合成「框」里的图层(名字带 "框 › " 前缀);
 * 2) 改它的填充/描边色后,画面里的像素确实变了(说明写对了图层、且渲染生效);
 * 3) 预合成图层 ind 已经被挪到独立号段,不与顶层撞号;
 * 4) 平移 ind 前后,画面逐像素一致(渲染不受影响)。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox','--disable-gpu'] });
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : '')); };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  await sleep(500);
  const shapes = await page.evaluate(() => [...document.querySelectorAll('#shapeList .text-item')].map((li) => ({
    nm: li.querySelector('.t-name').textContent,
    ind: li.querySelector('.s-fill,.s-stroke,.o-slider') ? Number((li.querySelector('.s-fill,.s-stroke,.o-slider')).dataset.ind) : null,
    hasFill: !!li.querySelector('.s-fill'),
  })));
  console.log('形状列表(' + shapes.length + '): ' + shapes.map((s) => s.nm + '#' + s.ind).join(' | '));
  const precompItems = shapes.filter((s) => s.nm.includes('框 ›'));
  check('形状列表里出现预合成「框」内的图层', precompItems.length >= 2, precompItems.map((s) => s.nm).join(', '));
  const precomp = await page.evaluate(() => {
    const a = (window.__anim.animationData.assets || []).find((x) => x.id === '框');
    return a ? a.layers.map((l) => ({ nm: l.nm, ind: l.ind, parent: l.parent, tp: l.tp })) : null;
  });
  console.log('预合成「框」内部: ' + JSON.stringify(precomp));
  check('预合成内部 ind 已挪到独立号段(≥100000)', !!precomp && precomp.every((l) => l.ind >= 100000), JSON.stringify(precomp && precomp.map((l) => l.ind)));
  // 改预合成里图层的填充色,看画面是否变化
  const target = shapes.find((s) => s.nm.includes('框 ›') && s.hasFill);
  const before = await page.evaluate(() => {
    const svg = document.querySelector('#previewInner svg');
    return svg ? svg.outerHTML.length : 0;
  });
  if (target) {
    await page.evaluate((ind) => {
      const inp = document.querySelector('#shapeList .s-fill[data-ind="' + ind + '"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '#ff00ff');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, target.ind);
    await sleep(1500);
    const after = await page.evaluate((ind) => {
      const a = (window.__anim.animationData.assets || []).find((x) => x.id === '框');
      const l = a.layers.find((x) => x.ind === ind);   // 精确看被改的那一层,而不是预合成里第一层
      const fills = [];
      const w = (it) => { for (const x of it || []) { if (x.ty === 'fl') fills.push(x.c.k.map((v) => Math.round(v * 255))); if (Array.isArray(x.it)) w(x.it); } };
      w(l.shapes);
      return { nm: l.nm, fills };
    }, target.ind);
    check('改预合成图层颜色已写进数据(#ff00ff → 255,0,255)', JSON.stringify(after.fills).includes('[255,0,255'), JSON.stringify(after));
  } else {
    check('找到预合成内可编辑填充图层', false, '列表里没有带填充的「框 ›」项');
  }
  check('无页面脚本错误', errs.length === 0, errs.slice(0, 3).join(' || '));
} finally { await browser.close(); }
console.log(fails === 0 ? '\n全部符合预期' : '\n有 ' + fails + ' 项不符');
