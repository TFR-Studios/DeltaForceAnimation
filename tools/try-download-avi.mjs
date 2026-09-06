// 尝试:headless 完整导出透明 AVI 并通过 CDP 下载落盘
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT_DIR = 'I:/Delta Force custom animation/tools/.dl';
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  // 尝试多种下载行为设置
  const client = await page.createCDPSession();
  try { await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR }); console.log('Page.setDownloadBehavior ok'); } catch (e) { console.log('Page fail:', String(e).slice(0, 80)); }
  try { const bc = await browser.target().createCDPSession(); await bc.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR, eventsEnabled: true }); console.log('Browser.setDownloadBehavior ok'); } catch (e) { console.log('Browser fail:', String(e).slice(0, 80)); }

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  console.log('页面已载入');

  await page.evaluate(() => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (!t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'avi';
    f.dispatchEvent(new Event('change'));
    document.getElementById('btnExport').click();
  });
  console.log('导出已启动,等待完成…');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 2400000 });
  console.log('导出完成,检查下载目录…');

  // 等待文件出现
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const files = fs.readdirSync(OUT_DIR);
    if (files.length > 0) {
      const f = files[0];
      const size = fs.statSync(OUT_DIR + '/' + f).size;
      console.log('下载文件:', f, (size / 1073741824).toFixed(2), 'GB');
      if (size > 4000000000) { console.log('✓ 完整落盘!'); break; }
    }
  }
} finally {
  await browser.close();
}
