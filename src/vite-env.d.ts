/* Vite 资源与导入后缀的类型声明。这个文件没有顶层 import / export,所以是「全局脚本」而不是模块,
 * 里面的 declare module 对所有源码文件生效。
 * 坑:一旦给它加上顶层 import,整个文件会变成模块,下面两条通配声明立刻失效,
 * 带 ?raw / ?url 的导入会在类型检查时报错。 */
/// <reference types="vite/client" />

/* ?raw:把文件内容当字符串导入(而不是解析成 JSON 对象),适用于需要内联文本的场景。
 * 本项目当前是配套保留:vite/client 自带的宽泛 ?raw 声明也能匹配,这里显式写成 *.json?raw 只为把意图写清楚;
 * 两条声明的默认导出都是 string,不会冲突。 */
declare module '*.json?raw' {
  const content: string;
  export default content;
}

/* ?url:导入静态资源地址(默认导出字符串),音效走这条路,交给 Audio / lottie 的音频工厂加载,
 * 且不会被打进首屏 JS。
 * 这里只写了 .mp3;main.ts 里还有一处 .wav 的 ?url 导入,由 vite/client 的通用 ?url 声明兜底。
 * 字体刻意不走这条路径:Vite 7 的 dev server 对字体的 ?url 请求返回的是 JS 模块而不是字体字节,
 * 所以 main.ts 改用 new URL(字面量, import.meta.url),原因见那里的 FONT_* 注释。 */
declare module '*.mp3?url' {
  const url: string;
  export default url;
}
