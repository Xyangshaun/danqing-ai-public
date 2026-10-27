import React from 'react';

type InkDecorationProps = {
  variant?: 'splash' | 'stroke' | 'mist' | 'seal';
  className?: string;
  /** 主色调 */
  color?: 'ink' | 'cinnabar' | 'stone' | 'gold';
  /** 不透明度 */
  opacity?: number;
};

const colorMap = {
  ink: '#1a1a1a',
  cinnabar: '#c8392e',
  stone: '#2e5c6e',
  gold: '#c9a961',
};

/**
 * 水墨装饰组件
 * 使用 SVG 滤镜(feTurbulence + feDisplacementMap + feGaussianBlur)
 * 模拟墨迹晕染、笔触、雾气效果,作为页面背景氛围
 * 替代外部图片,矢量、轻量、高性能
 */
export function InkDecoration({
  variant = 'splash',
  className = '',
  color = 'ink',
  opacity = 1,
}: InkDecorationProps) {
  const fill = colorMap[color];
  const filterId = `ink-filter-${variant}-${color}`;

  return (
    <svg
      className={`pointer-events-none absolute ${className}`}
      style={{ opacity }}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* 水墨晕染滤镜:噪点 + 位移 + 模糊 */}
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.018"
            numOctaves="3"
            seed={variant === 'splash' ? 7 : variant === 'stroke' ? 12 : 3}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={variant === 'mist' ? 40 : 24}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feGaussianBlur stdDeviation={variant === 'mist' ? 8 : variant === 'stroke' ? 2 : 4} />
        </filter>
      </defs>

      {variant === 'splash' && (
        <g filter={`url(#${filterId})`}>
          {/* 主墨团 */}
          <ellipse cx="50%" cy="45%" rx="32%" ry="28%" fill={fill} />
          {/* 飞溅小墨点 */}
          <circle cx="22%" cy="30%" r="3%" fill={fill} opacity="0.6" />
          <circle cx="78%" cy="62%" r="2%" fill={fill} opacity="0.5" />
          <circle cx="68%" cy="22%" r="1.5%" fill={fill} opacity="0.4" />
        </g>
      )}

      {variant === 'stroke' && (
        <g filter={`url(#${filterId})`}>
          {/* 笔触:从粗到细的路径 */}
          <path
            d="M 5% 50% Q 30% 30%, 50% 50% T 95% 45%"
            stroke={fill}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 10% 70% Q 40% 55%, 70% 68% T 92% 65%"
            stroke={fill}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            opacity="0.5"
          />
        </g>
      )}

      {variant === 'mist' && (
        <g filter={`url(#${filterId})`}>
          <ellipse cx="30%" cy="40%" rx="40%" ry="35%" fill={fill} opacity="0.5" />
          <ellipse cx="70%" cy="60%" rx="35%" ry="30%" fill={fill} opacity="0.4" />
        </g>
      )}

      {variant === 'seal' && (
        <g>
          {/* 印章形态:方章 + 印泥不均匀 */}
          <rect
            x="35%"
            y="35%"
            width="30%"
            height="30%"
            rx="1"
            fill={fill}
            filter={`url(#${filterId})`}
            opacity="0.9"
          />
        </g>
      )}
    </svg>
  );
}

/**
 * 纸纹理叠加层(极淡,用于增加质感)
 */
export function PaperTexture({ className = '' }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className}`}
      aria-hidden="true"
      style={{
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.5%22/></svg>")',
        opacity: 0.04,
        mixBlendMode: 'multiply',
      }}
    />
  );
}
