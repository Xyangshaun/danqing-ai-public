import { memo, useState } from 'react';
import logoSeal from '../assets/logo-seal.png';

/**
 * LogoMark — "丹青"朱文印(真印章素材版)
 *
 * ── 设计说明 ──
 * 图标:决赛定稿的"丹青"朱文印(篆刻白字红底),透明底 PNG,
 *      经洪泛去底处理,在宣纸底/墨色顶栏上均无白色边缘。
 *      通过 Vite import 引入,自动携带 base('/app/')前缀与内容指纹。
 * 动效:保留原悬停光晕 + 轻微放大,与旧版 DQ 印章一致。
 * 文字:右侧品牌文字标识不变。
 * 历史:旧版为代码绘制的 DQ 字母印(svg),可用 git 历史找回。
 */
function LogoMark() {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-2.5 group flex-shrink-0 select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label="DQ AI 丹青智能创作"
      translate="no"
    >
      <div className="relative w-8 h-8" aria-hidden="true">
        {/* 悬停光晕 */}
        <div
          className={`absolute inset-0 rounded-lg bg-cinnabar/25 blur-md transition-opacity duration-300 ease-out ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <img
          src={logoSeal}
          alt=""
          draggable={false}
          className="relative w-8 h-8 object-contain transition-transform duration-300 ease-out will-change-transform"
          style={{ transform: isHovered ? 'scale(1.08)' : 'scale(1)' }}
        />
      </div>

      {/* === 文字标识 === */}
      <div className="hidden md:block min-w-0">
        <div
          className="font-serif text-base font-bold leading-none tracking-wide flex items-baseline"
          style={{
            transition: 'transform 0.2s ease-out',
            transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
          }}
        >
          <span className="text-ink-900">DQ</span>
          <span className="text-cinnabar ml-0.5 font-sans font-semibold text-sm">AI</span>
        </div>
        <p className="text-2xs text-ink-400 mt-0.5 leading-none tracking-widest">
          丹青智能创作
        </p>
      </div>
    </div>
  );
}

/**
 * React.memo 包裹:LogoMark 无 props,父组件(如 Header)重渲染时跳过。
 * 内部 hover 状态变化仍正常触发自身重渲染。
 */
export default memo(LogoMark);
