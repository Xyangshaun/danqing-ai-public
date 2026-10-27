import React from 'react';
import Link from 'next/link';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';

type Feature = {
  no: string;
  title: string;
  subtitle: string;
  desc: string;
  points: string[];
  accent: 'cinnabar' | 'stone' | 'gold';
  visual: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    no: '一',
    title: '构图分析',
    subtitle: '画面的骨架',
    desc: '从黄金分割到视觉重量,AI 识别画面的视觉重心、动势线与平衡关系,判断构图类型并标注问题所在。',
    points: ['视觉重心定位', '动势线提取', '平衡度量化评估', '构图类型识别'],
    accent: 'cinnabar',
    visual: <CompositionVisual />,
  },
  {
    no: '二',
    title: '色彩分析',
    subtitle: '画面的血肉',
    desc: '解析主色调、色彩关系、明暗五调子与冷暖对比,生成色彩分布热力图,指出协调与冲突之处。',
    points: ['主色调提取', '色彩关系图谱', '明暗五调子检测', '冷暖对比分析'],
    accent: 'stone',
    visual: <ColorVisual />,
  },
  {
    no: '三',
    title: '笔触分析',
    subtitle: '画面的肌理',
    desc: '识别笔触轨迹、粗细变化、密度与韵律,判断用笔的骨力与节奏,区分习作与成熟作品的笔法差异。',
    points: ['笔触轨迹追踪', '力度与速度识别', '密度分布分析', '韵律节奏评估'],
    accent: 'gold',
    visual: <BrushVisual />,
  },
];

const accentText = {
  cinnabar: 'text-cinnabar-500',
  stone: 'text-stone-500',
  gold: 'text-gold-600',
};

const accentTextGradient = {
  cinnabar: 'text-gradient-cinnabar',
  stone: 'text-stone-500',
  gold: 'text-gradient-gold',
};

const accentBgSoft = {
  cinnabar: 'bg-cinnabar-50/50',
  stone: 'bg-stone-50/50',
  gold: 'bg-gold-50/50',
};

const accentBar = {
  cinnabar: 'bg-cinnabar-500',
  stone: 'bg-stone-500',
  gold: 'bg-gold-500',
};

/**
 * 功能展示:三大分析维度
 * 左右交错布局,每维度配 SVG 视觉示意
 * 视觉卡片:玻璃材质 + 渐变边框光 + 内高光
 */
export function FeatureShowcase() {
  return (
    <Section spacing="lg" background="muted" id="features">
      <SectionHeader
        eyebrow="功能展示"
        subtitleEn="AI Diagnosis"
        title={<>三大分析维度,深度理解每一张作业</>}
        description="构图、色彩、笔触——画面的骨架、血肉与肌理。丹青有AI 以专业美院教学标准,逐一拆解。"
      />

      <div className="mt-20 space-y-24 md:space-y-32">
        {FEATURES.map((feature, i) => {
          const reversed = i % 2 === 1;
          return (
            <RevealOnScroll key={feature.title} variant="ink">
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
                {/* 文字 */}
                <div className={reversed ? 'md:order-2' : ''}>
                  <div className="flex items-baseline gap-4">
                    <span className={`font-serif text-6xl font-semibold ${accentTextGradient[feature.accent]} opacity-80`}>
                      {feature.no}
                    </span>
                    <div>
                      <span className="block text-xs tracking-[0.2em] uppercase text-ink-400">
                        {feature.subtitle}
                      </span>
                      <h3 className="mt-1 text-3xl font-semibold text-ink-900">{feature.title}</h3>
                    </div>
                  </div>
                  <p className="mt-6 text-base leading-relaxed text-ink-500 md:text-lg">
                    {feature.desc}
                  </p>
                  <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2.5">
                    {feature.points.map((point) => (
                      <li key={point} className="flex items-center gap-2 text-sm text-ink-600">
                        <span className={`inline-block h-1 w-1 rounded-full bg-current ${accentText[feature.accent]}`} />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* 视觉:玻璃卡片 + 渐变边框光 + AI 数据叠加层 */}
                <div className={reversed ? 'md:order-1' : ''}>
                  <div className="group relative aspect-[4/3]">
                    {/* 外发光层 */}
                    <div
                      className={`absolute -inset-1 rounded-lg ${accentBgSoft[feature.accent]} opacity-0 blur-xl transition-opacity duration-700 ease-ink group-hover:opacity-100`}
                      aria-hidden="true"
                    />
                    {/* 主卡片 */}
                    <div className="ink-card relative h-full overflow-hidden p-6">
                      {/* 编号进度指示(借鉴 Affinity 功能轮播的 1/6 序号,强化专业工具序列感) */}
                      <div className="absolute right-5 top-5 z-10 flex items-center gap-2" aria-hidden="true">
                        <span className="font-serif text-xs font-semibold tracking-[0.15em] text-ink-400">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="relative h-px w-10 bg-ink-200">
                          <span
                            className={`absolute inset-y-0 left-0 ${accentBar[feature.accent]}`}
                            style={{ width: `${((i + 1) / FEATURES.length) * 100}%` }}
                          />
                        </span>
                        <span className="text-xs text-ink-300">{String(FEATURES.length).padStart(2, '0')}</span>
                      </div>
                      {feature.visual}
                      {/* AI 数据叠加层:悬停时浮现,展示 AI 分析数据(借鉴 TTT ise 分屏"代码 vs 效果"对比) */}
                      <AIDataOverlay accent={feature.accent} featureKey={feature.title} />
                    </div>
                  </div>
                </div>
              </div>
            </RevealOnScroll>
          );
        })}
      </div>

      <div className="mt-20 text-center">
        <Link href="/product" className="btn-secondary" data-track="home-feature-learn-more">
          查看完整功能详情 →
        </Link>
      </div>
    </Section>
  );
}

/* ---------- 三维度 SVG 示意 ---------- */

function CompositionVisual() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
      {/* 背景:宣纸 */}
      <rect width="400" height="300" fill="#faf8f3" />

      {/* 模拟画作:远山 + 树(给"分析对象"提供参考背景) */}
      <g opacity="0.22">
        <path d="M 0 230 L 70 175 L 130 205 L 200 150 L 270 195 L 340 165 L 400 195 L 400 300 L 0 300 Z" fill="#1a1a1a" />
        <ellipse cx="320" cy="240" rx="35" ry="55" fill="#1a1a1a" opacity="0.6" />
        <ellipse cx="60" cy="250" rx="28" ry="48" fill="#1a1a1a" opacity="0.5" />
      </g>

      {/* 三分线:朱砂虚线 */}
      <g stroke="#c8392e" strokeWidth="0.7" opacity="0.45" strokeDasharray="4 3" fill="none">
        <line x1="133" y1="20" x2="133" y2="280" />
        <line x1="267" y1="20" x2="267" y2="280" />
        <line x1="20" y1="100" x2="380" y2="100" />
        <line x1="20" y1="200" x2="380" y2="200" />
      </g>

      {/* 黄金分割线:金色虚线 */}
      <g stroke="#c9a961" strokeWidth="0.6" opacity="0.55" fill="none" strokeDasharray="2 3">
        <line x1="148" y1="20" x2="148" y2="280" />
        <line x1="252" y1="20" x2="252" y2="280" />
        <line x1="20" y1="118" x2="380" y2="118" />
        <line x1="20" y1="182" x2="380" y2="182" />
      </g>

      {/* 黄金分割交点:小金圈 */}
      <circle cx="252" cy="118" r="5" fill="none" stroke="#c9a961" strokeWidth="1.2" />

      {/* 视觉重心:朱砂双圈 + 十字 */}
      <circle cx="267" cy="100" r="32" fill="none" stroke="#c8392e" strokeWidth="0.6" opacity="0.3" />
      <circle cx="267" cy="100" r="20" fill="none" stroke="#c8392e" strokeWidth="1.2" opacity="0.75" />
      <g stroke="#c8392e" strokeWidth="1.5">
        <line x1="263" y1="92" x2="271" y2="108" />
        <line x1="259" y1="100" x2="275" y2="100" />
      </g>

      {/* 动势线:墨黑 + 箭头 */}
      <path d="M 60 250 Q 150 200, 220 140 T 267 100" stroke="#1a1a1a" strokeWidth="1.4" fill="none" opacity="0.7" />
      <polygon points="265,95 271,103 263,103" fill="#1a1a1a" opacity="0.7" />

      {/* 引导对角线:石青 */}
      <line x1="20" y1="280" x2="380" y2="20" stroke="#2e5c6e" strokeWidth="0.5" opacity="0.25" strokeDasharray="2 4" />

      {/* 数据标签 */}
      <g fontFamily="sans-serif">
        <text x="280" y="92" fontSize="9" fill="#c8392e" fontWeight="600">视觉重心</text>
        <text x="260" y="138" fontSize="9" fill="#c9a961">黄金分割点</text>
        <text x="225" y="142" fontSize="9" fill="#1a1a1a" opacity="0.7">动势线</text>
      </g>

      {/* 底部小注 */}
      <text x="20" y="290" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif">
        黄金分割 · 视觉重心 · 动势线 · 三分法
      </text>
    </svg>
  );
}

function ColorVisual() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#faf8f3" />

      {/* 左侧:主色调提取(5 个色块 + 百分比) */}
      <g>
        <text x="20" y="32" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">主色调</text>
        {[
          { c: '#8b6f47', p: 32, y: 50 },
          { c: '#c4a87c', p: 24, y: 78 },
          { c: '#3d4a3d', p: 18, y: 106 },
          { c: '#d4c4a8', p: 14, y: 134 },
          { c: '#2a2a2a', p: 12, y: 162 },
        ].map((c, i) => (
          <g key={i}>
            <rect x="20" y={c.y - 14} width="20" height="16" fill={c.c} rx="2" />
            <rect x="45" y={c.y - 14} width={c.p * 1.3} height="16" fill={c.c} opacity="0.3" rx="2" />
            <text x={45 + c.p * 1.3 + 5} y={c.y - 2} fontSize="9" fill="#1a1a1a" fontFamily="sans-serif">{c.p}%</text>
          </g>
        ))}
      </g>

      {/* 右侧:色相环(12 色) + 主色指示线 */}
      <g transform="translate(320, 110)">
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 - 90) * Math.PI / 180;
          const x = Math.cos(angle) * 50;
          const y = Math.sin(angle) * 50;
          const hue = i * 30;
          return (
            <circle key={i} cx={x} cy={y} r="10" fill={`hsl(${hue}, 45%, 55%)`} opacity="0.9" stroke="#fff" strokeWidth="0.5" />
          );
        })}
        <circle r="14" fill="#1a1a1a" opacity="0.1" />
        <line x1="0" y1="0" x2="25" y2="-43" stroke="#c8392e" strokeWidth="1" opacity="0.7" />
        <circle cx="25" cy="-43" r="2.5" fill="#c8392e" />
      </g>

      {/* 底部:明度条 */}
      <g transform="translate(20, 215)">
        <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">明度</text>
        {['#0d0d0d', '#3a3a3a', '#6b6b6b', '#9a9a9a', '#c8c8c8', '#e8e8e8', '#f7f7f7'].map((c, i) => (
          <rect key={c} x={i * 30 + 32} y="-12" width="28" height="12" fill={c} />
        ))}
      </g>

      {/* 底部:冷暖比例 */}
      <g transform="translate(245, 215)">
        <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">冷暖</text>
        <rect x="30" y="-12" width="32" height="12" fill="#2e5c6e" rx="2" />
        <text x="42" y="-2" fontSize="9" fill="#fff" fontFamily="sans-serif">35%</text>
        <rect x="65" y="-12" width="60" height="12" fill="#c9a961" rx="2" />
        <text x="89" y="-2" fontSize="9" fill="#fff" fontFamily="sans-serif">65%</text>
      </g>

      <text x="20" y="285" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif">主色 · 色相环 · 明度 · 冷暖</text>
    </svg>
  );
}

function BrushVisual() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="brush-blur"><feGaussianBlur stdDeviation="0.4" /></filter>
      </defs>

      <rect width="400" height="300" fill="#faf8f3" />

      {/* 上半部:模拟画作 + 多层笔触 */}
      <g>
        <rect x="20" y="20" width="360" height="125" fill="#2a2520" rx="4" />

        <g filter="url(#brush-blur)" opacity="0.85">
          <path d="M 30 50 Q 100 30, 200 55 T 370 45" stroke="#c9a961" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M 30 80 Q 120 60, 220 80 T 370 70" stroke="#d4b888" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7" />
          <path d="M 30 110 Q 140 95, 240 115 T 370 105" stroke="#e0c898" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
          <path d="M 30 135 Q 150 125, 250 140 T 370 130" stroke="#f0d8a8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.5" />
        </g>

        <circle cx="120" cy="55" r="3.5" fill="#c8392e" opacity="0.9" />
        <circle cx="200" cy="80" r="2.5" fill="#c8392e" opacity="0.7" />
        <circle cx="280" cy="115" r="2" fill="#c8392e" opacity="0.5" />
      </g>

      {/* 中部:笔速折线 */}
      <g transform="translate(20, 175)">
        <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">笔速曲线</text>
        <line x1="0" y1="42" x2="360" y2="42" stroke="#6b6b6b" strokeWidth="0.5" opacity="0.4" />
        <polyline
          points="0,38 30,28 60,40 90,22 120,36 150,26 180,32 210,18 240,30 270,24 300,28 330,20 360,26"
          fill="none" stroke="#c8392e" strokeWidth="1.2" opacity="0.75"
        />
        {[
          [0, 38], [30, 28], [60, 40], [90, 22], [120, 36], [150, 26],
          [180, 32], [210, 18], [240, 30], [270, 24], [300, 28], [330, 20], [360, 26],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.5" fill="#c8392e" opacity="0.8" />
        ))}
      </g>

      {/* 底部:力度直方图 */}
      <g transform="translate(20, 260)">
        <text x="0" y="0" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">力度</text>
        {[18, 35, 25, 12, 8].map((h, i) => (
          <g key={i}>
            <rect
              x={i * 70 + 38}
              y={-h * 0.5}
              width="22"
              height={h * 0.5}
              fill={i === 1 ? '#c8392e' : '#2e5c6e'}
              opacity={i === 1 ? 0.85 : 0.55}
              rx="1"
            />
            <text x={i * 70 + 49} y="6" fontSize="8" fill="#6b6b6b" fontFamily="sans-serif" textAnchor="middle">
              {h}
            </text>
          </g>
        ))}
      </g>

      <text x="20" y="290" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif">笔触轨迹 · 笔速 · 力度 · 韵律</text>
    </svg>
  );
}


/* ---------- AI 数据叠加层(借鉴 TTT ise 分屏"代码 vs 效果"对比叙事) ---------- */

const AI_DATA: Record<string, { score: number; items: { label: string; value: string }[] }> = {
  构图分析: {
    score: 87,
    items: [
      { label: '视觉重心', value: '右上 1/3' },
      { label: '平衡度', value: '92%' },
      { label: '构图类型', value: '三分法' },
    ],
  },
  色彩分析: {
    score: 84,
    items: [
      { label: '主色调', value: '暖赭石' },
      { label: '色相关系', value: '邻近色' },
      { label: '明暗对比', value: '中强' },
    ],
  },
  笔触分析: {
    score: 91,
    items: [
      { label: '平均速度', value: '中速偏快' },
      { label: '力度分布', value: '重轻重' },
      { label: '韵律评分', value: 'A' },
    ],
  },
};

const accentAIColor = {
  cinnabar: { dot: 'bg-cinnabar-400', bar: 'bg-cinnabar-400', score: 'text-cinnabar-300' },
  stone: { dot: 'bg-stone-400', bar: 'bg-stone-400', score: 'text-stone-300' },
  gold: { dot: 'bg-gold-400', bar: 'bg-gold-400', score: 'text-gold-300' },
};

function AIDataOverlay({ accent, featureKey }: { accent: 'cinnabar' | 'stone' | 'gold'; featureKey: string }) {
  const data = AI_DATA[featureKey];
  if (!data) return null;
  const c = accentAIColor[accent];

  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4 opacity-0 transition-opacity duration-500 ease-ink group-hover:opacity-100">
      <div className="glass-panel-dark w-44 rounded-md p-3.5 text-xs text-paper-100 backdrop-blur-xl">
        {/* 顶部:AI 标识 + 评分 */}
        <div className="mb-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gold-400">
            <span className="relative inline-block h-1.5 w-1.5">
              <span className={`absolute inset-0 rounded-full ${c.dot}`} />
              <span className={`absolute inset-0 animate-ping rounded-full ${c.dot} opacity-60`} />
            </span>
            AI VISION
          </span>
          <span className={`font-serif text-lg font-semibold ${c.score}`}>
            {data.score}
            <span className="ml-0.5 text-[10px] text-paper-200/50">/100</span>
          </span>
        </div>
        {/* 进度条 */}
        <div className="mb-2.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full ${c.bar} rounded-full transition-all duration-700 ease-out`}
            style={{ width: `${data.score}%` }}
          />
        </div>
        {/* 数据项 */}
        <div className="space-y-1.5">
          {data.items.map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[11px]">
              <span className="text-paper-200/60">{item.label}</span>
              <span className="font-medium text-paper-100">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
