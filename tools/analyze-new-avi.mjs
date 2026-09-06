// 分析用户重新导出的透明 AVI:分段结构 + 帧内容 + 残影检测
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const AVI = 'K:\\下载\\animation_transparent.avi';
const TMP = 'I:/Delta Force custom animation/tools/.new';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

if (!fs.existsSync(AVI)) { console.log('文件不存在:', AVI); process.exit(1); }
const stat = fs.fstatSync(fs.openSync(AVI, 'r'));
console.log('文件:', AVI, (stat.size / 1073741824).toFixed(2), 'GB');

// 1) RIFF 结构
const fd = fs.openSync(AVI, 'r');
const head = Buffer.alloc(4096);
fs.readSync(fd, head, 0, 4096, 0);
const riff0 = head.readUInt32LE(4);
const hdrl = head.readUInt32LE(16);
const movi0Pos = 12 + 8 + hdrl;
const movi0Size = head.readUInt32LE(movi0Pos + 4);
console.log('RIFF0 size:', riff0, riff0 < 4294967295 ? '(未溢出)' : '(溢出!)');
console.log('hdrl:', hdrl, '| movi0 @', movi0Pos, 'size:', movi0Size);

// 扫描段结构
let pos = movi0Pos + 12 + movi0Size;
const ch = Buffer.alloc(8);
let segments = 1;
let idx1Found = false;
let idx1Entries = 0;
while (pos + 12 < stat.size && segments < 20) {
  fs.readSync(fd, ch, 0, 8, pos);
  const id = ch.toString('latin1', 0, 4);
  if (id === 'RIFF') {
    const form = Buffer.alloc(4);
    fs.readSync(fd, form, 0, 4, pos + 8);
    if (form.toString('latin1') === 'AVIX') segments++;
    else break;
    pos += 8 + ch.readUInt32LE(4);
  } else if (id === 'idx1') {
    idx1Found = true;
    idx1Entries = ch.readUInt32LE(4) / 16;
    break;
  } else {
    console.log('意外块 @', pos, id);
    break;
  }
}
fs.closeSync(fd);
console.log('AVIX 段数:', segments, '| idx1 找到:', idx1Found, '| idx1 条目:', idx1Entries);

// 2) ffprobe
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', AVI], { encoding: 'utf8' });
const nb = probe.match(/nb_frames=(\d+)/);
const dur = probe.match(/duration=([\d.]+)/);
console.log('ffprobe: nb_frames =', nb ? nb[1] : 'N/A', '| duration =', dur ? dur[1] : 'N/A');

// 3) 解码帧 304,检查序列区域(残影检测)
for (const f of [0, 304, 608]) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', AVI, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + `/f${f}.raw`], { timeout: 120000 });
  const frame = fs.readFileSync(TMP + `/f${f}.raw`);
  // 序列区域统计
  let aMid = 0, a255 = 0, a0 = 0;
  for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
    const i = (y * 1920 + x) * 4;
    const a = frame[i + 3];
    if (a === 0) a0++;
    else if (a === 255) a255++;
    else aMid++;
  }
  const n = 66 * 76;
  console.log(`帧 ${f} 序列区域: 透明 ${((a0 / n) * 100).toFixed(1)}% | 半透明 ${((aMid / n) * 100).toFixed(1)}% | 不透明 ${((a255 / n) * 100).toFixed(1)}%`);
}

// 4) 帧 304 序列区域 vs ccreptitle_00304(反预乘对比)
{
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'I:/Delta Force custom animation/animation/ccreptile/ccreptitle_00304.png', '-f', 'rawvideo', '-pix_fmt', 'rgba', TMP + '/seq.raw']);
  const seq = fs.readFileSync(TMP + '/seq.raw');
  const frame = fs.readFileSync(TMP + '/f304.raw');
  let seqPx = 0, matched = 0;
  for (let y = 382; y < 458; y++) for (let x = 227; x < 293; x++) {
    const i = (y * 1920 + x) * 4;
    if (seq[i + 3] > 8) {
      seqPx++;
      const a = frame[i + 3];
      if (a > 8) {
        const r = Math.min(255, Math.round((frame[i] * 255) / a));
        const g = Math.min(255, Math.round((frame[i + 1] * 255) / a));
        const b = Math.min(255, Math.round((frame[i + 2] * 255) / a));
        const diff = Math.abs(r - seq[i]) + Math.abs(g - seq[i + 1]) + Math.abs(b - seq[i + 2]);
        if (diff < 80) matched++;
      }
    }
  }
  console.log(`帧 304 序列区域 vs 素材: ${matched}/${seqPx} (${seqPx ? ((matched / seqPx) * 100).toFixed(1) : 0}%) ${seqPx && matched / seqPx > 0.8 ? '✓ 内容正确无残影' : '✗ 内容异常!'}`);
}
