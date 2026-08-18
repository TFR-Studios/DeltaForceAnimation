import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2000);

const info = await page.evaluate(() => ({
  VideoEncoder: typeof window.VideoEncoder,
  AudioEncoder: typeof window.AudioEncoder,
  VideoFrame: typeof window.VideoFrame,
  AudioData: typeof window.AudioData,
  OfflineAudioContext: typeof window.OfflineAudioContext,
  btnExport: !!document.getElementById('btnExport'),
  selFormat: document.getElementById('selFormat') ? Array.from(document.getElementById('selFormat').options).map(o => o.value) : null,
}));
console.log('环境与UI:', JSON.stringify(info));

// 微测:VideoEncoder 编码 3 帧(用 mp4-muxer 封装),验证管线
const microTest = await page.evaluate(async () => {
  try {
    const { Muxer, ArrayBufferTarget } = await import('/node_modules/.vite/deps/mp4-muxer.js');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: 64, height: 64, frameRate: 60 }, fastStart: 'in-memory' });
    const chunks = [];
    const enc = new VideoEncoder({
      output: (chunk, meta) => { chunks.push(chunk); muxer.addVideoChunk(chunk, meta); },
      error: (e) => { throw e; },
    });
    const support = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 64, height: 64, bitrate: 500000, framerate: 60 });
    enc.configure({ codec: 'avc1.42001f', width: 64, height: 64, bitrate: 500000, framerate: 60 });
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,64,64);
    for (let i = 0; i < 3; i++) {
      const f = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / 60), duration: Math.round(1e6/60) });
      enc.encode(f, { keyFrame: i === 0 }); f.close();
    }
    await enc.flush(); enc.close();
    muxer.finalize();
    return { configSupported: support.supported, chunkCount: chunks.length, mp4Bytes: muxer.target.buffer.byteLength };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('微测结果:', JSON.stringify(microTest));
console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
