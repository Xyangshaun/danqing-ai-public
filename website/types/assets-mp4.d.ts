/**
 * 媒体资源类型声明
 * 让 TypeScript 识别 import 的视频文件,返回资源 URL 字符串。
 * Next.js webpack 会将 *.mp4 作为打包资源处理(内容哈希命名)。
 */
declare module '*.mp4' {
  const src: string;
  export default src;
}

declare module '*.webm' {
  const src: string;
  export default src;
}

declare module '*.ogg' {
  const src: string;
  export default src;
}