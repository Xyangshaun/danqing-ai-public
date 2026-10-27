import React from 'react';
import { Breadcrumb } from './Breadcrumb';
import { InkDecoration } from './InkDecoration';

type PageHeaderProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb: { name: string; href: string }[];
};

/**
 * 内页通用页头 · 中式升级版
 *
 * 设计骨架(自上而下):
 *  1. 顶部:面包屑 + eyebrow(细线引导)
 *  2. 中部:大标题 + 描述
 *  3. 装饰层:
 *    - 右侧:大幅水墨晕染(stone 冷色)主导视觉
 *    - 左下:暖金晕染(gold)收尾
 *    - 顶部正中:金线题跋(从中心扩展,呼应手卷题跋)
 *    - 左上:朱砂方印(seal variant)
 *    - 底部:细金线分隔
 *  4. 极淡:纸纹理 + 网格底纹,避免大色块抢戏
 *
 * 顶部留白避开固定导航(由 main 的 pt 提供)
 */
export function PageHeader({ eyebrow, title, description, breadcrumb }: PageHeaderProps) {
  return (
    <section className="relative overflow-hidden border-b border-ink-100/40 bg-paper-100 pb-20 pt-12 md:pb-24 md:pt-16">
      {/* ===== 背景叠层(从远到近) ===== */}

      {/* 1. 纸纹理叠加(极淡,宣纸颗粒) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22120%22 height=%22120%22 filter=%22url(%23n%22 opacity=%220.5%22/></svg>")',
        }}
        aria-hidden="true"
      />

      {/* 2. 极淡网格底纹(中式书页感) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(26,26,26,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(26,26,26,0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 80%)',
        }}
        aria-hidden="true"
      />

      {/* 3. 主墨晕染:右上(石青,冷色压角) */}
      <InkDecoration
        variant="splash"
        color="stone"
        opacity={0.16}
        className="right-[-8%] top-[-10%] h-[60%] w-[55%]"
      />

      {/* 4. 次晕染:左下(暖金,引导视线) */}
      <InkDecoration
        variant="mist"
        color="gold"
        opacity={0.12}
        className="bottom-[-12%] left-[-6%] h-[55%] w-[40%]"
      />

      {/* 5. 远景飞溅:左上小墨点 */}
      <InkDecoration
        variant="splash"
        color="ink"
        opacity={0.08}
        className="left-[8%] top-[15%] h-[28%] w-[20%]"
      />

      {/* 6. 顶部金线题跋(从中心向两侧扩展,呼应手卷题跋) */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-px w-[60%] -translate-x-1/2 origin-center">
        <div
          className="h-full w-full animate-inscription-draw"
          style={{
            background:
              'linear-gradient(to right, transparent 0%, rgba(201,169,97,0.0) 5%, rgba(201,169,97,0.7) 50%, rgba(201,169,97,0.0) 95%, transparent 100%)',
          }}
          aria-hidden="true"
        />
      </div>

      {/* 7. 左上朱砂方印 */}
      <div className="pointer-events-none absolute left-6 top-6 hidden md:left-10 md:top-10 md:block">
        <InkDecoration variant="seal" color="cinnabar" opacity={0.85} className="h-10 w-10" />
        <span
          className="absolute inset-0 flex items-center justify-center font-serif text-[10px] font-semibold tracking-tight text-paper-50"
          aria-hidden="true"
        >
          丹青
        </span>
      </div>

      {/* 8. 底部金线分隔 */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            'linear-gradient(to right, transparent 0%, rgba(201,169,97,0.4) 30%, rgba(201,169,97,0.4) 70%, transparent 100%)',
        }}
        aria-hidden="true"
      />

      {/* ===== 内容 ===== */}
      <div className="container-content relative">
        <Breadcrumb items={breadcrumb} />

        {eyebrow && <span className="section-eyebrow mt-8">{eyebrow}</span>}

        {/* 标题区:相对定位,左侧预留朱砂印的视觉权重 */}
        <div className="mt-4 max-w-3xl md:ml-20 lg:ml-24">
          <h1 className="text-display-lg font-semibold leading-tight text-ink-900">
            {title}
          </h1>
          {description && (
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-500 md:text-lg">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* 题跋线展开 keyframes(全局复用,如未定义则不报错) */}
      <style>{`
        @keyframes inscription-draw {
          from { transform: scaleX(0); opacity: 0; }
          to   { transform: scaleX(1); opacity: 1; }
        }
        .animate-inscription-draw {
          animation: inscription-draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
          transform-origin: center center;
        }
      `}</style>
    </section>
  );
}
