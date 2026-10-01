import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1920, height: 1080 } });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast' && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 150 });
  await sleep(1500);
  await page.evaluate(() => { window.__anim.pause(); window.__anim.goToAndStop(30, true); });
  await sleep(400);
  const st = await page.evaluate(() => {
    const svg = document.querySelector('#previewInner svg');
    const xml = new XMLSerializer().serializeToString(svg);
    const withLoc = (xml.match(/url\(([^)]*#)/g) || []);
    const fragOnly = (xml.match(/url\(#[^)]*\)/g) || []);
    // 采样所有 mask / clip-path / filter 属性
    const attrs = [];
    svg.querySelectorAll('[mask],[clip-path],[filter]').forEach((n) => {
      for (const a of ['mask','clip-path','filter']) { const v = n.getAttribute(a); if (v) attrs.push(a + '=' + v); }
    });
    return {
      urlWithLocation: [...new Set(withLoc)].slice(0, 6),
      fragOnlyCount: fragOnly.length, withLocCount: withLoc.length,
      attrSamples: [...new Set(attrs)].slice(0, 14),
      svgLen: xml.length,
      baseHref: document.baseURI,
    };
  });
  console.log(JSON.stringify(st, null, 1).slice(0, 2500));
} finally { await browser.close(); }