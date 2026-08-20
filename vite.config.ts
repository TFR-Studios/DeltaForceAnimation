import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  server: { port: 5173 },
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
