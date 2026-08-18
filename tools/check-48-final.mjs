import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);
const res = await page.evaluate(() => {
  const anim = window.__anim;
  // 读 撤离成功(ind48) 元素的 data.ks.p 和 data.ks.a
  const e = anim.renderer.elements.find(el => el && el.data && el.data.ind === 48);
  const td = e.data.t.d.k;
  const s = Array.isArray(td) ? td[0].s : td.s;
  return {
    j: s.j,
    anchor: e.data.ks.a.k,
    pos: e.data.ks.p.k,
    fontSize: s.s,
    text: s.t,
    finalTransform: e.finalTransform ? Array.from(e.finalTransform.localMat.props).slice(0,16).map(v => Math.round(v*100)/100) : null,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
