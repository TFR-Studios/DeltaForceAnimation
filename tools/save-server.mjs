// 本地接收服务器:接收浏览器 POST 的大文件并落盘
import http from 'node:http';
import fs from 'node:fs';

const OUT = process.argv[2] || 'I:/Delta Force custom animation/tools/.real-export.avi';
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.method === 'POST' && req.url === '/save') {
    const ws = fs.createWriteStream(OUT);
    let received = 0;
    req.on('data', (c) => { received += c.length; });
    req.pipe(ws);
    req.on('end', () => {
      ws.end(() => {
        console.log('SAVED', OUT, fs.statSync(OUT).size);
        res.end('ok');
        server.close();
      });
    });
    req.on('error', (e) => { console.log('req error', e.message); res.end('err'); server.close(); });
    ws.on('error', (e) => { console.log('ws error', e.message); server.close(); });
    setInterval(() => console.log('received so far:', (received / 1073741824).toFixed(2), 'GB'), 30000).unref();
  } else {
    res.end('ping');
  }
});
server.listen(9999, '127.0.0.1', () => console.log('save server on 9999 ->', OUT));
