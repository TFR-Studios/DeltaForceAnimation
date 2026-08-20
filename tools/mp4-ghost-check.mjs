// MP4 连续帧残影检测:提帧 300-309,每帧序列区域 vs 素材(合成色),检测帧间独立
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TMP = 'I:/Delta Force custom animation/tools/.mp4seq';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const OUT = TMP + '/anim.mp4';

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
    if (t.checked) t.click();
    const f = document.getElementById('selFormat');
    f.value = 'mp4';
    f.dispatchEvent(new Event('change'));
    window.__capturedBlob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type && blob.type.indexOf('mp4') !== -1) window.__capturedBlob = blob;
      return orig.call(this, blob);
    };
    document.getElementById('btnExport').click();
  });
  await page.waitForFunction(() => document.getElementById('statusbar').textContent.includes('导出完成'), { timeout: 900000 });
  const size = await page.evaluate(() => (window.__capturedBlob ? window.__capturedBlob.size : -1));
  console.log('MP4 导出完成, size =', size);

  // 分块传回
  const CHUNK = 6 * 1024 * 1024;
  const fd = fs.openSync(OUT, 'w');
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = await page.evaluate(async ({ off, len }) => {
      const blob = window.__capturedBlob;
      const r = new FileReader();
      return new Promise((res) => { r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob.slice(off, off + len)); });
    }, { off, len: Math.min(CHUNK, size - off) });
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  console.log('MP4 已写入:', OUT, fs.statSync(OUT).size);

  // 提帧 300-309
  for (let i = 0; i < 10; i++) {
    const f = 300 + i;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', OUT, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/f${f}.raw`]);
    const mp4f = fs.readFileSync(TMP + `/f${f}.raw`);
    const n = String(f).padStart(5, '0');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `I:/Delta Force custom animation/animation/ccreptile/ccreptitle_${n}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
    const seq = fs.readFileSync(TMP + '/seq.raw');
    const bg = [0x16, 0x18, 0x1d];
    let seqPx = 0, matched = 0;
    for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
      const j = (y * 1920 + x) * 4;
      if (seq[j + 3] > 8) {
        seqPx++;
        const a = seq[j + 3] / 255;
        const er = Math.round(seq[j] * a + bg[0] * (1 - a));
        const eg = Math.round(seq[j + 1] * a + bg[1] * (1 - a));
        const eb = Math.round(seq[j + 2] * a + bg[2] * (1 - a));
        const diff = Math.abs(mp4f[j] - er) + Math.abs(mp4f[j + 1] - eg) + Math.abs(mp4f[j + 2] - eb);
        if (diff < 60) matched++;
      }
    }
    console.log(`MP4 帧 ${f}: 序列匹配 ${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}% ${seqPx && matched / seqPx > 0.85 ? '✓' : '✗'}`);
  }
} finally {
  await browser.close();
}
