/* 黑潮爆破「图片图层」调色的交付验证:
 *  列出可调色图层 → 改色(资源换成着色后的 data URI + 图层纹理真的变了)→ 重置(完整还原) */
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1700, height: 1000 } });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__anim && window.__anim.isLoaded, { timeout: 120000 });
  await page.evaluate(() => { window.__prevAnim = window.__anim; });
  await page.select('#selAnim', 'blast');
  await page.waitForFunction(() => document.getElementById('selAnim').value === 'blast' && window.__anim && window.__anim !== window.__prevAnim && window.__anim.isLoaded, { timeout: 180000, polling: 150 });
  await sleep(1200);

  const sampleTint = () => page.evaluate(async (ref) => {
    const anim = window.__anim;
    anim.pause(); anim.goToAndStop(120, true);
    await new Promise((r) => setTimeout(r, 260));
    const asset = anim.animationData.assets.find((a) => a.id === ref);
    const svg = document.querySelector('#previewInner svg');
    const im = [...svg.querySelectorAll('image')].find((x) => (x.getAttribute('href') || '') === asset.p);
    const href = im ? im.getAttribute('href') : asset.p;
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = href; });
    if (!img) return null;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 20) continue; opaque++; if (d[i] > d[i + 1] + 30 && d[i] > d[i + 2] + 30) red++; }
    return { isData: String(asset.p).indexOf('data:image/') === 0, inDom: !!im, redPct: Math.round(100 * red / Math.max(1, opaque)) };
  }, TARGET);

  /* 验证「换资源」路径要用一张**没有 AE 填充效果**的位图:image_3(图标)符合;
   * image_3 / image_0 带「填充」,改色改的是填充色(另有一条检查覆盖)。 */
  const TARGET = 'image_3';
  const list = await page.evaluate(() => ({
    visible: !document.getElementById('imageSection').hidden,
    items: [...document.querySelectorAll('#imageList .text-item')].map((li) => ({
      name: li.querySelector('.t-name').textContent, ref: li.querySelector('.i-color').dataset.ref,
    })),
  }));
  check('「图片图层」区块显示', list.visible);
  /* 现在要求列出**全部**图片图层:6 张位图(提示条 / 图标 / 遮罩源 / HUD 底条 / 两张整幅图)
   * + 1 条 696 帧逐帧序列(用 seqname:<宿主层名> 作键)。 */
  const refs = list.items.map((i) => i.ref);
  const bitmaps = refs.filter((r) => !r.startsWith('seqname:') && !r.startsWith('seq:'));
  const seqs = refs.filter((r) => r.startsWith('seqname:') || r.startsWith('seq:'));
  check('列出全部 6 张位图', bitmaps.length === 6, JSON.stringify(bitmaps));
  check('列出逐帧序列(1 条)', seqs.length === 1, JSON.stringify(seqs));
  check('逐帧序列的 696 个帧资源未被逐个列出', !refs.some((r) => r.indexOf('imgSeq_') >= 0), JSON.stringify(refs));

  const before = await sampleTint();
  check('改色前:原始素材色(无红)', before && !before.isData && before.redPct === 0, JSON.stringify(before));

  await page.evaluate(() => {
    const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === 'image_3');
    ci.value = '#ff2d55'; ci.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(3500);
  const after = await sampleTint();
  check('改色后:资源变成着色后的 data URI', after && after.isData);
  check('改色后:图层纹理真的变红(画面可见)', after && after.redPct > 90, after ? after.redPct + '% 像素偏红' : '');
  const st1 = await page.evaluate(() => document.getElementById('statusbar').textContent);

  await page.evaluate(() => {
    const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === 'image_3');
    ci.closest('.text-item').querySelector('.i-reset').click();
  });
  await sleep(3500);
  const reset = await sampleTint();
  check('重置后:完整还原原始素材', reset && !reset.isData && reset.redPct === 0, JSON.stringify(reset));
  check('取色器回到默认(白色占位)', (await page.evaluate((ref) => {
    const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === ref);
    return ci ? ci.value : null;
  }, TARGET)) === '#ffffff');
  /* 逐帧序列走滤镜路径(与位图的换资源路径不同):选色后应生成并挂载 df-seq-tint 滤镜,重置后消失 */
  const seqRef = seqs[0];
  if (seqRef) {
    await page.evaluate((r) => {
      const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === r);
      ci.value = '#00e5ff'; ci.dispatchEvent(new Event('input', { bubbles: true }));
    }, seqRef);
    await sleep(1200);
    const on = await page.evaluate(() => ({
      filters: [...document.querySelectorAll('svg filter')].filter((f) => f.id.indexOf('df-seq-tint') === 0).length,
      mounted: [...document.querySelectorAll('#previewInner svg [style*="df-seq-tint"]')].length,
    }));
    check('序列改色:生成并挂载调色滤镜', on.filters > 0 && on.mounted > 0, JSON.stringify(on));
    await page.evaluate((r) => {
      const li = [...document.querySelectorAll('#imageList .text-item')].find((x) => x.querySelector('.i-color').dataset.ref === r);
      li.querySelector('.i-reset').click();
    }, seqRef);
    await sleep(1200);
    const off = await page.evaluate(() => [...document.querySelectorAll('svg filter')].filter((f) => f.id.indexOf('df-seq-tint') === 0).length);
    check('序列重置:滤镜撤掉', off === 0, String(off));
  }

  /* 带 AE「填充」的图层(提示条 image_3→现为 image_1 / HUD image_0):取色器改的是**填充色**,
   * 画面里看到的颜色就来自它,改完应立即生效。 */
  await page.evaluate(() => {
    const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === 'image_0');
    if (ci) { ci.value = '#ff0000'; ci.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(2200);
  const fillSt = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const l8 = d.layers.find((l) => l.ind === 8);
    const fp = (l8.ef || []).find((e) => e.ty === 21);
    const k = fp ? fp.ef.find((x) => x.ix === 3).v.k : null;
    const ci = [...document.querySelectorAll('#imageList .i-color')].find((c) => c.dataset.ref === 'image_0');
    return { fill: k ? k.map((v) => Math.round(v * 255)) : null, picker: ci ? ci.value : null };
  });
  check('带「填充」的图层:改的是填充色', fillSt.fill && fillSt.fill[0] === 255 && fillSt.fill[1] === 0, JSON.stringify(fillSt));
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('#imageList .text-item')].find((x) => x.querySelector('.i-color').dataset.ref === 'image_0');
    if (li) li.querySelector('.i-reset').click();
  });
  await sleep(2000);
  const fillBack = await page.evaluate(() => {
    const d = window.__anim.animationData;
    const l8 = d.layers.find((l) => l.ind === 8);
    const fp = (l8.ef || []).find((e) => e.ty === 21);
    const k = fp ? fp.ef.find((x) => x.ix === 3).v.k : null;
    return k ? k.map((v) => Math.round(v * 255)) : null;
  });
  check('填充色重置回原值 #81caf6', JSON.stringify(fillBack) === JSON.stringify([129, 202, 246, 255]), JSON.stringify(fillBack));

  check('无页面异常', errors.length === 0, errors.join(' | '));
  console.log(failures === 0 ? '图片图层调色:全部通过' : failures + ' 项未通过');
  process.exitCode = failures ? 1 : 0;
} finally { await browser.close(); }