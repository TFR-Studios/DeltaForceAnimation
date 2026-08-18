// 字体渲染对比:CJK 字符在 ProjectDTypeCurve-Bold vs 系统字体下的像素形态
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);

const res = await page.evaluate(async () => {
  const cv = document.createElement('canvas');
  cv.width = 400; cv.height = 500;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  const render = (font, ch, y) => {
    ctx.clearRect(0, 0, 400, 500);
    ctx.font = font;
    ctx.fillText(ch, 10, y);
    const m = ctx.measureText(ch);
    const d = ctx.getImageData(0, 0, 400, 500).data;
    let ink = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i + 3] > 10) { ink++; const x = p % 400, yy = (p / 400) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    return { width: m.width, ink, bw, bh, density: +(ink / (bw * bh)).toFixed(2) };
  };
  const fonts = ['60px "ProjectD Type Curve"', '60px "Microsoft YaHei"', '60px sans-serif'];
  const out = {};
  for (const f of fonts) {
    const key = f.replace(/px.*"(.*)"/, '$1') + (f.includes('sans-serif') ? 'sans' : '');
    out[key] = {};
    for (const ch of ['撤', '难', '1', 'A']) {
      out[key][ch] = render(f, ch, 40);
    }
    out[key].checkCJK = document.fonts.check('16px "' + key + '"', '撤');
  }
  return out;
});
console.log(JSON.stringify(res, null, 2));
await browser.close();

