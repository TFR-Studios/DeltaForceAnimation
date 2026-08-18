// 端到端验证:驱动真实页面导出 MJPEG AVI(帧替换为 1×1 JPEG 以减小体积),
// 捕获下载的 Blob 写入磁盘,供 ffprobe 检查容器结构。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const OUT = 'I:/Delta Force custom animation/tools/e2e-test.avi';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('已载入'),
    { timeout: 30000 }
  );
  console.log('页面已载入动画');

  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fakeJpeg = new Blob([bytes], { type: 'image/jpeg' });
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(fakeJpeg); };
    window.__capturedBlobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { window.__capturedBlobs.push(blob); return orig.call(this, blob); };
  }, TINY_JPEG_B64);

  await page.evaluate(() => {
    const t = document.getElementById('chkTransparent');
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'avi';
    f.dispatchEvent(new Event('change'));
  });

  await page.evaluate(() => document.getElementById('btnExport').click());
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('导出完成'),
    { timeout: 180000 }
  );
  console.log('导出完成');

  const b64 = await page.evaluate(async () => {
    const blobs = window.__capturedBlobs;
    const blob = blobs[blobs.length - 1];
    const r = new FileReader();
    return new Promise((res) => {
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
  });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(OUT, buf);
  console.log('AVI 已写入:', OUT, buf.length, 'bytes');
} finally {
  await browser.close();
}
