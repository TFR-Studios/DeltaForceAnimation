# 三角洲行动撤离动画自定义编辑器(Bodymovin / Lottie JSON)

针对《三角洲行动》撤离动画(After Effects + Bodymovin 导出 JSON)的网页编辑器,支持文字/颜色编辑、实时预览,以及带背景颜色的视频导出。

**`animation_data.json` 已打包进网站**,打开页面即可直接编辑该动画,无需服务器接口。音频使用 `animation/` 目录下的 `gunmuchenggong.mp3`(同样打包进网站),不再使用 JSON 内嵌音频。

## 运行

```bash
npm install
npm run dev
```

然后打开 http://localhost:5173

- 页面启动后自动载入打包的 `animation_data.json`;
- 预览支持:播放/暂停(空格键)、重播、循环、速度 0.1–3 倍、SVG/Canvas 渲染器切换、背景色/透明、适配方式(包含/铺满/原始);
- 编辑支持:文字图层的内容与颜色、形状图层的填充/描边颜色,均可实时修改并一键重置。

## 视频导出(60fps,含音频)

导出会携带背景颜色,规则如下:

- **勾选「透明背景」** → 自动导出 **AVI**(MP4 不支持透明,此时格式选择框自动锁定为 AVI)。透明 AVI 使用**无压缩 32 位 BGRA** 编码,保留真正的 alpha 透明通道,可直接导入支持透明视频的剪辑软件(体积较大:1080p60 约 8MB/帧);
- **选择 MP4 / AVI(未勾选透明)** → 使用当前选择的**背景色**导出;MP4 使用 H.264 24 Mbps 码率,AVI 为 MJPEG 压缩。

## 说明

- 动画数据通过 `src/main.ts` 以 `?raw` 形式打包进构建产物(`dist/`),音频文件以 `?url` 形式一并打包,发布时只需部署静态文件即可,所有人打开网页就能编辑。
- 更换动画:替换 `animation/animation_data.json` 后重新 `npm run build` 即可。
- 更换音频:替换 `animation/gunmuchenggong.mp3`(保持文件名),或在 `src/main.ts` 中修改音频导入。
- 字体:若 JSON 通过 `fonts.list[].fPath` 内嵌了 TTF 字体文件,编辑器会自动用 FontFace API 加载并注册,两种渲染器都会使用真实字体;未内嵌字体的动画则回退到系统字体。
- Canvas 渲染器:本动画的 JSON 只有内嵌字体文件、没有字形轮廓数据(`chars`),lottie-web 原生 Canvas 渲染会因此崩溃。编辑器内置了兼容层:自动预加载字体 + 原生 `fillText` 文字兜底绘制(保留逐字母动画)。

## 其他命令

- `npm run build` — 类型检查 + 产物构建(`dist/`)
- `npm run preview` — 本地预览构建产物(动画数据已打包,与线上一致)

## 部署到 Cloudflare Pages

1. 将本仓库导入 Cloudflare Pages(或连接 GitHub 自动构建);
2. 构建设置:
   - **构建命令**:`npm run build`
   - **输出目录**:`dist`
   - **Node.js 版本**:22(仓库内已提供 `.nvmrc`)
3. 部署后打开站点即可编辑与导出,无需任何后端服务。
