// 完整动画画面 ASCII(镜像后),看整体布局
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.select('#selRenderer', 'svg');
await sleep(2000);
const ascii = await page.evaluate(async () => {
  const a = window.__anim;
  a.renderer.renderFrame(120, true);
  await new Promise((r) => setTimeout(r, 600));
  const svg = document.querySelector('#previewInner svg');
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
  var cx = cv.getContext('2d'); cx.clearRect(0,0,1920,1080); cx.drawImage(img, 0, 0, 1920, 1080);
  var dd = cx.getImageData(0, 0, 1920, 1080).data;
  var ch = ' .:-=+*#%@'; var CW = 110, CH = 30;
  var rows = [];
  for (var cy = 0; cy < CH; cy++) {
    var row = '';
    for (var cx0 = 0; cx0 < CW; cx0++) {
      var x0 = Math.floor(cx0 * 1920 / CW), x1 = Math.floor((cx0 + 1) * 1920 / CW);
      var y0 = Math.floor(cy * 1080 / CH), y1 = Math.floor((cy + 1) * 1080 / CH);
      var sum = 0, cnt = 0;
      for (var y = y0; y < y1; y += 2) for (var x = x0; x < x1; x += 2) {
        var i = (y * 1920 + x) * 4;
        if (dd[i+3] > 30) { sum += (dd[i]+dd[i+1]+dd[i+2])/3; cnt++; }
      }
      row += cnt === 0 ? ' ' : ch[Math.min(9, Math.floor(sum/cnt/25.6))];
    }
    rows.push(row);
  }
  return rows.join('\n');
});
console.log(ascii);
await browser.close();

