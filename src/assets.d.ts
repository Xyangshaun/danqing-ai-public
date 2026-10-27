// 静态图片资源模块声明(应用未启用 vite/client 类型)
declare module '*.png' {
  const src: string;
  export default src;
}
