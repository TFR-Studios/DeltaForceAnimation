/* 验证「位置暴露动画」图标按段(位置暴露 / 二次扫描)分别自定义:
 * 1) 图标区块新增两个选项卡 + 「二次扫描跟随位置暴露」开关;
 * 2) 在二次扫描页选图标 → 自动取消跟随,只改第二段资源(image_0_n);
 * 3) 位置暴露图标不被第二段的写入影响(image_0 保持);
 * 4) 关闭再开启「二次扫描」后,第二段图标仍是用户所选;
 * 5) 画面实证:同一帧下「跟随」与「单独指定」两次截图应存在可见差异(差异应集中在图标处)。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''));
};

// 截图落在临时目录(点号前缀,便于与源码区分):seg2-follow / seg2-custom 即「跟随 vs 单独图标」的对比帧
const SHOT_DIR = 'I:/Delta Force custom animation/tools/.icon-check';
fs.rmSync(SHOT_DIR, { recursive: true, force: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
page.on('console', (m) => {
  // 忽略资源加载类噪音:开发服务器在页面预取/中断请求时会报 ERR_ABORTED / CONNECTION_RESET,
  // 与本次改动无关(仅关心脚本自身错误)
  const t = m.text();
  if (m.type() === 'error' && !/net::|Failed to load resource/i.test(t)) pageErrors.push('[console] ' + t);
});
await page.setViewport({ width: 1700, height: 1000 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });

const ui = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const items = [...q('#iconList').querySelectorAll('.icon-item')];
  return {
    sectionHidden: q('#iconSection').hidden,
    mainActive: q('#iconScopeMain').classList.contains('is-active'),
    nextActive: q('#iconScopeNext').classList.contains('is-active'),
    mainPick: q('#iconScopeNameMain').textContent,
    nextPick: q('#iconScopeNameNext').textContent,
    mainThumb: q('#iconScopeThumbMain').getAttribute('src'),
    nextThumb: q('#iconScopeThumbNext').getAttribute('src'),
    followRowHidden: q('#iconFollowRow').hidden,
    followChecked: q('#chkFollowMainIcon').checked,
    hintHidden: q('#iconScopeHint').hidden,
    hintText: q('#iconScopeHint').textContent,
    count: q('#iconCount').textContent,
    names: items.map((li) => li.dataset.name),
    active: items.filter((li) => li.classList.contains('is-active')).map((li) => li.dataset.name),
  };
});

const assets = () => page.evaluate(() => {
  const d = window.__anim?.animationData;
  return {
    main: String((d?.assets ?? []).find((a) => a.id === 'image_0')?.p ?? ''),
    next: String((d?.assets ?? []).find((a) => a.id === 'image_0_n')?.p ?? ''),
    mainOp: d?.__mainOp ?? null,
    op: d?.op ?? null,
    merged: (d?.layers ?? []).some((l) => l.ind >= 100),
  };
});

const clickItem = async (name) => {
  const ok = await page.evaluate((n) => {
    const li = [...document.querySelectorAll('#iconList .icon-item')].find((x) => x.dataset.name === n);
    if (!li) return false;
    li.click();
    return true;
  }, name);
  if (!ok) throw new Error('icon item not found: ' + name);
  await sleep(2500); // 等重建动画
};

const seekAndShoot = async (frame, path) => {
  await page.evaluate((f) => { window.__anim.goToAndStop(f, true); }, frame);
  await sleep(900);
  const stage = await page.$('#stage');
  await stage.screenshot({ path });
};

// ---------- 1) 切到位置暴露动画,等图标区块出现 ----------
await page.select('#selAnim', 'exposed');
await page.waitForFunction(() => {
  const s = document.querySelector('#iconSection');
  return !!s && !s.hidden && !!(window.__anim && window.__anim.animationData);
}, { timeout: 180000, polling: 500 });
await sleep(2000);

const u0 = await ui();
check('图标区块显示且有两个选项卡', !u0.sectionHidden && u0.mainActive && !u0.nextActive, JSON.stringify({ main: u0.mainPick, next: u0.nextPick }));
check('默认「二次扫描跟随位置暴露」勾选、跟随行在主选项卡隐藏', u0.followRowHidden && u0.followChecked);
check('两段默认图标一致', u0.mainPick === u0.nextPick && u0.mainThumb === u0.nextThumb, u0.mainPick + ' / ' + u0.nextPick);
check('网格默认高亮位置暴露的图标', u0.active.length === 1 && u0.active[0] === u0.names[0], JSON.stringify(u0.active));
const names = u0.names;
const iconA = names[0];
const iconB = names[3] ?? names[1]; // 与 A 不同的另一枚内置图标

// ---------- 2) 打开二次扫描,先看「跟随」状态 ----------
await page.click('#chkNextScan');
await sleep(3000);
const aFollow = await assets();
check('开启二次扫描后第二段资源存在(image_0_n)', aFollow.merged && !!aFollow.next);
check('跟随状态下第二段图标 == 第一段图标', aFollow.main === aFollow.next && aFollow.main.length > 0,
  aFollow.main.slice(0, 48) + ' | ' + aFollow.next.slice(0, 48));
const frameNext = (aFollow.mainOp ?? 80) + 30;
await seekAndShoot(frameNext, SHOT_DIR + '/seg2-follow.png');

// ---------- 3) 切到二次扫描选项卡:应出现跟随行 + 未开启提示消失 ----------
await page.click('#iconScopeNext');
await sleep(400);
const u1 = await ui();
check('切到二次扫描选项卡:跟随行出现、选项卡高亮切换',
  u1.nextActive && !u1.mainActive && !u1.followRowHidden,
  JSON.stringify({ followRowHidden: u1.followRowHidden, nextActive: u1.nextActive }));
check('二次扫描已开启 → 未开启提示隐藏', u1.hintHidden, u1.hintText);

// ---------- 4) 在二次扫描页选另一枚图标:应自动取消跟随,只改第二段 ----------
const beforeCustom = await assets();
await clickItem(iconB);
const u2 = await ui();
const a2 = await assets();
check('二次扫描页选图标 → 自动取消「跟随位置暴露」', !u2.followChecked);
check('二次扫描缩略图/名称更新为所选图标', u2.nextPick === iconB.replace(/\.[^.]+$/, ''), u2.nextPick);
check('第二段资源已换成所选图标', a2.next !== beforeCustom.next && a2.next.includes(iconB.split('.')[0]),
  a2.next.slice(0, 60));
check('第一段资源未被第二段的写入改动', a2.main === beforeCustom.main, a2.main.slice(0, 60));
check('选项卡加注「跟随」提示已消失', !u2.count.includes('跟随'), u2.count);
await seekAndShoot(frameNext, SHOT_DIR + '/seg2-custom.png');

// ---------- 4b) 渲染层实证:两个「图标_可替换」图层实际加载的图片不同 ----------
const iconLayers = await page.evaluate(() => {
  const els = window.__anim?.renderer?.elements ?? [];
  const out = [];
  for (const el of els) {
    if (!el || !el.data || el.data.nm !== '图标_可替换') continue;
    const node = el.baseElement ?? el.layerElement ?? null;
    const img = node && node.tagName === 'image' ? node : (node && node.querySelector ? node.querySelector('image') : null);
    out.push({
      ind: el.data.ind,
      href: img ? String(img.getAttribute('href') || img.getAttribute('xlink:href') || '') : null,
    });
  }
  return out;
});
const imgOfLayer = (ind) => iconLayers.find((x) => x.ind === ind)?.href ?? '';
check('渲染器找到两段图标图层(ind 5 / 105)', iconLayers.length === 2, JSON.stringify(iconLayers.map((x) => x.ind)));
check('位置暴露图标图层实际加载图标 A', imgOfLayer(5).includes(iconA.split('.')[0]), imgOfLayer(5));
check('二次扫描图标图层实际加载图标 B', imgOfLayer(105).includes(iconB.split('.')[0]), imgOfLayer(105));
check('两段图标图层实际加载的图片不同', !!imgOfLayer(105) && imgOfLayer(5) !== imgOfLayer(105),
  imgOfLayer(5) + ' vs ' + imgOfLayer(105));

// ---------- 5) 关闭 / 再开启二次扫描:第二段图标应保持 ----------
await page.click('#chkNextScan');
await sleep(2500);
await page.click('#chkNextScan');
await sleep(3000);
const a3 = await assets();
check('关闭再开启二次扫描后,第二段仍是自定义图标', a3.next === a2.next, a3.next.slice(0, 60));
check('重新合并后第一段图标不变', a3.main === a2.main, a3.main.slice(0, 60));

// ---------- 6) 回位置暴露页换图标:不应影响已独立的第二段 ----------
await page.click('#iconScopeMain');
await sleep(300);
const iconC = names[1] ?? names[2];
await clickItem(iconC);
const a4 = await assets();
check('换位置暴露图标后第二段保持独立(不跟随)', a4.next === a2.next, a4.next.slice(0, 60));
check('位置暴露资源随选择更新', a4.main !== a2.main, a4.main.slice(0, 60));

// ---------- 7) 重新勾选「跟随」:第二段应回到与第一段相同 ----------
await page.click('#iconScopeNext');
await sleep(300);
await page.click('#chkFollowMainIcon');
await sleep(2500);
const a5 = await assets();
check('勾选「跟随位置暴露」后两段图标再次一致', a5.main === a5.next && a5.main === a4.main, a5.next.slice(0, 60));
check('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

console.log(out.join('\n'));
console.log('\nFAILURES: ' + failures);
await browser.close();
process.exit(failures ? 1 : 0);
