import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CTASection } from '@/components/ui/CTASection';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { BRAND_ART } from '@/lib/artworks';

export const metadata: Metadata = buildMetadata({
  title: '产品功能 - 三大分析维度与四种创意形式',
  description:
    '丹青有AI 提供构图、色彩、笔触三大分析维度,支持绘画、设计、产品设计、雕塑四种创意形式,含灵感融合系统与成长曲线,3 秒级 SLA 技术架构。',
  path: '/product',
  keywords: ['产品功能', '构图分析', '色彩分析', '笔触分析', '灵感融合', '成长曲线'],
});

const DIMENSIONS = [
  {
    no: '一',
    name: '构图分析',
    desc: '识别画面视觉重心、动势线、平衡关系,判断构图类型(三角/S 形/对角线/对称等),并以可视化标注呈现问题。',
    details: [
      '视觉重心定位:标注重心位置与黄金分割点的偏移关系',
      '动势线提取:半透明叠加显示视线流动路径',
      '视觉重量热力图:呈现画面重量分布是否平衡',
      '构图类型识别:自动判断并对照标准给出评价',
    ],
    accent: 'cinnabar',
    visual: <CompositionSpecVisual />,
  },
  {
    no: '二',
    name: '色彩分析',
    desc: '解析主色调、色彩关系、明暗五调子与冷暖对比,生成色彩分布图谱,指出协调与冲突之处。',
    details: [
      '主色调提取:识别画面主导色相与饱和度',
      '色彩关系图谱:呈现色相之间的呼应与对比',
      '明暗五调子检测:量化高光/中间调/明暗交界/反光/投影',
      '冷暖对比分析:判断色彩情绪与氛围一致性',
    ],
    accent: 'stone',
    visual: <ColorSpecVisual />,
  },
  {
    no: '三',
    name: '笔触分析',
    desc: '识别笔触轨迹、粗细变化、密度与韵律,判断用笔的骨力与节奏,区分习作与成熟作品的笔法差异。',
    details: [
      '笔触轨迹追踪:还原用笔路径与走向',
      '力度与速度识别:推测用笔的提按顿挫',
      '密度分布分析:判断画面疏密节奏',
      '韵律节奏评估:评估整体用笔的统一性与变化',
    ],
    accent: 'gold',
    visual: <BrushSpecVisual />,
  },
];

const FORMS = [
  { name: '绘画', desc: '素描、色彩、国画、油画、水彩等平面绘画形式', icon: 'painting' },
  { name: '设计', desc: '平面设计、视觉传达、版式、海报等设计稿件', icon: 'design' },
  { name: '产品设计', desc: '产品手绘、工业设计草图、透视图等三维表达', icon: 'product' },
  { name: '雕塑', desc: '雕塑多角度照片、立体造型、空间装置等', icon: 'sculpture' },
];

const accentText: Record<string, string> = {
  cinnabar: 'text-cinnabar-500',
  stone: 'text-stone-500',
  gold: 'text-gold-600',
};

export default function ProductPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '产品功能', url: '/product' },
        ])}
      />

      <PageHeader
        breadcrumb={[
          { name: '首页', href: '/' },
          { name: '产品功能', href: '/product' },
        ]}
        eyebrow="产品功能"
        title={<>深度理解每一张作业的专业 AI 诊断</>}
        description="三大分析维度、四种创意形式、灵感融合与成长曲线——以 3 秒级 SLA 技术架构,服务高校艺术教育全场景。"
      />

      {/* 三大分析维度详解 */}
      <Section spacing="lg">
        <SectionHeader
          eyebrow="三大分析维度"
          title={<>构图、色彩、笔触,逐一拆解</>}
          description="每一张作业都从骨架、血肉、肌理三个层面被理解。诊断不是打分,而是结构化的专业对话。"
        />
        <div className="mt-16 space-y-16">
          {DIMENSIONS.map((dim, i) => {
            const reversed = i % 2 === 1;
            return (
              <RevealOnScroll key={dim.name} variant="up">
                <div className="grid grid-cols-1 gap-10 border-t border-ink-100 pt-10 md:grid-cols-12 md:gap-12">
                  <div className={`md:col-span-5 ${reversed ? 'md:order-2' : ''}`}>
                    <div className="flex items-baseline gap-3">
                      <span className={`font-serif text-5xl font-semibold ${accentText[dim.accent]} opacity-70`}>
                        {dim.no}
                      </span>
                      <h3 className="text-2xl font-semibold text-ink-900">{dim.name}</h3>
                    </div>
                    <p className="mt-4 text-[15px] leading-relaxed text-ink-500">{dim.desc}</p>
                    <ul className="mt-6 grid grid-cols-1 gap-3">
                      {dim.details.map((d) => (
                        <li key={d} className="flex items-start gap-3 rounded-ink bg-paper-200/40 p-3.5">
                          <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${accentText[dim.accent].replace('text', 'bg')}`} />
                          <span className="text-sm leading-relaxed text-ink-600">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={`md:col-span-7 ${reversed ? 'md:order-1' : ''}`}>
                    <div className="overflow-hidden rounded-lg border border-ink-100 bg-paper-50 shadow-ink-sm">
                      {dim.visual}
                    </div>
                  </div>
                </div>
              </RevealOnScroll>
            );
          })}
        </div>
      </Section>

      {/* 四种创意形式 */}
      <Section spacing="lg" background="muted">
        <SectionHeader
          eyebrow="四种创意形式"
          title={<>不止绘画,覆盖艺术教育多元课程</>}
          description="针对每种创意形式的视觉语言,建立专属分析模型,真正贴合高校艺术教学实际。"
        />
        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FORMS.map((form, i) => (
            <RevealOnScroll key={form.name} delay={i * 0.08} variant="up">
              <div className="group h-full rounded-lg border border-ink-100 bg-paper-50 p-7 transition-all duration-500 ease-ink hover:border-gold-300 hover:shadow-ink">
                <div className="flex h-12 w-12 items-center justify-center rounded-ink bg-ink-900 text-paper-50 transition-colors duration-500 group-hover:bg-cinnabar-500">
                  <FormIcon name={form.icon} />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-ink-900">{form.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{form.desc}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      {/* 灵感融合 + 成长曲线 */}
      <Section spacing="lg">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16">
          <RevealOnScroll variant="up">
            <span className="section-eyebrow">灵感融合</span>
            <h3 className="mt-4 text-display-md font-semibold leading-tight text-ink-900">
              从临摹到创作的桥梁
            </h3>
            <p className="mt-5 text-base leading-relaxed text-ink-500">
              灵感融合系统不是"AI 替你生成作品",而是"AI 帮你看见灵感的可能性"。系统分析学生近期作业的风格倾向,从艺术史数据库检索对话关系作品,生成融合建议——构图、色调、题材的组合方向。
            </p>
            <ul className="mt-6 space-y-3">
              {['风格倾向识别', '艺术史案例检索', '融合方向建议', '启发而非替代'].map((p) => (
                <li key={p} className="flex items-center gap-3 text-sm text-ink-600">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-400" />
                  {p}
                </li>
              ))}
            </ul>
            {/* 品牌画作配图 */}
            <div className="relative mt-8 overflow-hidden rounded-lg border border-ink-100/40 shadow-ink-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <ResilientImage
                localSrc={BRAND_ART}
                alt="灵感融合 · 丹青水墨意象"
                loading="lazy"
                className="aspect-[16/9] w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-2 border border-paper-50/40" aria-hidden="true" />
              <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-ink-900/40 to-transparent" />
            </div>
          </RevealOnScroll>

          <RevealOnScroll variant="up" delay={0.1}>
            <span className="section-eyebrow">成长曲线</span>
            <h3 className="mt-4 text-display-md font-semibold leading-tight text-ink-900">
              让进步可见,让瓶颈可识
            </h3>
            <p className="mt-5 text-base leading-relaxed text-ink-500">
              系统对每位学生的历次作业持续追踪,在构图、色彩、笔触三个维度分别记录分数与趋势,形成可视化的成长曲线。上升趋势给正反馈,平台期给新方向,波动期识别"有意义的尝试"。
            </p>
            <div className="mt-6 rounded-lg border border-ink-100 bg-paper-200/40 p-6">
              <GrowthCurveVisual />
            </div>
          </RevealOnScroll>
        </div>
      </Section>

      {/* 技术架构优势 */}
      <Section spacing="lg" background="ink" contained={false}>
        <div className="container-content relative">
          <div className="max-w-2xl">
            <span className="section-eyebrow text-gold-400">
              <span style={{ background: 'currentColor' }} className="inline-block h-px w-8" />
              技术架构
            </span>
            <h2 className="mt-4 text-display-md font-semibold leading-tight text-paper-50">
              3 秒级 SLA,为课堂而生的响应速度
            </h2>
            <p className="mt-5 text-base leading-relaxed text-paper-200/70 md:text-lg">
              从作业上传到诊断报告生成,全程 3 秒内完成。这意味着教师可以在课堂上实时投影评图,学生可以在提交后即刻获得反馈——这是 AI 评图真正进入教学现场的前提。
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              { num: '3s', label: '端到端响应 SLA', desc: '上传到报告生成' },
              { num: '99.9%', label: '服务可用性', desc: '课堂时段优先保障' },
              { num: '多租户', label: '院校数据隔离', desc: 'RBAC 权限模型' },
            ].map((item, i) => (
              <RevealOnScroll key={item.label} delay={i * 0.1} variant="up">
                <div className="rounded-lg border border-paper-200/10 bg-ink-800/60 p-7">
                  <div className="font-serif text-4xl font-semibold text-gold-400">{item.num}</div>
                  <div className="mt-3 text-base font-medium text-paper-50">{item.label}</div>
                  <div className="mt-1 text-sm text-paper-200/50">{item.desc}</div>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </Section>

      <CTASection
        title="想看完整的诊断报告长什么样?"
        description="立即体验,上传一张作业,3 秒获得专业诊断。"
      />
    </>
  );
}

function FormIcon({ name }: { name: string }) {
  // 水墨风图标:统一 24×24,带细微笔触感(粗细变化、毛笔顿挫)
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'painting')
    return (
      <svg {...common}>
        {/* 画板 + 毛笔(水墨风) */}
        <path d="M3 5l4-1.5 1.5 4-4 1.5z" />
        <path d="M5 7.5l9 9.5" strokeWidth="2" />
        <path d="M14 17l3 3" strokeWidth="1.2" />
        <path d="M5.5 4.2c1.2 0.6 2 1.8 1.8 3" opacity="0.55" />
        <path d="M11 13.5c1.8 0 3.3 1.5 3.3 3.3" opacity="0.4" />
      </svg>
    );
  if (name === 'design')
    return (
      <svg {...common}>
        {/* 网格 + 笔触(设计稿) */}
        <rect x="3.5" y="3.5" width="17" height="17" rx="1" strokeWidth="1.4" />
        <line x1="3.5" y1="9" x2="20.5" y2="9" />
        <line x1="3.5" y1="14.5" x2="20.5" y2="14.5" />
        <line x1="9" y1="3.5" x2="9" y2="20.5" />
        <line x1="14.5" y1="3.5" x2="14.5" y2="20.5" />
        <path d="M5 6.5 L 8 6.5" strokeWidth="2.4" />
        <circle cx="17" cy="17" r="2.4" fill="currentColor" stroke="none" />
        <path d="M11 12 L 13 12" strokeWidth="2.4" opacity="0.75" />
      </svg>
    );
  if (name === 'product')
    return (
      <svg {...common}>
        {/* 产品三视图(线稿工业感) */}
        <path d="M5 6.5L12 3.5L19 6.5L19 13.5L12 16.5L5 13.5Z" />
        <path d="M5 6.5L12 9.5L19 6.5" />
        <line x1="12" y1="9.5" x2="12" y2="16.5" />
        <path d="M8.5 18.5L8.5 21" strokeWidth="1.2" opacity="0.55" />
        <path d="M15.5 18.5L15.5 21" strokeWidth="1.2" opacity="0.55" />
        <ellipse cx="12" cy="20.5" rx="4" ry="0.6" strokeWidth="1.2" opacity="0.4" />
      </svg>
    );
  return (
    <svg {...common}>
      {/* 雕塑:头肩像线稿 */}
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
      <path d="M10.5 8.5c0.5 0.5 2.5 0.5 3 0" strokeWidth="1.2" opacity="0.55" />
      <path d="M9 14.5 Q 12 16 15 14.5" strokeWidth="1.2" opacity="0.55" />
    </svg>
  );
}

/* ---------- 三大维度 · 数据规范风格可视化(产品页专用,区别于首页的营销展示) ---------- */

/** 构图分析 · 规范图:三宫格 + 黄金分割 + 视觉重心 + 数据 */
function CompositionSpecVisual() {
  return (
    <div className="bg-paper-50">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cinnabar-500" />
          <span className="font-mono text-[11px] tracking-wider text-ink-700">COMPOSITION_SPEC / 一</span>
        </div>
        <span className="font-mono text-[11px] text-ink-400">spec-01.svg · 400×280</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5">
        {/* 左侧:构图分析样图 */}
        <div className="md:col-span-3 p-5">
          <svg viewBox="0 0 400 280" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              {/* 画纸底色轻微渐变 */}
              <linearGradient id="paper-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbf9f4" />
                <stop offset="100%" stopColor="#f5f1e6" />
              </linearGradient>
              {/* 山形渐变(墨色从深到浅) */}
              <linearGradient id="mt-far" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1a1a1a" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#1a1a1a" stopOpacity="0.08" />
              </linearGradient>
              <linearGradient id="mt-near" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1a1a1a" stopOpacity="0.62" />
                <stop offset="100%" stopColor="#1a1a1a" stopOpacity="0.18" />
              </linearGradient>
              {/* 重心光晕 */}
              <radialGradient id="cg-halo" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#c8392e" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#c8392e" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#c8392e" stopOpacity="0" />
              </radialGradient>
            </defs>

            <rect width="400" height="280" fill="url(#paper-grad)" />

            {/* 背景纹理:轻细横线模拟画纸 */}
            <g stroke="#e8e1cf" strokeWidth="0.4" opacity="0.35">
              <line x1="0" y1="40" x2="400" y2="40" />
              <line x1="0" y1="80" x2="400" y2="80" />
              <line x1="0" y1="120" x2="400" y2="120" />
              <line x1="0" y1="160" x2="400" y2="160" />
              <line x1="0" y1="200" x2="400" y2="200" />
              <line x1="0" y1="240" x2="400" y2="240" />
            </g>

            {/* 模拟画作:三层远山 + 两棵松 + 一抹水 */}
            <g>
              {/* 远山(最浅) */}
              <path
                d="M 0 200 L 60 165 L 130 190 L 210 140 L 290 175 L 360 155 L 400 178 L 400 240 L 0 240 Z"
                fill="url(#mt-far)"
              />
              {/* 中山 */}
              <path
                d="M 0 218 L 80 178 L 160 208 L 240 158 L 320 195 L 400 172 L 400 250 L 0 250 Z"
                fill="url(#mt-far)"
                opacity="0.85"
              />
              {/* 近山(最深) */}
              <path
                d="M 0 235 L 100 200 L 180 225 L 260 180 L 340 215 L 400 195 L 400 280 L 0 280 Z"
                fill="url(#mt-near)"
              />
              {/* 远山雾气:轻白晕染 */}
              <ellipse cx="220" cy="175" rx="140" ry="9" fill="#fff" opacity="0.18" />
              <ellipse cx="120" cy="200" rx="90" ry="7" fill="#fff" opacity="0.15" />

              {/* 松树 1(右上,主) */}
              <g opacity="0.78">
                <line x1="315" y1="220" x2="318" y2="170" stroke="#1a1a1a" strokeWidth="1.6" />
                <ellipse cx="318" cy="165" rx="14" ry="6" fill="#1a1a1a" />
                <ellipse cx="316" cy="178" rx="18" ry="7" fill="#1a1a1a" opacity="0.85" />
                <ellipse cx="319" cy="192" rx="22" ry="8" fill="#1a1a1a" opacity="0.7" />
              </g>
              {/* 松树 2(左下,次) */}
              <g opacity="0.55">
                <line x1="60" y1="245" x2="62" y2="210" stroke="#1a1a1a" strokeWidth="1.2" />
                <ellipse cx="62" cy="205" rx="11" ry="5" fill="#1a1a1a" />
                <ellipse cx="61" cy="215" rx="14" ry="6" fill="#1a1a1a" opacity="0.8" />
              </g>

              {/* 一抹水面 */}
              <ellipse cx="180" cy="258" rx="110" ry="6" fill="#1a1a1a" opacity="0.08" />
              <ellipse cx="180" cy="260" rx="80" ry="4" fill="#1a1a1a" opacity="0.12" />
            </g>

            {/* 三分线 */}
            <g stroke="#c8392e" strokeWidth="0.6" opacity="0.4" strokeDasharray="3 3" fill="none">
              <line x1="133" y1="10" x2="133" y2="270" />
              <line x1="267" y1="10" x2="267" y2="270" />
              <line x1="10" y1="93" x2="390" y2="93" />
              <line x1="10" y1="187" x2="390" y2="187" />
            </g>
            {/* 三分线交点标记 */}
            <g fill="#c8392e" opacity="0.55">
              <circle cx="133" cy="93" r="1.6" />
              <circle cx="267" cy="93" r="1.6" />
              <circle cx="133" cy="187" r="1.6" />
              <circle cx="267" cy="187" r="1.6" />
            </g>

            {/* 黄金分割线 */}
            <g stroke="#c9a961" strokeWidth="0.5" opacity="0.55" fill="none" strokeDasharray="2 3">
              <line x1="152" y1="10" x2="152" y2="270" />
              <line x1="248" y1="10" x2="248" y2="270" />
              <line x1="10" y1="107" x2="390" y2="107" />
              <line x1="10" y1="173" x2="390" y2="173" />
            </g>

            {/* 黄金分割点:小金圈 */}
            <circle cx="248" cy="107" r="4.5" fill="none" stroke="#c9a961" strokeWidth="1.2" />
            <circle cx="248" cy="107" r="1.5" fill="#c9a961" />

            {/* 视觉重心:光晕 + 双圈 + 十字 */}
            <circle cx="267" cy="93" r="42" fill="url(#cg-halo)" />
            <circle cx="267" cy="93" r="30" fill="none" stroke="#c8392e" strokeWidth="0.5" opacity="0.3" />
            <circle cx="267" cy="93" r="18" fill="none" stroke="#c8392e" strokeWidth="1.2" opacity="0.9" />
            <g stroke="#c8392e" strokeWidth="1.4">
              <line x1="263" y1="86" x2="271" y2="100" />
              <line x1="259" y1="93" x2="275" y2="93" />
            </g>

            {/* 动势线:双路径(主动势 + 次动势) */}
            <path d="M 60 240 Q 150 200, 220 140 T 267 93" stroke="#1a1a1a" strokeWidth="1.4" fill="none" opacity="0.7" />
            <polygon points="265,89 271,96 263,96" fill="#1a1a1a" opacity="0.7" />
            {/* 次动势(虚线) */}
            <path d="M 30 215 Q 120 185, 200 130 T 258 100" stroke="#1a1a1a" strokeWidth="0.7" fill="none" opacity="0.35" strokeDasharray="3 2" />

            {/* 测量标注:重心 → 黄金点 偏移 */}
            <g stroke="#c8392e" strokeWidth="0.7" opacity="0.6" strokeDasharray="2 2" fill="none">
              <line x1="248" y1="107" x2="267" y2="93" />
            </g>
            <g>
              <rect x="278" y="70" width="86" height="14" rx="2" fill="#c8392e" opacity="0.92" />
              <text x="321" y="80" fontSize="9" fill="#fff" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">重心偏移 12%</text>
            </g>

            {/* 标签 */}
            <g fontFamily="sans-serif" fontSize="9">
              <text x="280" y="95" fill="#c8392e" fontWeight="600">视觉重心</text>
              <text x="252" y="125" fill="#c9a961">黄金分割点</text>
              <text x="222" y="135" fill="#1a1a1a" opacity="0.7">动势线</text>
              <text x="155" y="20" fill="#c9a961" opacity="0.75">黄金线</text>
              <text x="138" y="20" fill="#c8392e" opacity="0.65">三分线</text>
              <text x="20" y="272" fill="#6b6b6b" opacity="0.6" fontSize="8">scene: landscape / ink-wash</text>
            </g>

            {/* 视觉重量热力点(右上角小图例) */}
            <g transform="translate(345, 18)" fontFamily="sans-serif">
              <rect x="-8" y="-10" width="52" height="46" rx="3" fill="#fff" opacity="0.65" stroke="#e8e1cf" strokeWidth="0.4" />
              <text x="0" y="0" fontSize="7" fill="#6b6b6b" fontWeight="600">HEAT</text>
              <circle cx="5" cy="12" r="2.5" fill="#c8392e" opacity="0.85" />
              <circle cx="15" cy="12" r="2.5" fill="#c9a961" opacity="0.7" />
              <circle cx="25" cy="12" r="2.5" fill="#3d4a3d" opacity="0.5" />
              <circle cx="35" cy="12" r="2.5" fill="#a8a8a8" opacity="0.35" />
              <text x="0" y="28" fontSize="6" fill="#6b6b6b" opacity="0.7">hot → cold</text>
            </g>
          </svg>
        </div>

        {/* 右侧:数据面板 */}
        <div className="md:col-span-2 border-t border-ink-100 bg-paper-100/40 p-5 md:border-l md:border-t-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">DETECTION</div>
          <div className="mt-3 space-y-3">
            {[
              { k: '视觉重心', v: '右上 1/3', dot: 'bg-cinnabar-500' },
              { k: '黄金偏移', v: '12%', dot: 'bg-gold-500' },
              { k: '平衡度', v: '92%', dot: 'bg-stone-500' },
              { k: '构图类型', v: '三分法', dot: 'bg-ink-700' },
              { k: '动势走向', v: '左上汇聚', dot: 'bg-cinnabar-400' },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between border-b border-ink-100/60 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${row.dot}`} />
                  <span className="text-xs text-ink-500">{row.k}</span>
                </div>
                <span className="font-mono text-xs font-medium text-ink-800">{row.v}</span>
              </div>
            ))}
          </div>

          {/* 视觉重量分布迷你热力图 */}
          <div className="mt-5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">WEIGHT MAP</div>
            <div className="mt-2 grid grid-cols-3 gap-0.5 rounded overflow-hidden">
              {[0.3, 0.5, 0.85, 0.45, 0.6, 0.55, 0.2, 0.35, 0.4].map((o, i) => (
                <div
                  key={i}
                  className="aspect-square"
                  style={{ background: `rgba(200, 57, 46, ${o})` }}
                  title={`cell-${i}: ${(o * 100).toFixed(0)}%`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-ink-500">
              <span>轻</span>
              <span>重</span>
            </div>
          </div>

          <div className="mt-5 rounded border border-cinnabar-200/60 bg-cinnabar-50/50 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-cinnabar-600">SUGGESTION</div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
              主体偏向右上,左下区域留白偏多,可考虑增加次要元素平衡视觉重量。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 色彩分析 · 规范图:色相环 + 主色分布 + 冷暖/明度数据 */
function ColorSpecVisual() {
  return (
    <div className="bg-paper-50">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone-500" />
          <span className="font-mono text-[11px] tracking-wider text-ink-700">COLOR_SPEC / 二</span>
        </div>
        <span className="font-mono text-[11px] text-ink-400">spec-02.svg · 400×280</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5">
        {/* 左侧:色相环 + 主色调 */}
        <div className="md:col-span-3 p-5">
          <svg viewBox="0 0 400 280" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="paper-grad-2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbf9f4" />
                <stop offset="100%" stopColor="#f5f1e6" />
              </linearGradient>
              {/* 主色渐变色块 */}
              <linearGradient id="swatch-1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8b6f47" />
                <stop offset="100%" stopColor="#a8854a" />
              </linearGradient>
              <linearGradient id="swatch-2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#c4a87c" />
                <stop offset="100%" stopColor="#d4b888" />
              </linearGradient>
              <linearGradient id="swatch-3" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3d4a3d" />
                <stop offset="100%" stopColor="#5c6e5c" />
              </linearGradient>
            </defs>

            <rect width="400" height="280" fill="url(#paper-grad-2)" />

            {/* 色相环外圈标注环 */}
            <g transform="translate(110, 130)">
              {/* 外圈虚线轨道 */}
              <circle r="74" fill="none" stroke="#e8e1cf" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.7" />
              {/* 12 个色相点 */}
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i * 30 - 90) * Math.PI / 180;
                const x = Math.cos(angle) * 58;
                const y = Math.sin(angle) * 58;
                const hue = i * 30;
                return (
                  <g key={i}>
                    {/* 极坐标参考线 */}
                    <line x1="0" y1="0" x2={x} y2={y} stroke="#e8e1cf" strokeWidth="0.4" opacity="0.5" />
                    {/* 色相点(带光晕) */}
                    <circle cx={x} cy={y} r="16" fill={`hsl(${hue}, 50%, 55%)`} opacity="0.18" />
                    <circle cx={x} cy={y} r="13" fill={`hsl(${hue}, 50%, 55%)`} opacity="0.92" stroke="#fff" strokeWidth="0.8" />
                    {/* 色相角度标注 */}
                    <text
                      x={Math.cos(angle) * 78}
                      y={Math.sin(angle) * 78 + 3}
                      fontSize="7"
                      fill="#6b6b6b"
                      fontFamily="monospace"
                      textAnchor="middle"
                      opacity="0.7"
                    >
                      {hue}°
                    </text>
                  </g>
                );
              })}
              {/* 内圈 */}
              <circle r="38" fill="#faf8f3" stroke="#e8e1cf" strokeWidth="0.8" />
              <circle r="34" fill="none" stroke="#c9a961" strokeWidth="0.4" strokeDasharray="1 2" opacity="0.6" />
              <text textAnchor="middle" y="-6" fontSize="9" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">主色</text>
              <text textAnchor="middle" y="8" fontSize="11" fill="#1a1a1a" fontFamily="sans-serif" fontWeight="600">暖赭石</text>
              <text textAnchor="middle" y="22" fontSize="8" fill="#a8854a" fontFamily="monospace">#8b6f47</text>

              {/* 主色指示线 */}
              <line x1="0" y1="0" x2="29" y2="-50" stroke="#c8392e" strokeWidth="1.2" opacity="0.85" />
              <circle cx="29" cy="-50" r="3" fill="#c8392e" />
              <circle cx="29" cy="-50" r="5" fill="none" stroke="#c8392e" strokeWidth="0.8" opacity="0.5" />
            </g>

            {/* 右侧:主色分布条(带渐变 + 标签) */}
            <g transform="translate(220, 24)">
              <text x="0" y="0" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">主色分布</text>
              <text x="0" y="12" fontSize="7" fill="#a8854a" fontFamily="monospace" opacity="0.7">TOP 5 PALETTE</text>
              {[
                { c: 'url(#swatch-1)', p: 32, y: 26, name: '赭石' },
                { c: 'url(#swatch-2)', p: 24, y: 54, name: '米驼' },
                { c: 'url(#swatch-3)', p: 18, y: 82, name: '墨绿' },
                { c: '#d4c4a8', p: 14, y: 110, name: '米白' },
                { c: '#2a2a2a', p: 12, y: 138, name: '焦墨' },
              ].map((c, i) => (
                <g key={i}>
                  {/* 色块 */}
                  <rect x="0" y={c.y} width="20" height="20" fill={c.c} rx="2.5" stroke="#fff" strokeWidth="0.6" />
                  {/* 占比条(带渐变) */}
                  <rect x="26" y={c.y + 3} width={Math.max(c.p * 1.5, 10)} height="14" fill={c.c} opacity="0.32" rx="2" />
                  {/* 占比数字 */}
                  <text x={26 + Math.max(c.p * 1.5, 10) + 6} y={c.y + 14} fontSize="9" fill="#1a1a1a" fontFamily="monospace" fontWeight="600">{c.p}%</text>
                  {/* 色名 */}
                  <text x="26" y={c.y - 2} fontSize="7" fill="#6b6b6b" fontFamily="sans-serif" opacity="0.75">{c.name}</text>
                </g>
              ))}
            </g>

            {/* 底部:明度梯度(带刻度) */}
            <g transform="translate(20, 232)">
              <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">明度五调子</text>
              {[
                { c: '#0d0d0d', l: '高光' },
                { c: '#3a3a3a', l: '亮灰' },
                { c: '#6b6b6b', l: '中间调' },
                { c: '#9a9a9a', l: '明暗交界' },
                { c: '#c8c8c8', l: '反光' },
                { c: '#e8e8e8', l: '投影' },
                { c: '#f7f7f7', l: '留白' },
              ].map((s, i) => (
                <g key={i}>
                  <rect x={i * 22 + 60} y="-12" width="20" height="14" fill={s.c} stroke="#fff" strokeWidth="0.4" />
                  <text x={i * 22 + 70} y="16" fontSize="7" fill="#6b6b6b" fontFamily="sans-serif" textAnchor="middle">{s.l}</text>
                </g>
              ))}
              {/* 当前画面亮度指示箭头 */}
              <polygon points="128,-16 132,-16 130,-20" fill="#c8392e" />
              <text x="130" y="-24" fontSize="7" fill="#c8392e" fontFamily="sans-serif" textAnchor="middle" fontWeight="600">本图</text>
            </g>
          </svg>
        </div>

        {/* 右侧:数据面板 */}
        <div className="md:col-span-2 border-t border-ink-100 bg-paper-100/40 p-5 md:border-l md:border-t-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">DETECTION</div>
          <div className="mt-3 space-y-3">
            {[
              { k: '主色调', v: '暖赭石' },
              { k: '色相关系', v: '邻近色' },
              { k: '冷暖比', v: '35 : 65' },
              { k: '明暗对比', v: '中强' },
              { k: '饱和度均值', v: '中 (52%)' },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between border-b border-ink-100/60 pb-2 last:border-0">
                <span className="text-xs text-ink-500">{row.k}</span>
                <span className="font-mono text-xs font-medium text-ink-800">{row.v}</span>
              </div>
            ))}
          </div>

          {/* 冷暖比可视化 */}
          <div className="mt-5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">TEMP RATIO</div>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full">
              <div className="bg-stone-500" style={{ width: '35%' }} />
              <div className="bg-gold-500" style={{ width: '65%' }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-ink-500">
              <span>冷 35%</span>
              <span>暖 65%</span>
            </div>
          </div>

          {/* 色温指示 */}
          <div className="mt-4 rounded border border-stone-200/60 bg-stone-50/50 p-2.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-ink-500">色温倾向</span>
              <span className="font-mono font-medium text-gold-600">暖调 · T+12</span>
            </div>
          </div>

          <div className="mt-4 rounded border border-stone-300/60 bg-stone-50/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-600">SUGGESTION</div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
              暖赭石主导,与墨绿形成稳重对比;可在暗部加少量冷色平衡,增强空间层次。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 笔触分析 · 规范图:笔速曲线 + 力度直方图 + 数据 */
function BrushSpecVisual() {
  return (
    <div className="bg-paper-50">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-500" />
          <span className="font-mono text-[11px] tracking-wider text-ink-700">BRUSH_SPEC / 三</span>
        </div>
        <span className="font-mono text-[11px] text-ink-400">spec-03.svg · 400×280</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5">
        {/* 左侧:笔速曲线 + 力度 */}
        <div className="md:col-span-3 p-5">
          <svg viewBox="0 0 400 280" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="brush-blur-2"><feGaussianBlur stdDeviation="0.4" /></filter>
              <linearGradient id="paper-grad-3" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbf9f4" />
                <stop offset="100%" stopColor="#f5f1e6" />
              </linearGradient>
              {/* 笔迹墨色渐变 */}
              <linearGradient id="ink-1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1a1a1a" stopOpacity="0.85" />
                <stop offset="50%" stopColor="#1a1a1a" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#1a1a1a" stopOpacity="0.75" />
              </linearGradient>
              <linearGradient id="ink-2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3d4a3d" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#3d4a3d" stopOpacity="0.4" />
              </linearGradient>
            </defs>
            <rect width="400" height="280" fill="url(#paper-grad-3)" />

            {/* 模拟笔触场:深底 + 三组不同力度的笔迹 */}
            <g>
              <rect x="20" y="20" width="360" height="95" fill="#2a2520" rx="3" />
              <rect x="20" y="20" width="360" height="95" fill="none" stroke="#c9a961" strokeWidth="0.4" opacity="0.4" rx="3" />
              {/* 重笔触(上) */}
              <g filter="url(#brush-blur-2)" opacity="0.92">
                <path d="M 30 40 Q 100 28, 200 48 T 370 38" stroke="url(#ink-1)" strokeWidth="6" fill="none" strokeLinecap="round" />
                <path d="M 40 46 Q 130 38, 220 55 T 360 48" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.4" />
              </g>
              {/* 中笔触(中) */}
              <g filter="url(#brush-blur-2)" opacity="0.85">
                <path d="M 30 68 Q 120 55, 220 75 T 370 65" stroke="#c9a961" strokeWidth="4" fill="none" strokeLinecap="round" />
                <path d="M 30 76 Q 130 68, 230 82 T 370 72" stroke="#d4b888" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.6" />
              </g>
              {/* 轻笔触(下) */}
              <g filter="url(#brush-blur-2)" opacity="0.65">
                <path d="M 30 95 Q 140 82, 240 100 T 370 88" stroke="#e0c898" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M 40 102 Q 150 92, 250 106 T 370 96" stroke="#a8a8a8" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5" />
              </g>
              {/* 笔迹方向箭头 */}
              <g fill="#c8392e" opacity="0.75">
                <polygon points="365,36 372,40 365,44" />
                <polygon points="365,63 372,67 365,71" />
                <polygon points="365,86 372,90 365,94" />
              </g>
              <text x="28" y="16" fontSize="9" fill="#a8854a" fontFamily="sans-serif" fontWeight="600">STROKE FIELD · 3 PRESSURE LAYERS</text>
            </g>

            {/* 笔速折线图(带网格) */}
            <g transform="translate(20, 145)">
              <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">笔速曲线 (cm/s)</text>
              {/* 横向网格 */}
              <line x1="0" y1="50" x2="360" y2="50" stroke="#6b6b6b" strokeWidth="0.4" opacity="0.3" />
              <line x1="0" y1="38" x2="360" y2="38" stroke="#6b6b6b" strokeWidth="0.4" opacity="0.25" />
              <line x1="0" y1="25" x2="360" y2="25" stroke="#6b6b6b" strokeWidth="0.4" opacity="0.3" />
              <line x1="0" y1="12" x2="360" y2="12" stroke="#6b6b6b" strokeWidth="0.4" opacity="0.25" />
              {/* 中位参考虚线 */}
              <line x1="0" y1="32" x2="360" y2="32" stroke="#c9a961" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" />
              <text x="362" y="34" fontSize="7" fill="#c9a961" fontFamily="sans-serif">mid 0.8</text>
              {/* 笔速线 */}
              <polyline
                points="0,45 30,32 60,48 90,25 120,42 150,30 180,38 210,20 240,35 270,28 300,32 330,22 360,28"
                fill="none" stroke="#c8392e" strokeWidth="1.4" opacity="0.9"
              />
              {/* 数据点 */}
              {[
                [0, 45], [30, 32], [60, 48], [90, 25], [120, 42], [150, 30],
                [180, 38], [210, 20], [240, 35], [270, 28], [300, 32], [330, 22], [360, 28],
              ].map(([x, y], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r="2" fill="#c8392e" opacity="0.9" />
                  <circle cx={x} cy={y} r="4" fill="none" stroke="#c8392e" strokeWidth="0.6" opacity="0.35" />
                </g>
              ))}
              {/* 峰值标注 */}
              <circle cx="210" cy="20" r="6" fill="none" stroke="#c9a961" strokeWidth="1" />
              <text x="210" y="10" fontSize="8" fill="#c9a961" fontFamily="sans-serif" textAnchor="middle" fontWeight="600">峰速 1.4</text>
              <text x="0" y="65" fontSize="8" fill="#a8854a" fontFamily="sans-serif">t: 0s</text>
              <text x="360" y="65" fontSize="8" fill="#a8854a" fontFamily="sans-serif" textAnchor="end">t: 2.4s</text>
            </g>

            {/* 力度直方图(带坐标轴) */}
            <g transform="translate(20, 240)">
              <text x="0" y="-2" fontSize="10" fill="#6b6b6b" fontFamily="sans-serif" fontWeight="600">力度分布 · PRESSURE</text>
              {/* Y 轴 */}
              <line x1="45" y1="0" x2="45" y2="-30" stroke="#6b6b6b" strokeWidth="0.5" opacity="0.5" />
              {/* X 轴 */}
              <line x1="45" y1="0" x2="380" y2="0" stroke="#6b6b6b" strokeWidth="0.5" opacity="0.5" />
              {[
                { h: 18, l: '极轻', pct: '8%' },
                { h: 35, l: '轻', pct: '20%' },
                { h: 25, l: '中', pct: '32%', hot: true },
                { h: 12, l: '重', pct: '25%' },
                { h: 8, l: '极重', pct: '15%' },
              ].map((b, i) => (
                <g key={i}>
                  <rect
                    x={i * 66 + 55}
                    y={-b.h * 0.7}
                    width="32"
                    height={b.h * 0.7}
                    fill={b.hot ? '#c8392e' : '#2e5c6e'}
                    opacity={b.hot ? 0.9 : 0.6}
                    rx="2"
                  />
                  <text x={i * 66 + 71} y={-b.h * 0.7 - 3} fontSize="7" fill={b.hot ? '#c8392e' : '#6b6b6b'} fontFamily="monospace" textAnchor="middle" fontWeight="600">{b.pct}</text>
                  <text x={i * 66 + 71} y="12" fontSize="8" fill="#6b6b6b" fontFamily="sans-serif" textAnchor="middle">{b.l}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* 右侧:数据面板 */}
        <div className="md:col-span-2 border-t border-ink-100 bg-paper-100/40 p-5 md:border-l md:border-t-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">DETECTION</div>
          <div className="mt-3 space-y-3">
            {[
              { k: '平均速度', v: '中速偏快' },
              { k: '力度峰值', v: '重' },
              { k: '密度分布', v: '上密下疏' },
              { k: '韵律评分', v: 'A' },
              { k: '提按频次', v: '12 次/笔' },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between border-b border-ink-100/60 pb-2 last:border-0">
                <span className="text-xs text-ink-500">{row.k}</span>
                <span className="font-mono text-xs font-medium text-ink-800">{row.v}</span>
              </div>
            ))}
          </div>

          {/* 韵律评分可视化 */}
          <div className="mt-5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-400">RHYTHM SCORE</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-serif text-3xl font-semibold text-gold-600">A</span>
              <span className="text-xs text-ink-400">/ 92 / 100</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
              <div className="h-full bg-gold-500" style={{ width: '92%' }} />
            </div>
            {/* 评分细分 */}
            <div className="mt-2.5 space-y-1 text-[10px] text-ink-500">
              <div className="flex justify-between"><span>节奏稳定度</span><span className="font-mono">95</span></div>
              <div className="flex justify-between"><span>提按变化</span><span className="font-mono">88</span></div>
              <div className="flex justify-between"><span>速度连贯性</span><span className="font-mono">93</span></div>
            </div>
          </div>

          <div className="mt-5 rounded border border-gold-300/60 bg-gold-50/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-gold-700">SUGGESTION</div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
              用笔节奏稳定,提按变化自然。建议加强局部提按对比,提升画面张力。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GrowthCurveVisual() {
  return (
    <div className="bg-paper-50">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-500" />
          <span className="font-mono text-[11px] tracking-wider text-ink-700">GROWTH_CURVE</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-ink-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-full bg-gold-500" />
            构图
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-full bg-stone-500" />
            色彩
          </span>
        </div>
      </div>
      <div className="p-5">
        <svg viewBox="0 0 400 200" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="gc-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c9a961" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#c9a961" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 网格 */}
          <g stroke="#e8e1cf" strokeWidth="1">
            <line x1="40" y1="40" x2="380" y2="40" />
            <line x1="40" y1="90" x2="380" y2="90" />
            <line x1="40" y1="140" x2="380" y2="140" />
          </g>

          {/* Y 轴标签 */}
          <g fontFamily="sans-serif" fontSize="8" fill="#6b6b6b">
            <text x="32" y="43" textAnchor="end">A</text>
            <text x="32" y="93" textAnchor="end">B</text>
            <text x="32" y="143" textAnchor="end">C</text>
          </g>

          {/* 构图:稳定上升 */}
          <path d="M 50 120 L 110 110 L 170 95 L 230 70 L 290 55 L 360 40 L 360 160 L 50 160 Z" fill="url(#gc-grad)" />
          <polyline
            points="50,120 110,110 170,95 230,70 290,55 360,40"
            fill="none"
            stroke="#c9a961"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[[50,120],[110,110],[170,95],[230,70],[290,55],[360,40]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r="3.5" fill="#c8392e" stroke="#faf8f3" strokeWidth="1.5" />
          ))}

          {/* 色彩:缓慢上升 + 平台期 */}
          <polyline
            points="50,135 110,128 170,120 230,108 290,95 360,82"
            fill="none"
            stroke="#2e5c6e"
            strokeWidth="2"
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
          {[[50,135],[110,128],[170,120],[230,108],[290,95],[360,82]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r="2.5" fill="#2e5c6e" />
          ))}

          {/* 阶段注释:上升期 / 平台期 */}
          <g>
            <line x1="50" y1="180" x2="170" y2="180" stroke="#a8854a" strokeWidth="0.6" />
            <text x="110" y="195" fontSize="9" fill="#a8854a" fontFamily="sans-serif" textAnchor="middle">上升期</text>
            <line x1="170" y1="180" x2="290" y2="180" stroke="#6b6b6b" strokeWidth="0.6" strokeDasharray="2 2" />
            <text x="230" y="195" fontSize="9" fill="#6b6b6b" fontFamily="sans-serif" textAnchor="middle">平台期</text>
            <line x1="290" y1="180" x2="360" y2="180" stroke="#2e5c6e" strokeWidth="0.6" />
            <text x="325" y="195" fontSize="9" fill="#2e5c6e" fontFamily="sans-serif" textAnchor="middle">突破</text>
          </g>

          {/* 端点标签 */}
          <g fontFamily="sans-serif">
            <text x="50" y="155" fontSize="8" fill="#a8854a">第1周</text>
            <text x="360" y="155" fontSize="8" fill="#a8854a" textAnchor="end">第16周</text>
            <text x="370" y="38" fontSize="9" fill="#a8854a" fontWeight="600">构图</text>
            <text x="370" y="80" fontSize="9" fill="#2e5c6e" fontWeight="600">色彩</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
