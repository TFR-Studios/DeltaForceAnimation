/* 验证主题颜色与图标选择两项功能:
 * A. 主题颜色区:两个色块(默认填充颜色 / 描边默认颜色),改一次把「等于该颜色值」的填充与描边全部替换
 *    (含预合成内部),计数更新,可连续二次修改,「重置为默认色」回到 #77B0F0 / #78C5F3;
 * B. 图标选择:任务弹窗动画用 animation_4/icon/ 的 MallIcon_*,位置暴露动画仍是 Hero_Sp_*。 */
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

  // 站点替换范围内的颜色计数(顶层 + 被引用的预合成,按颜色值统计填充与描边)
  const countOf = (hex) => page.evaluate((target) => {
    const d = window.__anim.animationData;
    const toHex = (fc) => '#' + fc.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    const refs = new Set();
    const collect = (ls) => { for (const l of ls || []) { if (l.refId) refs.add(l.refId); if (Array.isArray(l.layers)) collect(l.layers); } };
    collect(d.layers);
    let n = 0;
    const seen = new Set();
    const walk = (ls) => {
      for (const l of ls || []) {
        if (!l || seen.has(l)) continue;
        seen.add(l);
        if (l.ty === 4) {
          const w = (it) => { for (const x of it || []) { if ((x.ty === 'fl' || x.ty === 'st') && x.c && x.c.a === 0 && toHex(x.c.k) === target) n++; if (Array.isArray(x.it)) w(x.it); } };
          w(l.shapes);
        }
        if (Array.isArray(l.layers)) walk(l.layers);
      }
    };
    walk(d.layers);
    for (const a of d.assets || []) if (Array.isArray(a.layers) && refs.has(a.id)) walk(a.layers);
    return n;
  }, hex);
  const setPicker = (sel, hex) => page.evaluate((s, h) => {
    const inp = document.querySelector(s);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, h);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, sel, hex);

  const ui = await page.evaluate(() => ({
    hidden: document.getElementById('themeSection').hidden,
    fill: document.getElementById('themeFill').value,
    stroke: document.getElementById('themeStroke').value,
    count: document.getElementById('themeCount').textContent,
    titles: [...document.querySelectorAll('#themeSection .t-color-label')].map((l) => l.textContent.trim().replace(/\s+/g, ' ').replace(/#[0-9a-f]{6}/i, '').trim()),
  }));
  console.log('主题颜色区: ' + JSON.stringify(ui));
  check('区块已显示,两个色块标题为「默认填充颜色 / 描边默认颜色」', !ui.hidden && ui.titles[0].includes('默认填充颜色') && ui.titles[1].includes('描边默认颜色'), JSON.stringify(ui.titles));
  check('初值 #77b0f0 / #78c5f3', ui.fill === '#77b0f0' && ui.stroke === '#78c5f3', ui.fill + ' / ' + ui.stroke);

  const beforeFill = await countOf('#77b0f0');
  const beforeStroke = await countOf('#78c5f3');
  console.log('改前:A 族(#77b0f0) ' + beforeFill + ' 处,B 族(#78c5f3) ' + beforeStroke + ' 处');
  await setPicker('#themeFill', '#123456');
  await sleep(1400);
  const afterFill = { old: await countOf('#77b0f0'), neo: await countOf('#123456'), strokeUntouched: await countOf('#78c5f3') };
  console.log('改后:旧 ' + afterFill.old + ' / 新 ' + afterFill.neo + ' / B 族(应不变) ' + afterFill.strokeUntouched);
  check('A 族颜色全部替换(填充+描边,含预合成)', beforeFill > 0 && afterFill.old === 0 && afterFill.neo === beforeFill, JSON.stringify(afterFill));
  check('B 族颜色未被波及', afterFill.strokeUntouched === beforeStroke, String(afterFill.strokeUntouched));

  await setPicker('#themeFill', '#654321');
  await sleep(1400);
  const second = await countOf('#654321');
  check('连续二次改色:A 族继续整体替换', second === beforeFill, '#654321 处数=' + second + '(应为 ' + beforeFill + ')');

  await page.evaluate(() => document.getElementById('themeReset').click());
  await sleep(1400);
  const reset = { n: await countOf('#77b0f0'), fill: await page.evaluate(() => document.getElementById('themeFill').value), green: await countOf('#654321') };
  check('「重置为默认色」回到 #77B0F0', reset.n === beforeFill && reset.green === 0 && reset.fill === '#77b0f0', JSON.stringify(reset));

  const icons = await page.evaluate(() => [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent));
  console.log('任务弹窗图标列表(' + icons.length + '): ' + icons.join(', '));
  check('图标来自 animation_4/icon/(全部 MallIcon_*)', icons.length >= 8 && icons.every((n) => n.startsWith('MallIcon_')), icons.join(','));
  check('不再混入 Hero_Sp_*', !icons.some((n) => n.startsWith('Hero_Sp')), icons.filter((n) => n.startsWith('Hero_Sp')).join(','));
  const thumb = await page.evaluate(() => { const el = document.querySelector('#iconList .icon-item.is-active .icon-thumb') || document.querySelector('#iconList .icon-thumb'); return el ? el.getAttribute('src') : null; });
  check('缩略图来自 animation_4/icon/', (thumb || '').includes('/animation_4/icon/'), String(thumb));

  await page.select('#selAnim', 'exposed');
  for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => document.getElementById('statusbar').textContent.includes('位置暴露动画')); if (ok) break; await sleep(500); }
  await sleep(900);
  const icons2 = await page.evaluate(() => [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent));
  check('位置暴露动画仍是 Hero_Sp_* 图标', icons2.some((n) => n.startsWith('Hero_Sp')), icons2.slice(0, 3).join(','));
  check('无页面脚本错误', errs.length === 0, errs.slice(0, 3).join(' || '));
} finally { await browser.close(); }
console.log(fails === 0 ? '\n全部符合预期' : '\n有 ' + fails + ' 项不符');