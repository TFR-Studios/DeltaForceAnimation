import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // 大体积动画 JSON(?raw 内嵌)拆成独立 chunk:Cloudflare Pages 单文件上限
        // 25 MiB,全部打进一个 index chunk 会超限(约 27.3 MiB)。
        manualChunks(id: string) {
          const q = id.split('?')[0].replace(/\\/g, '/');
          if (q.endsWith('animation/animation_data.json') || q.includes('windows animation/windows_animation.json')) return 'data-extraction';
          if (q.includes('/animation_2/') && /[\/]animation_data.*\.json$/.test(q)) return 'data-exposed';
          return undefined;
        },
      },
    },
  },
  plugins: [
    {
      name: 'save-avi-dev-hook',
      configureServer(server) {
        server.middlewares.use('/save-avi', (req, res) => {
          const out = path.join(__dirname, 'tools', 'user-export.avi');
          const ws = fs.createWriteStream(out);
          req.pipe(ws);
          req.on('end', () => { res.end('ok'); });
          req.on('error', () => { res.end('err'); });
          ws.on('error', () => { res.end('err'); });
        });
      },
    },
  ],
});
