/* 移动端判定回归:覆盖「手机开电脑模式」等 UA 被改写的场景。
 * 只加载页面读结果(不导出),秒级完成。
 * 判定口径:page.emulate 的 isMobile/hasTouch 会让 (pointer: coarse) 匹配,
 * 再叠加页面脚本覆盖 navigator.maxTouchPoints(真机是 5,无头默认 0/1)。
 *
 * 用法:node tools/verify-mobile-detect.mjs                                    (默认打 dev server 5173)
 *      VERIFY_BASE=http://localhost:4173/ node tools/verify-mobile-detect.mjs   (验证生产构建 dist/)
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173/';

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidDesktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

/* touchPoints:真机触点数;isMobile/hasTouch:是否按触屏设备仿真(决定 pointer: coarse);
 * uaMobileHint:模拟 Chromium 的 Sec-CH-UA-Mobile(电脑模式下仍为 true)。 */
const CASES = [
  { name: '安卓 Chrome 普通模式', ua: UA.android, touch: 5, isMobile: true, hasTouch: true, uaMobileHint: true, want: true },
  { name: '安卓 Chrome 电脑模式(UA 变桌面)', ua: UA.androidDesktop, touch: 5, isMobile: true, hasTouch: true, uaMobileHint: null, want: true },
  { name: '安卓 Chrome 电脑模式(仅 UA-CH 提示)', ua: UA.androidDesktop, touch: 0, isMobile: false, hasTouch: false, uaMobileHint: true, want: true },
  { name: 'iPhone Safari 普通模式', ua: UA.iphone, touch: 5, isMobile: false, hasTouch: true, uaMobileHint: null, want: true },
  { name: 'iPhone Safari 电脑模式(UA 变 Macintosh)', ua: UA.ipadDesktop, touch: 5, isMobile: false, hasTouch: true, uaMobileHint: null, want: true },
  { name: 'Windows 桌面 Chrome(无触屏)', ua: UA.desktop, touch: 0, isMobile: false, hasTouch: false, uaMobileHint: false, want: false },
  { name: 'Windows 触屏笔记本(鼠标为主指针)', ua: UA.desktop, touch: 10, isMobile: false, hasTouch: false, uaMobileHint: false, want: false },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const rows = [];
let failed = 0;
try {
  for (const c of CASES) {
    const page = await browser.newPage();
    await page.emulate({
      viewport: { width: c.isMobile ? 393 : 1440, height: c.isMobile ? 851 : 900, deviceScaleFactor: 1, isMobile: c.isMobile, hasTouch: c.hasTouch },
      userAgent: c.ua,
    });
    await page.evaluateOnNewDocument((cfg) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => cfg.touch, configurable: true });
      if (cfg.uaMobileHint !== null) {
        Object.defineProperty(navigator, 'userAgentData', { get: () => ({ mobile: cfg.uaMobileHint }), configurable: true });
      }
    }, { touch: c.touch, uaMobileHint: c.uaMobileHint });
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('btnExportSave'), { timeout: 120000 });
    const got = await page.evaluate(() => ({
      buttonText: document.getElementById('btnExportSave').textContent.trim(),
      detect: window.__mobileDetect || null,
      coarse: matchMedia('(pointer: coarse)').matches,
    }));
    const isMobile = got.buttonText === '保存到手机';
    const pass = isMobile === c.want;
    if (!pass) failed++;
    rows.push({
      case: c.name, want: c.want, got: isMobile, pass,
      signals: got.detect ? { coarse: got.detect.coarse, touch: got.detect.touchPoints, uaMobile: got.detect.uaMobile, chMobile: got.detect.chMobile, iPadDesktop: got.detect.iPadDesktop, shortSide: got.detect.shortSide } : null,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(rows, null, 1));
console.log(failed ? 'FAILED: ' + failed : 'ALL PASS');
process.exit(failed ? 1 : 0);
