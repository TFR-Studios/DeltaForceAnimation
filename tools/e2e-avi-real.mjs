// 真实端到端:驱动真实页面完整导出 MJPEG AVI(真实帧数据),
// 在页面内捕获下载 Blob,分块传回 Node 拼接写盘,供 ffmpeg 提帧对比。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = 'I:/Delta Force custom animation/tools/animation.avi';
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

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

  await page.evaluate(() => {
    window.__capturedBlob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type && blob.type.indexOf('x-msvideo') !== -1) window.__capturedBlob = blob;
      return orig.call(this, blob);
    };
    const t = document.getElementById('chkTransparent');
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'avi';
    f.dispatchEvent(new Event('change'));
  });

  await page.evaluate(() => document.getElementById('btnExport').click());
  await page.waitForFunction(
    () => document.getElementById('statusbar').textContent.includes('导出完成'),
    { timeout: 600000 }
  );
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('导出完成, blob size =', size);

  if (size <= 0) throw new Error('未捕获到 AVI blob');
  // 分块传回
  const CHUNK = 6 * 1024 * 1024; // 6MB
  const fd = fs.openSync(OUT, 'w');
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = await page.evaluate(async ({ off, len }) => {
      const blob = window.__capturedBlob;
      const slice = blob.slice(off, off + len);
      const r = new FileReader();
      return new Promise((res) => {
        r.onload = () => res(String(r.result).split(',')[1]);
        r.readAsDataURL(slice);
      });
    }, { off, len: Math.min(CHUNK, size - off) });
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
    if (Math.floor(off / CHUNK) % 5 === 0) console.log('transfer', Math.round((off / size) * 100) + '%');
  }
  fs.closeSync(fd);
  console.log('AVI 已写入:', OUT, fs.statSync(OUT).size, 'bytes');
} finally {
  await browser.close();
}
