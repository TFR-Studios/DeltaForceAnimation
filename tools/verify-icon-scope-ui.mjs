/* 图标选择 UI 与上传验证:选项卡截图、未开启二次扫描提示、上传自定义图标按段生效 */
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; out.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  → ' + extra : '')); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1700, height: 1000 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.select('#selAnim', 'exposed');
await page.waitForFunction(() => !!document.querySelector('#iconSection') && !document.querySelector('#iconSection').hidden && !!window.__anim, { timeout: 180000, polling: 500 });
await sleep(2500);

const state = () => page.evaluate(() => ({
  hintHidden: document.querySelector('#iconScopeHint').hidden,
  hint: document.querySelector('#iconScopeHint').textContent,
  followHidden: document.querySelector('#iconFollowRow').hidden,
  nextPick: document.querySelector('#iconScopeNameNext').textContent,
  mainPick: document.querySelector('#iconScopeNameMain').textContent,
  active: [...document.querySelectorAll('#iconList .icon-item.is-active')].map((li) => li.dataset.name),
  names: [...document.querySelectorAll('#iconList .icon-item')].map((li) => li.dataset.name),
  status: document.querySelector('#statusbar').textContent,
}));
const assets = () => page.evaluate(() => {
  const d = window.__anim?.animationData;
  const g = (id) => String((d?.assets ?? []).find((a) => a.id === id)?.p ?? '');
  return { main: g('image_0'), next: g('image_0_n') };
});

// 未开启二次扫描时:二次扫描页应提示「尚未开启…保留」
await page.click('#iconScopeNext');
await sleep(400);
const s1 = await state();
check('未开启二次扫描 + 二次扫描页 → 显示“尚未开启”提示', !s1.hintHidden && s1.hint.includes('尚未开启'), s1.hint);
const shot1 = await page.$('#iconSection');
await shot1.screenshot({ path: 'I:/Delta Force custom animation/tools/icon-scope-ui-next.png' }); // 二次扫描选项卡(含跟随开关/提示)截图

// 上传自定义图标:应只应用到当前(二次扫描)段
const before = await assets();
// 状态栏文字会被重建动画后的「已载入: …」覆盖,这里记录全过程出现过的文案
await page.evaluate(() => {
  window.__statusLog = [];
  const el = document.querySelector('#statusbar');
  window.__statusLog.push(el.textContent);
  new MutationObserver(() => window.__statusLog.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
});
const input = await page.$('#iconFile');
await input.uploadFile('I:/Delta Force custom animation/animation_2/icon/Hero_Sp_08.webp');
await sleep(3500);
const s2 = await state();
const a2 = await assets();
s2.statusLog = await page.evaluate(() => window.__statusLog);
check('上传后列表新增自定义项', s2.names.length === s1.names.length + 1, s2.names.slice(0, 2).join(', '));
check('上传的图标在二次扫描页被高亮', s2.active.some((n) => n.startsWith('Hero_Sp_08')), JSON.stringify(s2.active));
check('上传未影响位置暴露资源', a2.main === before.main, a2.main.slice(0, 40));
check('状态栏出现过「…到二次扫描」的提示', s2.statusLog.some((t) => t.includes('二次扫描')), JSON.stringify(s2.statusLog.slice(-2)));

// 开启二次扫描:第二段应使用刚上传的自定义图标(data URL)
await page.click('#chkNextScan');
await sleep(3500);
const a2b = await assets();
check('开启二次扫描后第二段使用上传的自定义图标', a2b.next.startsWith('data:image/') && a2b.main === before.main,
  a2b.next.slice(0, 30) + ' | main=' + a2b.main.slice(0, 30));

// 切回位置暴露页:高亮应是主段图标,而不是刚上传的那枚
await page.click('#iconScopeMain');
await sleep(400);
const s3 = await state();
check('切回位置暴露页:高亮为主段图标', s3.active.length === 1 && !s3.active[0].startsWith('Hero_Sp_08'), JSON.stringify(s3.active));
check('位置暴露页不显示跟随开关', s3.followHidden);
const shot2 = await page.$('#iconSection');
await shot2.screenshot({ path: 'I:/Delta Force custom animation/tools/icon-scope-ui-main.png' }); // 位置暴露选项卡截图
check('无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(out.join('\n'));
console.log('\nFAILURES: ' + failures);
await browser.close();
process.exit(failures ? 1 : 0);
