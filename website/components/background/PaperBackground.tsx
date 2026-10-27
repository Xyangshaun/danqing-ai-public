/**
 * PaperBackground · 画纸纹理背景层(2.5D 远景)
 *
 * 7 层叠加,从下到上:
 *  1. paper-base      基础米黄 + 横/纵纤维(模拟宣纸帘纹)
 *  2. paper-noise     SVG feTurbulence 噪点(微观颗粒)
 *  3. paper-wash-tl   左上石青晕染(冷色压角)
 *  4. paper-wash-br   右下暖金晕染(暖色引导)
 *  5. paper-vignette-top  顶部 vignette,过渡到固定导航
 *  6. paper-vignette-bot  底部 vignette,自然淡出
 *  7. inline SVG 水波线 极淡装饰(中线,可选)
 *
 * 性能:
 *  - 全部用 CSS background-image / SVG,无 JS、无 Canvas
 *  - fixed 定位 + background-attachment 等效,scroll 时不重绘
 *  - 噪点 SVG 220px 重复,2 octaves,fractalNoise,单 tile ~0.6KB
 *  - pointer-events: none,不影响交互
 *  - aria-hidden,SR 跳过
 *
 * 角色:
 *  - z-index: -1,永远在最底层
 *  - 任何 .ink-card / .tilt-card 在此背景之上"悬浮"
 *  - 卡片自身 translateY + 接触阴影 + 微弱 rotateX,共同构成 2.5D 景深
 */
export function PaperBackground() {
  return (
    <div
      aria-hidden="true"
      data-paper-bg
      className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden"
    >
      {/* 1. 基础米黄 + 纤维帘纹 */}
      <div className="absolute inset-0 paper-base" />
      {/* 2. SVG 噪点(微观颗粒) */}
      <div className="absolute inset-0 paper-noise" />
      {/* 3. 左上石青晕染 */}
      <div className="absolute inset-0 paper-wash-tl" />
      {/* 4. 右下暖金晕染 */}
      <div className="absolute inset-0 paper-wash-br" />
      {/* 5. 顶部 vignette — 全视口径向,自然无硬边 */}
      <div className="absolute inset-0 paper-vignette-top" />
      {/* 6. 底部 vignette — 全视口径向,自然无硬边 */}
      <div className="absolute inset-0 paper-vignette-bot" />
      {/* 7. 极淡中线水波(装饰) */}
      <div className="absolute inset-0 paper-wash-mid opacity-50" />
    </div>
  );
}
