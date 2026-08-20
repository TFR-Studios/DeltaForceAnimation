// 验证弹窗宽度自适应:底板/蒙版宽度增量 = 文字增量;图标在文字左侧并随文字左缘移动
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--mute-audio'],
  defaultViewport: { width: 1680, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => {
  const el = document.getElementById('frameInfo');
  return el && el.textContent && !el.textContent.startsWith('0 / 0');
}, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

await page.click('#chkPopup');
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__anim?.goToAndStop(500, true));
await new Promise((r) => setTimeout(r, 800));

const measure = () =>
  page.evaluate(() => {
    const svg = document.querySelector('#popupLayer svg');
    // 文字:所有字母包围盒并集
    let tx = Infinity, tr = -Infinity;
    for (const t of svg.querySelectorAll('g[transform] text')) {
      const r = t.getBoundingClientRect();
      if (!r.width) continue;
      if (r.x < tx) tx = r.x;
      if (r.right > tr) tr = r.right;
    }
    const textW = tr - tx;
    // 底板:最宽的 path
    let panelW = 0;
    for (const p of svg.querySelectorAll('path')) {
      const r = p.getBoundingClientRect();
      if (r.width > panelW) panelW = r.width;
    }
    // 蒙版:scale-y=1.52767 的组,取 scale-x
    let maskScaleX = 0;
    for (const g of svg.querySelectorAll('g[transform]')) {
      const m = g.getAttribute('transform').match(/matrix\(([\d.]+),0,0,1\.5276/);
      if (m) { maskScaleX = parseFloat(m[1]); break; }
    }
    // 图标:菱形底座(15.7 级矩形,旋转矩阵 0.618 组)中心
    let iconCX = 0, iconRight = 0;
    for (const g of svg.querySelectorAll('g[transform]')) {
      const t = g.getAttribute('transform');
      if (!t.includes('0.618')) continue;
      for (const el of g.querySelectorAll('path, rect')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        iconCX = r.x + r.width / 2;
        iconRight = r.x + r.width;
      }
    }
    return { textW, textLeft: tx, panelW, maskScaleX, iconCX, iconRight };
  });

const m0 = await measure();
console.log('初始: 底板=' + m0.panelW.toFixed(1) + ' 文字=' + m0.textW.toFixed(1) + ' 蒙版X缩放=' + m0.maskScaleX.toFixed(3) + ' 图标中心=' + m0.iconCX.toFixed(1) + ' 图标右缘=' + m0.iconRight.toFixed(1));
const p0 = m0.panelW, t0 = m0.textW, mask0 = m0.maskScaleX, icon0 = m0.iconCX;
check('图标位于文字左侧', m0.iconRight < m0.textLeft + 1, 'iconRight=' + m0.iconRight.toFixed(1) + ' textLeft=' + m0.textLeft.toFixed(1));

function check(name, ok, extra = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) process.exitCode = 1;
}

// 加长文字
const longText = '注意！您丢失了您带入战局或在战局中找到的所有物品。请立即检查您的仓库并联系客服处理,以免造成不必要的损失。';
await page.evaluate((t) => {
  const ta = document.querySelector('#popupTextList .pt-input');
  ta.value = t;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, longText);
await new Promise((r) => setTimeout(r, 1500));
const m1 = await measure();
console.log('加长: 底板=' + m1.panelW.toFixed(1) + ' 文字=' + m1.textW.toFixed(1) + ' 蒙版X缩放=' + m1.maskScaleX.toFixed(3) + ' 图标中心=' + m1.iconCX.toFixed(1));
const dPanel = m1.panelW - p0, dText = m1.textW - t0;
check('底板增量 = 文字增量', Math.abs(dPanel - dText) < 2, '底板+' + dPanel.toFixed(1) + ' 文字+' + dText.toFixed(1));
const maskRatio = m1.maskScaleX / mask0, panelRatio = m1.panelW / p0;
check('蒙版宽度同比例变化', Math.abs(maskRatio - panelRatio) < 0.01, '蒙版×' + maskRatio.toFixed(3) + ' 底板×' + panelRatio.toFixed(3));
const iconMove = icon0 - m1.iconCX;
check('图标随文字左缘移动(Δ/2)', Math.abs(iconMove - dText / 2) < 2, '图标左移' + iconMove.toFixed(1) + ' 文字增量/2=' + (dText / 2).toFixed(1));
check('加长后图标仍在文字左侧', m1.iconRight < m1.textLeft + 1, 'iconRight=' + m1.iconRight.toFixed(1) + ' textLeft=' + m1.textLeft.toFixed(1));

// 缩短
await page.evaluate(() => {
  const ta = document.querySelector('#popupTextList .pt-input');
  ta.value = '注意！';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1500));
const m2 = await measure();
check('缩短后底板收窄', m2.panelW < p0 - 50, '底板=' + m2.panelW.toFixed(1));
check('缩短后图标右移', m2.iconCX > m1.iconCX, '图标中心 ' + m1.iconCX.toFixed(1) + '→' + m2.iconCX.toFixed(1));

// 重置
await page.click('#popupTextList .pt-reset');
await new Promise((r) => setTimeout(r, 1500));
const m3 = await measure();
check('重置后全部恢复', Math.abs(m3.panelW - p0) < 2 && Math.abs(m3.maskScaleX - mask0) < 0.01 && Math.abs(m3.iconCX - icon0) < 2, JSON.stringify({ panel: +m3.panelW.toFixed(1), mask: +m3.maskScaleX.toFixed(3), icon: +m3.iconCX.toFixed(1) }));

console.log('\n' + (process.exitCode ? 'FAIL ✗' : 'PASS ✓ 蒙版宽度+图标位置自适应'), errors.length ? '页面错误: ' + errors.join(';') : '');
await browser.close();
process.exit(process.exitCode || 0);
