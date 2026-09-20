/* 验证「任务弹窗动画」的导出通路(该动画没有音效,audio=null,导出应只出视频轨而不报错):
 * 点「导出视频」→ 等浮层走完 → 检查下载目录里的 mp4:文件存在、ftyp 头正确、且不含 mp4a 音轨。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:5173/';
const OUT = 'I:/Delta Force custom animation/tools/.mission-check/export';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1000 });
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });
  await page.select('#selAnim', 'mission');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('任务弹窗动画'), { timeout: 60000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 60000 });
  /* 用 element.click() 而不是 page.click():启动加载层(#app-loading)在动画就绪后还会停留几百毫秒,
   * page.click 是按坐标点的,可能点到那层遮罩上导致「点了没反应」——脚本里踩过这个坑。 */
  await page.evaluate(() => document.getElementById('btnExport').click());
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => ({ status: document.getElementById('exportStatus').textContent, pct: document.getElementById('exportPercent').textContent, detail: document.getElementById('exportDetail').textContent, hidden: document.getElementById('exportOverlay').hidden }));
    const line = JSON.stringify(st);
    if (line !== last) { console.log('  ' + line); last = line; }
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4') && !f.endsWith('.crdownload'));
    if (files.length && st.pct === '100%') break;
    await sleep(1500);
  }
  await sleep(2000);
  const files = fs.readdirSync(OUT);
  console.log('downloads:', files.join(', '));
  const mp4 = files.find((f) => f.endsWith('.mp4'));
  if (mp4) {
    const buf = fs.readFileSync(OUT + '/' + mp4);
    const head = buf.slice(0, 16).toString('latin1');
    const hasAudio = buf.includes(Buffer.from('mp4a', 'latin1'));
    console.log('mp4 size:', (buf.length / 1048576).toFixed(2), 'MB  head:', JSON.stringify(head), ' 含 mp4a 音轨:', hasAudio);
  }
  console.log('page errors:', errors.slice(0, 4).join(' || ') || '(none)');
} finally { await browser.close(); }
