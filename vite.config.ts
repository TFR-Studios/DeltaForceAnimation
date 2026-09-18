/* Vite 配置(唯一构建入口,package.json 的 dev / build / preview 都走这里)。三块内容:
 *  1) server.port:固定开发端口;
 *  2) build.rollupOptions.output.manualChunks:把三套大体积动画 JSON 拆成独立 chunk,
 *     否则全部打进主 chunk 会超过 Cloudflare Pages 单文件 25 MiB 的上限;
 *  3) plugins:只有一个开发专用中间件(/save-avi),只在 dev 下生效,不进产物。
 * 产物是纯静态站点(outDir、base 均沿用 Vite 默认值),可直接托管。 */
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/* 开发服务器端口固定 5173(而不是让 Vite 顺延到 5174/5175):
 * 预览与导出依赖 WebCodecs、File System Access 等能力,需要用 Chrome / Edge 打开,
 * 固定端口便于书签、脚本与本地校验工具复用同一地址。 */
export default defineConfig({
  server: { port: 5173 },
  /* 构建配置:纯静态产物,除分包外没有特殊处理。
   * 注意 src/main.ts 里音频与动画 JSON 都走 ?url 以静态资源形式输出(按需下载),
   * 若把 assetsInlineLimit 调大到能覆盖它们,数据会被内联回 JS,分包与按需下载就一起失效了。 */
  build: {
    rollupOptions: {
      output: {
        // 动画 JSON 的「URL 模块」按动画手工拆成独立 chunk(data-extraction / data-exposed)。
        // 历史背景:这些 JSON 最初用 ?raw 内联进 JS,全部打进主 chunk 会超过 Cloudflare Pages
        // 单文件 25 MiB 上限(约 27.3 MiB),于是按动画分包;改成 ?url 按需下载后 JSON 本身已是
        // 独立静态资源,这里保留分包是为让三份 URL 模块互不牵连,产物结构也更清晰。
        /* 规则按顺序判断,返回 chunk 名即把该模块归入该 chunk,返回 undefined 表示沿用默认分包。
         * id 先去掉 ?url / ?raw 之类的查询串并统一成 '/' 分隔:否则 Windows 下的反斜杠路径与带查询串的 id 会匹配不上,
         * 分包静默失效,构建又会撞回 25 MiB 上限。
         * 三个分支分别是:撤离(animation/animation_data.json 与 windows animation/windows_animation.json)、
         * 位置暴露(animation_2/ 下的 animation_data*.json)。 */
        manualChunks(id: string) {
          const q = id.split('?')[0].replace(/\\/g, '/');
          if (q.endsWith('animation/animation_data.json') || q.includes('windows animation/windows_animation.json')) return 'data-extraction';
          if (q.includes('/animation_2/') && /[\/]animation_data.*\.json$/.test(q)) return 'data-exposed';
          return undefined;
        },
      },
    },
  },
  /* 插件列表:目前只有一个开发用中间件。它没有 build 钩子,生产构建不会包含 /save-avi。
   * 用途:浏览器无法直接把导出的字节流落盘到项目目录,main.ts 的 downloadBlob 在 dev 下会额外
   * POST 一份到 /save-avi,由这里写进 tools/user-export.avi,方便用播放器或工具分析真实的导出结构。 */
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
