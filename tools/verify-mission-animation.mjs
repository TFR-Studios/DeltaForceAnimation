/* 验证「任务弹窗动画」(animations/animation_4)已接入网站:
 * 1) 选择器出现第四项,切换后数据加载完成、状态栏就绪;
 * 2) 图标区块按单图标位形态显示(无分段选项卡/显示图标开关),列表含哈夫币图标,不透明度行出现;
 * 3) 图标资源指向打包后的静态资源(不是 images/xxx.png 相对路径),浏览器能真正取到该图;
 * 4) 文字/形状图层可编辑、图片区块与时长区块按预期隐藏;
 * 5) 不透明度滑块改的是图标图层的 ks.o,上传自定义图标能改写资源;
 * 6) 抽帧截图留档。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:5173/';
const OUT = 'I:/Delta Force custom animation/tools/.mission-check';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
/* 生成一张 64×64 的纯红 PNG 作为「自定义图标」的上传素材(手写 PNG 编码,避免依赖额外库)。
 * 必须是一张能被浏览器正常解码的图:早先用过一段截断的 base64,结果图标位渲染成空白,
 * 误判成「上传没生效」——素材无效时测试结论也不可信。 */
const zlib = await import('node:zlib');
function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    for (let x = 0; x < w; x++) { const p = off + 1 + x * 4; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255; }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(OUT + '/custom-icon.png', solidPng(64, 64, [255, 40, 40]));

const out = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/net::|Failed to load resource/i.test(t)) pageErrors.push('[console] ' + t); });
  await page.setViewport({ width: 1700, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  const options = await page.evaluate(() => [...document.querySelectorAll('#selAnim option')].map((o) => o.value + ':' + o.textContent));
  check('选择器有四项', options.length === 4 && options[3].startsWith('mission:'), options.join(', '));

  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  await sleep(600);

  const ui = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const info = Object.fromEntries([...q('#infoList').querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
    return {
      statusbar: q('#statusbar').textContent,
      iconSectionHidden: q('#iconSection').hidden,
      iconTabsHidden: q('#iconScopeTabs').hidden,
      iconToggleHidden: q('#iconToggleRow').hidden,
      iconOpacityHidden: q('#iconOpacityRow').hidden,
      iconOpacityVal: q('#iconOpacityVal').textContent,
      iconCount: q('#iconCount').textContent,
      iconNames: [...q('#iconList').querySelectorAll('.icon-name')].map((n) => n.textContent),
      imageSectionHidden: q('#imageSection').hidden,
      timingHidden: q('#timingSection').hidden,
      popupHidden: q('#popupSection').hidden,
      textNames: [...q('#textList').querySelectorAll('.t-name')].map((n) => n.textContent),
      shapeNames: [...q('#shapeList').querySelectorAll('.t-name')].map((n) => n.textContent),
      info,
      assets: (window.__anim.animationData.assets ?? []).map((a) => ({ id: a.id, p: String(a.p).slice(0, 60), u: a.u, e: a.e })),
      svgImageHrefs: [...document.querySelectorAll('#previewInner image')].map((i) => i.getAttribute('href') || i.getAttribute('xlink:href')),
    };
  });
  check('图标区块显示', ui.iconSectionHidden === false);
  check('分段选项卡隐藏(单图标位)', ui.iconTabsHidden === true);
  check('「显示图标」开关隐藏', ui.iconToggleHidden === true);
  check('图标不透明度行显示', ui.iconOpacityHidden === false, 'val=' + ui.iconOpacityVal);
  check('图标列表含哈夫币图标', ui.iconNames.includes('MallIcon_HafuCoins'), ui.iconNames.slice(0, 3).join(','));
  check('图片图层区块隐藏', ui.imageSectionHidden === true);
  check('时长区块隐藏(非位置暴露)', ui.timingHidden === true);
  check('弹窗区块隐藏', ui.popupHidden === true);
  check('文字图层 4 个', ui.textNames.length === 4, ui.textNames.join(','));
  check('形状图层有内容', ui.shapeNames.length > 0, ui.shapeNames.length + ' 个');
  check('图标资源指向打包资源(非 images/ 相对路径)', /^https?:|^data:|^\/|^\./.test(ui.assets[0]?.p ?? '') && !String(ui.assets[0]?.p).startsWith('images/'), JSON.stringify(ui.assets[0]));
  console.log('--- 动画信息 ---'); for (const [k, v] of Object.entries(ui.info)) console.log('  ' + k + ': ' + v);

  // 图标图片真实可取到
  const assetProbe = await page.evaluate(async (url) => {
    try { const r = await fetch(url); const b = await r.blob(); return { ok: r.ok, status: r.status, type: b.type, size: b.size }; }
    catch (e) { return { ok: false, error: String(e) }; }
  }, ui.assets[0].p);
  check('图标资源可下载', assetProbe.ok && assetProbe.size > 1000, JSON.stringify(assetProbe));
  check('SVG 中已挂上图标', ui.svgImageHrefs.length > 0, ui.svgImageHrefs.map((h) => String(h).slice(0, 40)).join(' | '));

  /* 定格到指定帧再截图:必须先 pause —— 动画默认自动播放,只调 goToAndStop 的话
   * 页面自身的 tick 会继续往后推帧,截图时画面早就不是那一帧了(图标早已淡出)。 */
  const freezeAt = async (fr) => {
    await page.evaluate(async (f) => { window.__anim.pause(); window.__anim.goToAndStop(f, true); await new Promise((r) => setTimeout(r, 250)); }, fr);
  };
  const shots = [0, 60, 100, 140, 200];
  for (const f of [60, 140]) {
    await freezeAt(f);
    await page.screenshot({ path: OUT + '/mission-' + f + '.png' });
  }
  console.log('frames rendered:', shots.join(','));

  // 不透明度滑块
  const opBefore = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const layer = d.layers.find((l) => l.ty === 2 && l.ks && l.ks.src === undefined);
    return { ind: layer.ind, o: JSON.parse(JSON.stringify(layer.ks.o)) };
  });
  await page.evaluate(() => {
    const sl = document.getElementById('iconOpacitySlider');
    sl.value = '35';
    sl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1200);
  const opAfter = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const layer = d.layers.find((l) => l.ty === 2 && l.ks && l.ks.src === undefined);
    return { o: JSON.parse(JSON.stringify(layer.ks.o)), label: document.getElementById('iconOpacityVal').textContent };
  });
  const flat = (v) => JSON.stringify(v);
  check('不透明度滑块改写了图标图层 ks.o', flat(opBefore.o) !== flat(opAfter.o), 'before=' + flat(opBefore.o) + ' after=' + flat(opAfter.o) + ' label=' + opAfter.label);
  await freezeAt(140);
  await page.screenshot({ path: OUT + '/mission-opacity35.png' });

  // 上传自定义图标
  const input = await page.$('#iconFile');
  await input.uploadFile(OUT + '/custom-icon.png');
  await sleep(2000);
  const afterUpload = await page.evaluate(() => ({
    names: [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent),
    active: [...document.querySelectorAll('#iconList .icon-item.is-active .icon-name')].map((n) => n.textContent),
    asset: String((window.__anim.animationData.assets ?? [])[0]?.p ?? '').slice(0, 40),
    status: document.getElementById('statusbar').textContent,
  }));
  check('上传图标进入列表', afterUpload.names.some((n) => n.startsWith('custom-icon')), afterUpload.names.slice(0, 3).join(','));
  check('上传图标已应用(data:image)', afterUpload.asset.startsWith('data:image'), afterUpload.asset + ' | ' + afterUpload.status);
  await page.screenshot({ path: OUT + '/mission-uploaded.png' });

  // 切回其它动画再回来,确认不炸
  await page.select('#selAnim', 'exposed');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('位置暴露'), { timeout: 90000 });
  const back = await page.evaluate(() => ({
    tabsHidden: document.getElementById('iconScopeTabs').hidden,
    toggleHidden: document.getElementById('iconToggleRow').hidden,
    opacityHidden: document.getElementById('iconOpacityRow').hidden,
    icons: [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent).slice(0, 3),
  }));
  check('回到位置暴露:选项卡/开关恢复、不透明度行隐藏、图标列表回到技能图标',
    back.tabsHidden === false && back.toggleHidden === false && back.opacityHidden === true && !back.icons.includes('MallIcon_HafuCoins'),
    JSON.stringify(back));
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await sleep(500);
  const again = await page.evaluate(() => ({
    icons: [...document.querySelectorAll('#iconList .icon-name')].map((n) => n.textContent),
    active: [...document.querySelectorAll('#iconList .icon-item.is-active .icon-name')].map((n) => n.textContent),
    asset: String((window.__anim.animationData.assets ?? [])[0]?.p ?? '').slice(0, 30),
  }));
  check('再次进入任务弹窗动画:自定义图标选择被保留', again.active.some((n) => n.startsWith('custom-icon')), JSON.stringify(again));
  await page.screenshot({ path: OUT + '/mission-again.png' });

  /* 回归:位置暴露动画的「显示图标」开关是它自己的设置(取消勾选会把数据改成「图标透明 + 文字回中」),
   * 切到别的动画再切回来必须保持勾选状态与数据一致,不能被其它动画的 UI 逻辑重置掉。 */
  await page.select('#selAnim', 'exposed');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('位置暴露'), { timeout: 90000 });
  await page.evaluate(() => {
    const c = document.getElementById('chkIcon');
    c.checked = false;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(1500);
  const hiddenState = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const layer = d.layers.find((l) => l.nm === '图标_可替换');
    return { checked: document.getElementById('chkIcon').checked, opacity: JSON.stringify(layer?.ks?.o) };
  });
  check('位置暴露:取消「显示图标」后图标层透明度被改为 0', hiddenState.checked === false && /"s":\[0\]|"k":0/.test(hiddenState.opacity), hiddenState.opacity.slice(0, 80));
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  const onMission = await page.evaluate(() => ({ checked: document.getElementById('chkIcon').checked, toggleHidden: document.getElementById('iconToggleRow').hidden }));
  check('切到任务弹窗动画:「显示图标」开关隐藏且不改写其勾选状态', onMission.toggleHidden === true && onMission.checked === false, JSON.stringify(onMission));
  await page.select('#selAnim', 'exposed');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('位置暴露'), { timeout: 90000 });
  await sleep(800);
  const backExposed = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const layer = d.layers.find((l) => l.nm === '图标_可替换');
    return { checked: document.getElementById('chkIcon').checked, opacity: JSON.stringify(layer?.ks?.o) };
  });
  check('切回位置暴露:仍是「隐藏图标」状态且与开关一致', backExposed.checked === false && /"s":\[0\]|"k":0/.test(backExposed.opacity), backExposed.opacity.slice(0, 80));

  check('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 5).join(' || '));
} finally {
  await browser.close();
}
console.log(out.join('\n'));
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
