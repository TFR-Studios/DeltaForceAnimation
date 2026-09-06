// 完整导出透明 AVI → 页面内 fetch 上传到本地服务器落盘
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('已载入'), { timeout: 60000 });

  await page.evaluate(() => {
    const sel = document.getElementById('selRenderer');
    if (sel.value !== 'canvas') { sel.value = 'canvas'; sel.dispatchEvent(new Event('change')); }
    const t = document.getElementById('chkTransparent');
    if (!t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'avi';
    f.dispatchEvent(new Event('change'));
    window.__capturedBlob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type && blob.type.indexOf('x-msvideo') !== -1) window.__capturedBlob = blob;
      return orig.call(this, blob);
    };
    document.getElementById('btnExport').click();
  });
  console.log('透明 AVI 导出启动,等待完成(约 10-20 分钟)…');
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 2400000 });
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('导出完成, blob size =', size);

  console.log('开始上传到本地服务器…');
  const result = await page.evaluate(async () => {
    const blob = window.__capturedBlob;
    try {
      const res = await fetch('http://127.0.0.1:9999/save', { method: 'POST', body: blob });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      return { error: String(e).slice(0, 200) };
    }
  });
  console.log('上传结果:', JSON.stringify(result));
} finally {
  await browser.close();
}
