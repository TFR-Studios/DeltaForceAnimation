import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1500);
// 微导出: 120 帧 @60fps
const b64 = await page.evaluate(async () => {
  const { Muxer, ArrayBufferTarget } = await import('/node_modules/.vite/deps/mp4-muxer.js');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: 320, height: 180, frameRate: 60 }, fastStart: 'in-memory' });
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  enc.configure({ codec: 'avc1.64002a', width: 320, height: 180, bitrate: 500000, framerate: 60 });
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0,0,320,180);
  const N = 120;
  for (let i = 0; i < N; i++) {
    const f = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / 60), duration: Math.round(1e6 / 60) });
    enc.encode(f, { keyFrame: i % 60 === 0 }); f.close();
  }
  await enc.flush(); enc.close();
  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
});
// Node 端解析 MP4 盒结构
function parseBoxes(buf, start, end, depth, out) {
  let off = start;
  while (off < end) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    out.push({ type, off: off + 8, size });
    if (['moov','trak','mdia','minf','stbl'].includes(type)) {
      parseBoxes(buf, off + 8, off + size, depth + 1, out);
    }
    if (size === 0) break;
    off += size;
  }
}
const buf = Buffer.from(b64, 'base64');
const boxes = [];
parseBoxes(buf, 0, buf.length, 0, boxes);
const mdhd = boxes.find(b => b.type === 'mdhd');
const stts = boxes.find(b => b.type === 'stts');
if (mdhd) {
  const ver = buf.readUInt8(mdhd.off);
  let timescale, offset;
  if (ver === 0) { timescale = buf.readUInt32BE(mdhd.off + 12); offset = mdhd.off + 16; }
  else { timescale = buf.readUInt32BE(mdhd.off + 20); offset = mdhd.off + 24; }
  console.log('mdhd timescale:', timescale);
}
if (stts) {
  const ver = buf.readUInt8(stts.off);
  const entryCount = buf.readUInt32BE(stts.off + 4);
  const delta = buf.readUInt32BE(stts.off + 12); // 第一个 sample_delta
  console.log('stts entryCount:', entryCount, 'sample_delta:', delta);
}
await browser.close();
