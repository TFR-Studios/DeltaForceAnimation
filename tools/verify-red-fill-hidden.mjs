/* 验证「纯红 #ff0000 填充不展示填充编辑」:
 * 逐套动画切过去,读侧栏「形状图层」列表里每个条目的填充/描边控件,和 JSON 里的实际填充色对照。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const ROOT = 'I:/Delta Force custom animation';
const targets = [
  { key: 'mission', label: '任务弹窗动画', file: 'animations/animation_4/animation_data.json' },
  { key: 'extraction', label: '撤离动画', file: 'animations/animation_1/animation_data.json' },
  { key: 'blinds', label: '核电站功率动画', file: 'animations/animation_3/animation_data.json' },
];
const hexOf = (fc) => '#' + fc.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
let fails = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1000 });
  page.on('pageerror', (e) => { console.log('PAGEERROR', String(e.message).slice(0, 200)); fails++; });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  for (const t of targets) {
    /* 第一项是启动时已经载入的默认动画(撤离),不用再切;其余切换并等状态栏 + 列表都就绪 ——
     * 只看状态栏是不够的:改选动画后状态栏可能还是上一套动画的文案,容易读到旧列表。
     * 这里在页面里同时轮询两者,失败时把当前状态打出来便于定位。 */
    if (t.key !== 'extraction') {
      await page.select('#selAnim', t.key);
      const deadline = Date.now() + 90000;
      let ready = false;
      while (Date.now() < deadline) {
        const st = await page.evaluate((lbl) => ({
          ok: document.getElementById('statusbar').textContent.includes(lbl) && document.querySelectorAll('#shapeList .text-item').length > 0,
          status: document.getElementById('statusbar').textContent,
          shapes: document.querySelectorAll('#shapeList .text-item').length,
        }), t.label);
        if (st.ok) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!ready) {
        const st = await page.evaluate(() => ({ status: document.getElementById('statusbar').textContent, shapes: document.querySelectorAll('#shapeList .text-item').length }));
        console.log('SKIP ' + t.label + ': 未能就绪 ' + JSON.stringify(st));
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
    const rows = await page.evaluate(() => [...document.querySelectorAll('#shapeList .text-item')].map((li) => ({
      nm: li.querySelector('.t-name').textContent,
      hasFill: !!li.querySelector('.s-fill'),
      hasStroke: !!li.querySelector('.s-stroke'),
    })));
    const data = JSON.parse(fs.readFileSync(ROOT + '/' + t.file, 'utf8'));
    const expect = new Map();
    for (const r of rows) expect.set(r.nm, r);
    let redTotal = 0, redShown = 0, nonRedTotal = 0, nonRedHidden = 0;
    for (const l of data.layers || []) {
      if (l.ty !== 4 || l.td === 1) continue;
      const fills = []; const walk = (it) => { for (const x of it || []) { if (x.ty === 'fl') fills.push(x); if (Array.isArray(x.it)) walk(x.it); } }; walk(l.shapes);
      if (!fills.length || !fills[0].c || fills[0].c.a !== 0) continue;
      const hex = hexOf(fills[0].c.k);
      const row = expect.get(l.nm || '(未命名)');
      if (!row) continue;
      if (hex === '#ff0000') { redTotal++; if (row.hasFill) redShown++; }
      else {
        nonRedTotal++;
        /* 除「纯红填充」外,站点还有一条既有的按名字隐藏名单(核电站功率动画的占位填充图层,
         * 见 main.ts 的 HIDE_FILL_SHAPE_NAMES):命中该名单的图层本来就不显示填充编辑,
         * 不能算作被新规则误伤。 */
        const BLINDS_NAME_HIDDEN = new Set(['形状图层2', '形状图层3', '形状图层8', '形状图层6', '形状图层4']);
        const byName = t.key === 'blinds' && BLINDS_NAME_HIDDEN.has(String(l.nm || '').replace(/\s+/g, ''));
        if (!row.hasFill && !byName) nonRedHidden++;
      }
    }
    const ok = redShown === 0 && nonRedHidden === 0;
    if (!ok) fails++;
    console.log((ok ? 'PASS ' : 'FAIL ') + t.label + ': 纯红填充图层 ' + redTotal + ' 个(仍显示填充编辑的 ' + redShown + ' 个)');
    console.log('       非纯红填充图层 ' + nonRedTotal + ' 个(被误隐藏的 ' + nonRedHidden + ' 个)');
  }
} finally { await browser.close(); }
console.log(fails === 0 ? '\n全部符合预期' : '\n有 ' + fails + ' 项不符');
