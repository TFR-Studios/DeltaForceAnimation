// 构造简化版 AVIX(主 RIFF + AVIX 段,无 odml 索引),ffprobe 验证能否读全
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'I:/Delta Force custom animation/tools/.avix-test.avi';
const W = 1920, H = 1080;
const FRAME_BYTES = W * H * 4;
const SEGMENT_FRAMES = 100; // 每段 100 帧 ≈ 830MB
const TOTAL_FRAMES = 200;

function ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }

// 合成帧:纯色(红色渐变,便于验证)
function makeFrame(i) {
  const f = new Uint8Array(FRAME_BYTES);
  const color = (i * 7) % 255;
  for (let p = 0; p < FRAME_BYTES; p += 4) {
    f[p] = color; f[p + 1] = 0; f[p + 2] = 0; f[p + 3] = 255; // BGRA
  }
  return f;
}

// hdrl: 'hdrl' + avih + strl LIST(与 buildAvi 一致的大小语义)
const avih = new Uint8Array(56);
const d = new DataView(avih.buffer);
d.setUint32(0, Math.round(1e6 / 60), true);
d.setUint32(12, 0x10, true);
d.setUint32(16, TOTAL_FRAMES, true);
d.setUint32(24, 1, true);
d.setUint32(32, W, true);
d.setUint32(36, H, true);
const strh = new Uint8Array(56);
const ds = new DataView(strh.buffer);
strh.set(ascii('vids'), 0);
strh.set(ascii('DIB '), 4);
ds.setUint32(20, 1, true);
ds.setUint32(24, 60, true);
ds.setUint32(32, TOTAL_FRAMES, true);
ds.setUint32(40, 0xffffffff, true);
ds.setUint32(44, FRAME_BYTES, true);
const strf = new Uint8Array(40);
const df = new DataView(strf.buffer);
df.setUint32(0, 40, true);
df.setInt32(4, W, true);
df.setInt32(8, H, true);
df.setUint16(12, 1, true);
df.setUint16(14, 32, true);
df.setUint32(16, 0, true);
df.setUint32(20, FRAME_BYTES, true);
// strl LIST 内容 = 'strl'(4) + strh chunk(8+56) + strf chunk(8+40)
const strlBody = [ascii('strl'), ascii('strh'), u32(56), strh, ascii('strf'), u32(40), strf];
const strlBodyBuf = Buffer.concat(strlBody.map((p) => Buffer.from(p)));
// hdrl 内容 = 'hdrl'(4) + avih chunk(8+56) + strl LIST(8 + strlBodyBuf)
const hdrlBody = [ascii('hdrl'), ascii('avih'), u32(56), avih, ascii('LIST'), u32(strlBodyBuf.length), strlBodyBuf];
const hdrlBodyBuf = Buffer.concat(hdrlBody.map((p) => Buffer.from(p)));

const writeChunk = (parts, id, data) => {
  parts.push(ascii(id), u32(data.length), data);
};
const writeList = (parts, fourcc, contentParts) => {
  const content = Buffer.concat(contentParts.map((p) => Buffer.from(p)));
  parts.push(ascii('LIST'), u32(content.length), ascii(fourcc), content);
};

const out = [];
// 主 RIFF: AVI + hdrl + movi(段1) + idx1
const mainParts = [];
mainParts.push(ascii('AVI '));
mainParts.push(ascii('LIST'), u32(hdrlBodyBuf.length), hdrlBodyBuf);
// 段1 movi: 100 帧
const seg1Frames = [];
for (let i = 0; i < SEGMENT_FRAMES; i++) seg1Frames.push(makeFrame(i));
const movi1Parts = [ascii('movi')];
for (const f of seg1Frames) writeChunk(movi1Parts, '00db', f);
const movi1Content = Buffer.concat(movi1Parts.map((p) => Buffer.from(p)));
mainParts.push(ascii('LIST'), u32(movi1Content.length), movi1Content);
// idx1(段1)
const idx1Parts = [];
const idx1Body = [];
let moff = 4;
for (let i = 0; i < SEGMENT_FRAMES; i++) {
  const entry = new Uint8Array(16);
  const d = new DataView(entry.buffer);
  entry.set(ascii('00db'), 0);
  d.setUint32(4, 0x10, true);
  d.setUint32(8, moff + 4, true);
  d.setUint32(12, FRAME_BYTES, true);
  idx1Body.push(entry);
  moff += 8 + FRAME_BYTES;
}
idx1Parts.push(ascii('idx1'), u32(SEGMENT_FRAMES * 16), ...idx1Body);
const mainContent = Buffer.concat(mainParts.map((p) => Buffer.from(p)));
const mainRiffSize = mainContent.length - 4; // RIFF size = 内容 - 'AVI '(4)
out.push(ascii('RIFF'), u32(mainRiffSize), mainContent);

// AVIX 段: 100 帧
const seg2Frames = [];
for (let i = SEGMENT_FRAMES; i < TOTAL_FRAMES; i++) seg2Frames.push(makeFrame(i));
const movi2Parts = [ascii('movi')];
for (const f of seg2Frames) writeChunk(movi2Parts, '00db', f);
const movi2Content = Buffer.concat(movi2Parts.map((p) => Buffer.from(p)));
const avixParts = [ascii('LIST'), u32(movi2Content.length), movi2Content];
const avixContent = Buffer.concat(avixParts.map((p) => Buffer.from(p)));
const avixRiffSize = avixContent.length - 4; // - 'AVIX'
out.push(ascii('RIFF'), u32(avixRiffSize), ascii('AVIX'), avixContent);

const total = out.reduce((s, p) => s + p.length, 0);
const file = new Uint8Array(total);
let pos = 0;
for (const p of out) { file.set(p, pos); pos += p.length; }
fs.writeFileSync(OUT, file);
console.log('AVIX 测试文件:', OUT, (file.length / 1073741824).toFixed(2), 'GB');

// ffprobe 验证
try {
  const out2 = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', OUT], { encoding: 'utf8' });
  const frames = out2.match(/nb_frames=(\d+)/);
  const dur = out2.match(/duration=([\d.]+)/);
  console.log('ffprobe: nb_frames =', frames ? frames[1] : 'N/A', '| duration =', dur ? dur[1] : 'N/A');
  console.log(frames && parseInt(frames[1]) === TOTAL_FRAMES ? '✓ 全部帧可读!' : '✗ 帧数不完整!');
} catch (e) {
  console.log('ffprobe 失败:', String(e).slice(0, 300));
}
