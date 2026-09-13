/* 导出实证:同一时长/同一帧号下,「二次扫描跟随位置暴露」与「二次扫描单独图标」两次导出的差异
 * 应仅出现在第二段图标处;而第一段(相同帧)两次导出应完全一致,证明改第二段图标不会影响第一段。
 * 产物:.icon-export/follow/animation.mp4、.icon-export/custom/animation.mp4(以及抽取的帧 PNG)。*/
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = 'D:/FormatFactory/ffmpeg.exe';
const ROOT = 'I:/Delta Force custom animation/tools/.icon-export';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

fs.rmSync(ROOT, { recursive: true, force: true });
for (const m of ['follow', 'custom']) fs.mkdirSync(path.join(ROOT, m), { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

async function runExport(mode) {
  const dir = path.join(ROOT, mode);
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1000 });
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  page.on('pageerror', (e) => log('[' + mode + ' pageerror]', String(e.message).slice(0, 200)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.select('#selAnim', 'exposed');
  await page.waitForFunction(() => !!document.querySelector('#iconSection') && !document.querySelector('#iconSection').hidden && !!window.__anim, { timeout: 180000, polling: 500 });
  await sleep(2000);
  // 缩短两段时长,减少导出的帧数
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('rngDuration', 1);
  });
  await sleep(2000);
  await page.click('#chkNextScan');
  await sleep(3000);
  await page.evaluate(() => {
    const el = document.getElementById('rngNextDuration');
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(3000);
  let picks = null;
  if (mode === 'custom') {
    picks = await page.evaluate(() => {
      document.querySelector('#iconScopeNext').click();
      const items = [...document.querySelectorAll('#iconList .icon-item')];
      const li = items.find((x) => x.dataset.name.includes('Hero_Sp_06'));
      li.click();
      return { main: document.querySelector('#iconScopeNameMain').textContent, next: document.querySelector('#iconScopeNameNext').textContent };
    });
    await sleep(4000);
  }
  const meta = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const g = (id) => String((d?.assets ?? []).find((a) => a.id === id)?.p ?? '').slice(0, 40);
    return { mainOp: d.__mainOp, op: d.op, main: g('image_0'), next: g('image_0_n') };
  });
  log(mode, 'picks=', JSON.stringify(picks), 'meta=', JSON.stringify(meta));
  await page.click('#btnExport');
  // 等导出完成 + 文件落盘稳定
  await page.waitForFunction(() => {
    const o = document.querySelector('#exportOverlay');
    const s = document.querySelector('#statusbar').textContent;
    return o.hidden && /导出完成|导出失败|导出已取消/.test(s);
  }, { timeout: 900000, polling: 1000 });
  const status = await page.evaluate(() => document.querySelector('#statusbar').textContent);
  let file = null, last = -1;
  for (let i = 0; i < 60; i++) {
    const cand = fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
    if (cand.length) {
      const p = path.join(dir, cand[0]);
      const size = fs.statSync(p).size;
      if (size > 0 && size === last) { file = p; break; }
      last = size;
    }
    await sleep(500);
  }
  await page.close();
  return { mode, status, meta, file, size: file ? fs.statSync(file).size : 0 };
}

const r1 = await runExport('follow');
const r2 = await runExport('custom');
log('导出结果:', JSON.stringify(r1), JSON.stringify(r2));

/* 逐帧对比两次导出的同一批帧(用 -ss 精确定位,避免滤镜字符串转义问题):
 * · 第一段:两次导出应完全一致(改二次扫描图标不影响第一段);
 * · 第二段:应存在差异,且差异集中在图标处(差异包围盒远小于整帧)。*/
const W = 3840, H = 1080;
const rawAt = (file, frame) => execFileSync(FFMPEG, [
  '-v', 'error', '-i', file, '-ss', String((frame + 0.5) / 60), '-frames:v', '1',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
], { maxBuffer: 600 * 1024 * 1024 });

/* H.264 是有损编码:图标一变,编码器状态随之改变,图标右侧的文字边缘会出现少量
 * 量化噪声(每列仅几十像素)。因此除了总差异包围盒,再统计「密集区」——每列/每行差异
 * 像素超过阈值的范围,它对应真正的画面改动(图标),噪声列会被过滤掉。 */
function frameDiff(a, b) {
  const DENSE = 200;
  const cols = new Int32Array(W), rows = new Int32Array(H);
  let diff = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const d = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) + Math.abs(a[p + 3] - b[p + 3]);
      if (d > 24) { diff++; cols[x]++; rows[y]++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  let dMinX = 1e9, dMaxX = -1, dMinY = 1e9, dMaxY = -1;
  for (let x = 0; x < W; x++) if (cols[x] >= DENSE) { if (x < dMinX) dMinX = x; if (x > dMaxX) dMaxX = x; }
  for (let y = 0; y < H; y++) if (rows[y] >= DENSE) { if (y < dMinY) dMinY = y; if (y > dMaxY) dMaxY = y; }
  const dense = dMaxX >= 0 ? (dMaxX - dMinX + 1) * (dMaxY - dMinY + 1) : 0;
  return {
    diff,
    box: diff ? 'x[' + minX + '-' + maxX + '] y[' + minY + '-' + maxY + ']' : '-',
    denseBox: dense ? 'x[' + dMinX + '-' + dMaxX + '] y[' + dMinY + '-' + dMaxY + ']' : '-',
    denseShare: dense / (W * H),
  };
}

const mainOp = r1.meta.mainOp ?? 65;
const pairs = [
  { seg: '第一段(帧20/30/40)', frames: [20, 30, 40], same: true },
  { seg: '第二段(帧 mainOp+20/30/40)', frames: [mainOp + 20, mainOp + 30, mainOp + 40], same: false },
];
let failures = 0;
const report = [];
for (const p of pairs) {
  for (const f of p.frames) {
    const r = frameDiff(rawAt(r1.file, f), rawAt(r2.file, f));
    // 第一段:必须逐像素一致;第二段:必须有差异,且差异密集区仅占全帧一小块(即只有图标变了)
    const ok = p.same ? r.diff === 0 : (r.diff > 5000 && r.denseShare > 0 && r.denseShare < 0.05);
    if (!ok) failures++;
    report.push((ok ? 'PASS ' : 'FAIL ') + p.seg + ' 帧' + f + ': 差异像素 ' + r.diff +
      ' 密集区 ' + r.denseBox + ' (占全帧 ' + (r.denseShare * 100).toFixed(2) + '%)  包围盒 ' + r.box);
  }
}
log(report.join('\n'));
log('FAILURES: ' + failures);
await browser.close();
process.exit(failures ? 1 : 0);
