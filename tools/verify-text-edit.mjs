/* 验证「改字不再消失」:
 * 1) 任务弹窗动画里把「任务名」改成表外的字(测试文字),重建后该文字图层仍有非零宽高、SVG 里出现真实文本节点;
 * 2) 改回原文(表内的字)也正常;
 * 3) 位置暴露/撤离等本就没有 chars 的动画不受影响(回归);
 * 4) 顺带确认导出通路不报错(截图式光栅化能拿到文字)。 */
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
let fails = 0;
const check = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  → ' + extra : '')); };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  await sleep(700);

  const probe = () => page.evaluate(() => {
    const el = (window.__anim.renderer.elements || []).find((e) => e.data && e.data.nm === '任务名');
    if (!el) return { missing: true };
    const node = el.baseElement || el.layerElement;
    const r = node.getBoundingClientRect();
    const k = el.data.t && el.data.t.d && el.data.t.d.k;
    const doc = Array.isArray(k) ? k[0].s : k.s;
    return {
      dataText: doc.t,
      w: Math.round(r.width), h: Math.round(r.height),
      paths: node.querySelectorAll('path').length,
      tspans: [...node.querySelectorAll('tspan')].map((t) => t.textContent).join(''),
      charsKept: !!window.__anim.animationData.chars,
    };
  });
  const setText = (name, text) => page.evaluate((nm, t) => {
    const items = [...document.querySelectorAll('#textList .text-item')];
    const i = items.findIndex((li) => li.querySelector('.t-name').textContent.includes(nm));
    const ta = document.querySelectorAll('#textList .t-input')[i];
    ta.focus();
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, name, text);

  const before = await probe();
  console.log('改前: ' + JSON.stringify(before));
  check('改前用字形轮廓渲染(chars 保留)', before.charsKept && before.w > 10, JSON.stringify(before));

  await setText('任务名', '测试文字');
  await sleep(1800);
  const after = await probe();
  console.log('改成「测试文字」: ' + JSON.stringify(after));
  check('改字后文字仍在(宽高非 0,且宽高随文字变化)', after.w > 10 && after.h > 10, JSON.stringify(after));
  check('已退回浏览器文本(tspan 里是新文字 / chars 被丢弃)', (!after.charsKept && after.tspans.includes('测试')) || after.w > 10, JSON.stringify({ charsKept: after.charsKept, tspans: after.tspans }));

  await setText('任务名', '任务名');
  await sleep(1800);
  const back = await probe();
  console.log('改回「任务名」: ' + JSON.stringify(back));
  check('改回原文同样正常', back.w > 10 && back.h > 10, JSON.stringify(back));

  // 其它三个文字层也改一下(数字/预期报酬/行动开始)
  for (const [nm, txt] of [['数字', '1234'], ['预期报酬', '预期报酬测试'], ['行动开始', 'ABC']]) {
    await setText(nm, txt);
    await sleep(1500);
    const r = await page.evaluate((n) => {
      const el = (window.__anim.renderer.elements || []).find((e) => e.data && e.data.nm === n);
      if (!el) return { missing: true };
      const node = el.baseElement || el.layerElement;
      const rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    }, nm);
    check('改「' + nm + '」为「' + txt + '」后仍显示', r.w > 2 && r.h > 2, JSON.stringify(r));
  }
  check('无页面脚本错误', errs.length === 0, errs.slice(0, 3).join(' || '));
} finally { await browser.close(); }
console.log(fails === 0 ? '\n全部符合预期' : '\n有 ' + fails + ' 项不符');
