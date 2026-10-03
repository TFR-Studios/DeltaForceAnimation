/* 验证「永不卡死」护栏:把各个环节注入成永不 settle 的 Promise,导出必须在限时内
 * 降级继续或给出可读错误,而不是停在 0%。
 * 另外验证:手机端透明 AVI 内存护栏走错误收尾后按钮锁会复位(不会"点了没反应")。
 *
 * 用法:node tools/verify-export-resilience.mjs                                   (默认打 dev server 5173)
 *      VERIFY_BASE=http://localhost:4173/ node tools/verify-export-resilience.mjs  (验证生产构建 dist/)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173/';
const TMP = 'I:/Delta Force custom animation/tools/.hang-test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/* 永不 settle 的编码器探测:复现「卡在探测本机编码能力 / 初始化渲染器」的机型行为 */
const hangProbe = () => {
  if (window.VideoEncoder) window.VideoEncoder.isConfigSupported = () => new Promise(() => {});
};
const hangAacProbe = () => {
  if (window.AudioEncoder) window.AudioEncoder.isConfigSupported = () => new Promise(() => {});
};

const CASES = [
  { name: 'hangProbe', ua: CHROME_UA, touch: true, preload: hangProbe, expect: /兼容录制|MJPEG|导出完成/ },
  { name: 'hangAacProbe', ua: CHROME_UA, touch: true, preload: hangAacProbe, expect: /导出完成/ },
  { name: 'mobileTransparentGuard', ua: IPHONE_UA, touch: true, transparent: true, expect: /手机上无法导出无压缩透明 AVI/ },
];

function probe(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file], { encoding: 'utf8' });
    const j = JSON.parse(out);
    return (j.streams || []).map((s) => s.codec_type + ':' + s.codec_name).join(', ');
  } catch (e) { return 'probe error: ' + String(e.message).slice(0, 120); }
}

async function saveBlob(page, out) {
  const size = await page.evaluate(() => (window.__blobs.length ? window.__blobs[window.__blobs.length - 1].size : -1));
  if (size <= 0) return -1;
  const CHUNK = 4 * 1024 * 1024;
  const fd = fs.openSync(out, 'w');
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = await page.evaluate(async ({ off, len }) => {
      const blob = window.__blobs[window.__blobs.length - 1];
      const r = new FileReader();
      return new Promise((res) => { r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob.slice(off, off + len)); });
    }, { off, len: Math.min(CHUNK, size - off) });
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  return size;
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let failed = 0;
const rows = [];
for (const c of CASES) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.emulate({
      viewport: { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: c.touch },
      userAgent: c.ua,
    });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    if (c.preload) await page.evaluateOnNewDocument(c.preload);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('statusbar')?.textContent.includes('已载入'), { timeout: 180000, polling: 500 });
    await page.evaluate((wantTransparent) => {
      const t = document.getElementById('chkTransparent');
      if (t.checked !== wantTransparent) t.click();
      window.__blobs = [];
      const orig = URL.createObjectURL;
      URL.createObjectURL = function (b) { if (b && String(b.type).indexOf('video') === 0) window.__blobs.push(b); return orig.call(this, b); };
      window.__details = [];
      window.__timer = setInterval(() => {
        const d = document.getElementById('exportDetail').textContent;
        if (!window.__details.includes(d)) window.__details.push(d);
      }, 300);
    }, !!c.transparent);

    const t0 = Date.now();
    await page.evaluate(() => document.getElementById('btnExport').click());
    let finished = true;
    try {
      await page.waitForFunction(() => {
        const s = document.getElementById('statusbar').textContent;
        return s.includes('导出完成') || s.includes('导出失败');
      }, { timeout: 180000, polling: 500 });
    } catch { finished = false; }
    const seconds = Math.round((Date.now() - t0) / 1000);
    const state = await page.evaluate(() => ({
      status: document.getElementById('statusbar').textContent,
      overlayStatus: document.getElementById('exportStatus').textContent,
      overlayDetail: document.getElementById('exportDetail').textContent,
      tag: document.getElementById('exportFormatTag').textContent,
      exportBtnDisabled: document.getElementById('btnExport').disabled,
      details: window.__details,
    }));
    // 护栏复位:错误收尾后按钮必须能再点,否则用户看到的是"点了没反应"
    let retryHandled = null;
    let retryDisabled = null;
    if (!state.exportBtnDisabled) {
      await page.evaluate(() => { const b = document.getElementById('btnExportCancel'); if (b && !b.disabled) b.click(); });
      await new Promise((r) => setTimeout(r, 500));
      await page.evaluate(() => document.getElementById('btnExport').click());
      /* 立刻读:早退路径(护栏直接报错)会同步复位按钮并再次显示失败;真正启动的导出会把按钮置灰。
       * 两种情况都算"按钮没被卡死标志挡住",区别只是有没有真的跑起来。 */
      const after = await page.evaluate(() => ({ disabled: document.getElementById('btnExport').disabled, status: document.getElementById('statusbar').textContent }));
      retryDisabled = after.disabled;
      retryHandled = after.disabled === true || after.status.includes('导出失败');
      await page.evaluate(() => { const b = document.getElementById('btnExportCancel'); if (b && !b.disabled) b.click(); });
      await new Promise((r) => setTimeout(r, 1200));
    }
    const bytes = await saveBlob(page, TMP + '/' + c.name + '.bin');
    const row = {
      case: c.name, seconds, finished, state, retryHandled, retryDisabled, bytes,
      expectationMet: c.expect.test(state.overlayDetail + ' ' + state.status),
      probe: bytes > 0 ? probe(TMP + '/' + c.name + '.bin') : null,
      heartbeatSeen: state.details.some((d) => /已用时 \d+s/.test(d)),
      errors: errors.slice(0, 4),
    };
    if (!row.finished || !row.expectationMet || row.retryHandled === false) failed++;
    rows.push(row);
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(rows, null, 1));
console.log(failed ? 'FAILED: ' + failed : 'ALL PASS');
process.exit(failed ? 1 : 0);
