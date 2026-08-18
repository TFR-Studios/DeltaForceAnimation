import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(1000);
const data = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/animation/animation_data.json','utf8'));
const audioAsset = data.assets.find(a => typeof a.p === 'string' && a.p.startsWith('data:audio'));
const audioUrl = audioAsset ? audioAsset.p : null;
const res = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url);
    const buf = await r.arrayBuffer();
    const ac = new AudioContext();
    const ab = await ac.decodeAudioData(buf.slice(0));
    const ch = ab.numberOfChannels;
    const rate = ab.sampleRate;
    const dur = ab.duration;
    ac.close();
    return { ok: true, channels: ch, sampleRate: rate, duration: dur.toFixed(2) };
  } catch (e) { return { ok: false, error: e.message }; }
}, audioUrl);
console.log('音频解码:', JSON.stringify(res));
await browser.close();
