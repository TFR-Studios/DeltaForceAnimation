// 完整动画在第30帧(元素可见)渲染,对比镜像前后左右对称情况
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);

const orig = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.mirror-backup.json','utf8'));
const curr = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));

async function renderFull(data, label, frame) {
  return await page.evaluate(async ({ d, fr }) => {
    if (window.__anim) window.__anim.destroy();
    const c = document.getElementById('previewInner'); c.innerHTML = '';
    const anim = window.__lottie.loadAnimation({ container: c, renderer: 'svg', loop: false, autoplay: false, animationData: d });
    window.__anim = anim;
    await new Promise((r) => setTimeout(r, 1500));
    anim.renderer.renderFrame(fr, true);
    await new Promise((r) => setTimeout(r, 500));
    const svg = c.querySelector('svg');
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    await new Promise((rs, rj) => { img.onload = rs; img.onerror = rj; });
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 1920, 1080);
    const dd = cx.getImageData(0, 0, 1920, 1080).data;
    let left = 0, right = 0;
    for (let i = 0, p = 0; i < dd.length; i += 4, p++) {
      if (dd[i+3] > 20) { if ((p % 1920) < 960) left++; else right++; }
    }
    const ch = ' .:-=+*#%@'; const CW = 110, CH = 30;
    const rows = [];
    for (let cy = 0; cy < CH; cy++) {
      let row = '';
      for (let cx0 = 0; cx0 < CW; cx0++) {
        const x0 = Math.floor(cx0*1920/CW), x1 = Math.floor((cx0+1)*1920/CW);
        const y0 = Math.floor(cy*1080/CH), y1 = Math.floor((cy+1)*1080/CH);
        let sum=0, cnt=0;
        for (let y=y0;y<y1;y+=2) for (let x=x0;x<x1;x+=2) {
          const i=(y*1920+x)*4; if(dd[i+3]>20){sum+=(dd[i]+dd[i+1]+dd[i+2])/3;cnt++;}
        }
        row += cnt===0?' ':ch[Math.min(9,Math.floor(sum/cnt/25.6))];
      }
      rows.push(row);
    }
    return { left, right, ascii: rows.join('\n') };
  }, { d: data, fr: frame });
}

const r1 = await renderFull(orig, '原始', 30);
console.log('===== 原始(镜像前) 帧30 左像素=' + r1.left + ' 右像素=' + r1.right + ' =====');
console.log(r1.ascii);
const r2 = await renderFull(curr, '镜像后', 30);
console.log('\n===== 镜像后 帧30 左像素=' + r2.left + ' 右像素=' + r2.right + ' =====');
console.log(r2.ascii);
await browser.close();

