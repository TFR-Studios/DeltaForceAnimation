import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'canvas');
await sleep(2500);
const res = await page.evaluate(async () => {
  const anim = window.__anim;
  const all = [];
  const walk = (els) => { for (const e of els || []) { if (e && e.data && e.data.ty !== undefined) { all.push(e); if (e.elements) walk(e.elements); } } };
  walk(anim.renderer.elements);
  const t = all.find(e => e.data.ind === 56);
  if (!t) return { found: false, count: all.length };
  const ft = t.finalTransform;
  let tx = null, ty = null;
  if (ft && ft.localMat && ft.localMat.props) { tx = ft.localMat.props[12]; ty = ft.localMat.props[13]; }
  return {
    found: true,
    elementCount: all.length,
    anchor: t.data.ks.a.k,
    posData: t.data.ks.p.k,
    scaleData: t.data.ks.s.k,
    rendered_tx: tx === null ? null : Math.round(tx * 100) / 100,
    rendered_ty: ty === null ? null : Math.round(ty * 100) / 100,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
