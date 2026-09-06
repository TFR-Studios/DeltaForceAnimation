
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1680, height: 1050 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + String(e).slice(0, 250)));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('app-loading'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => {
  const sel = document.getElementById('selAnim');
  sel.value = 'exposed';
  sel.dispatchEvent(new Event('change'));
});
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => {
  const chk = document.getElementById('chkNextScan');
  chk.checked = true;
  chk.dispatchEvent(new Event('change'));
});
await new Promise(r => setTimeout(r, 3000));

// 测量函数:文字视觉中心(合成)、图标中心、组合范围
const measureAll = (label, frame) => page.evaluate(async (lbl, f) => {
  window.__anim.goToAndStop(f, true);
  await new Promise(r => setTimeout(r, 600));
  const svg = document.querySelector('#previewInner svg');
  const stage = document.querySelector('.preview-stage').getBoundingClientRect();
  const scale = stage.width / 1920;
  const texts = Array.from(svg.querySelectorAll('text')).map(t => {
    const r = t.getBoundingClientRect();
    return { txt: t.textContent || '', x: r.x, w: r.width };
  }).filter(x => x.w > 10);
  const imgs = Array.from(svg.querySelectorAll('image')).map(im => {
    const r = im.getBoundingClientRect();
    return { x: r.x, w: r.width };
  }).filter(x => x.w > 50 && x.w < 400);
  // 分组:第二段「即」开头 8 字,第一段「位置暴露」的位在扫位置……用内容区分不可靠,改用 p.x 判断
  const d = window.__anim.animationData;
  const t4p = d.layers.find(l => l.ind === 4).ks.p.k[0];
  const t104p = d.layers.find(l => l.ind === 104).ks.p.k[0];
  // 文字中心:所有可见文字的 bbox 范围
  const xs = texts.map(t => t.x), x2s = texts.map(t => t.x + t.w);
  const allCenter = (Math.min(...xs) + Math.max(...x2s)) / 2 / scale;
  const imgCenter = imgs.length ? (Math.min(...imgs.map(i => i.x)) + Math.max(...imgs.map(i => i.x + i.w))) / 2 / scale : null;
  return { label: lbl, frame: f, allTextCenterComp: Math.round(allCenter), textCount: texts.length, imgCount: imgs.length, imgCenterComp: imgCenter ? Math.round(imgCenter) : null, p4: t4p, p104: t104p };
}, label, frame);

console.log(JSON.stringify(await measureAll('有图标 帧30(第一段)', 30)));
console.log(JSON.stringify(await measureAll('有图标 帧140(第二段)', 140)));

// 取消图标
await page.evaluate(() => {
  const chk = document.getElementById('chkIcon');
  chk.checked = false;
  chk.dispatchEvent(new Event('change'));
});
await new Promise(r => setTimeout(r, 2000));
console.log(JSON.stringify(await measureAll('无图标 帧30(第一段)', 30)));
console.log(JSON.stringify(await measureAll('无图标 帧140(第二段)', 140)));
await browser.close();
