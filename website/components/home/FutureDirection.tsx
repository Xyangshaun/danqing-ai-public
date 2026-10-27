import React from 'react';
import { Section } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { InkDecoration } from '@/components/ui/InkDecoration';
import { Parallax } from '@/components/ui/RevealGroup';

/**
 * 未来方向区块
 * 墨黑背景 + 玻璃卡片,与 Scenarios 形成水墨阴阳呼应
 * 展示四大演进方向卡片 + M0→M4 里程碑路线时间线
 * 内容依据:硬件实时监督与监考架构规划(软件化先行、硬件后置)
 */

const DIRECTIONS = [
  {
    no: '一',
    icon: 'guide',
    title: 'AI 实时伴学',
    tag: '教学核心',
    desc: 'AI 像集训老师一样实时看着、实时指出错误。从"提交作品再诊断"升级为创作全程的流式陪伴,指导延迟保持 3 秒级。',
    points: ['关键帧降采样', '事件触发 + 冷却', '流式指导浮层'],
  },
  {
    no: '二',
    icon: 'proctor',
    title: 'AI 监考',
    tag: '月考 · 模拟考',
    desc: '画室月考与模拟考中,AI 替代在场人工监考。行为检测覆盖动作、视线、离位、多设备与页面切换,输出异常时间线报告。',
    points: ['动作/视线/离位检测', '多设备/页面切换识别', '异常时间线 + 证据截图'],
  },
  {
    no: '三',
    icon: 'analytics',
    title: '学情分析 · 同届基准',
    tag: '阶段研判',
    desc: '基于同龄/同届数据判断学生处于什么阶段、是否落后。输出所处阶段(基础/瓶颈/冲刺)与短板雷达,让进步与差距可被看见。',
    points: ['同届基准百分位', '阶段判定模型', '短板雷达可视化'],
  },
  {
    no: '四',
    icon: 'hardware',
    title: '硬件交互',
    tag: '软硬解耦',
    desc: '从智能摄像头到边缘 AI 盒子,走向真正的硬件交互。软件化先行、硬件后置,先用现有设备验证价值,再落地专用硬件。',
    points: ['智能摄像头采集', '边缘 AI 盒子(RK3588)', '本机检测 · 关键帧上云'],
  },
];

/** 里程碑路线:软件化先行,硬件后置 */
const MILESTONES = [
  {
    phase: 'M0',
    title: '契约冻结',
    desc: '架构与合规方案对齐',
    active: true,
  },
  {
    phase: 'M1',
    title: '软件化实时伴学',
    desc: '现有设备即可获得实时 AI 指导',
    active: true,
  },
  {
    phase: 'M2',
    title: '单考场监考 + 学情',
    desc: '画室月考/模拟考 AI 监考闭环',
    active: true,
  },
  {
    phase: 'M3',
    title: '大规模在线监考',
    desc: '边缘化 · 事件化 · 异步化',
    active: false,
  },
  {
    phase: 'M4',
    title: '硬件商业化',
    desc: '边缘盒子 + 官网承接 · 订阅计费',
    active: false,
  },
];

function DirectionIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'guide')
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20c0-3.8 3.1-6.4 7-6.4s7 2.6 7 6.4" />
        <path d="M12 2v1.5M2.5 8H4M20 8h1.5" />
      </svg>
    );
  if (name === 'proctor')
    return (
      <svg {...common}>
        <rect x="3.5" y="4" width="17" height="13" rx="1.5" />
        <path d="M8 4V3M16 4V3M3.5 8.5h17" />
        <circle cx="12" cy="13" r="1" fill="currentColor" />
      </svg>
    );
  if (name === 'analytics')
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M12 7v.01M12 12h.01M12 16h.01" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function FutureDirection() {
  return (
    <Section spacing="lg" background="ink" contained={false} id="future">
      {/* 装饰层 1:水墨晕染(视差) */}
      <Parallax distance={40} className="absolute left-0 top-0 h-full w-1/2">
        <InkDecoration variant="mist" color="stone" opacity={0.14} className="h-full w-full" />
      </Parallax>
      {/* 装饰层 2:深色科技网格 */}
      <div className="grid-bg-dark pointer-events-none absolute inset-0" aria-hidden="true" />
      {/* 装饰层 3:顶部金色微光 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(180deg, rgba(201, 169, 97, 0.06) 0%, transparent 100%)',
        }}
      />

      <div className="container-content relative">
        <div className="max-w-2xl">
          <span className="section-eyebrow text-gold-400">
            <span style={{ background: 'currentColor' }} className="inline-block h-px w-8" />
            未来方向
          </span>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.25em] text-paper-200/30">
            Roadmap
          </p>
          <h2 className="mt-2 text-display-md font-semibold leading-tight text-paper-50">
            从评分诊断,走向完整教学闭环
          </h2>
          <p className="mt-5 text-base leading-relaxed text-paper-200/70 md:text-lg">
            丹青有AI 不止于"上传 → 3 秒诊断"。我们正沿着软件化先行、硬件后置的路线,把单点能力升级为
            实时监督、现场指导与在线监考的全程陪伴。
          </p>
        </div>

        {/* 四大方向卡片 */}
        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DIRECTIONS.map((d, i) => (
            <RevealOnScroll key={d.title} delay={i * 0.1} variant="ink">
              <div className="glass-card-dark group relative h-full p-7">
                {/* 顶部:编号 + 图标 */}
                <div className="flex items-start justify-between">
                  <span className="font-serif text-3xl font-semibold text-paper-200/30 transition-colors duration-500 ease-ink group-hover:text-gold-400/70">
                    {d.no}
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-ink bg-ink-800/70 text-gold-400 ring-1 ring-gold-400/20 transition-colors duration-500 group-hover:bg-gold-400 group-hover:text-ink-900">
                    <DirectionIcon name={d.icon} />
                  </span>
                </div>

                {/* 标题 + 标签 */}
                <div className="mt-6 flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-paper-50">{d.title}</h3>
                  <span className="inline-block rounded-full border border-gold-400/40 px-2.5 py-0.5 text-[10px] tracking-wider text-gold-300">
                    {d.tag}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-paper-200/60">{d.desc}</p>

                {/* 能力点 */}
                <ul className="mt-5 space-y-2 border-t border-paper-200/10 pt-4">
                  {d.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-xs text-paper-200/55">
                      <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-gold-400" />
                      {p}
                    </li>
                  ))}
                </ul>

                {/* 底部金线 */}
                <div className="mt-5 flex items-center gap-2">
                  <span className="h-px w-0 bg-gradient-to-r from-gold-400 to-transparent transition-all duration-500 ease-ink group-hover:w-10" />
                </div>
              </div>
            </RevealOnScroll>
          ))}
        </div>

        {/* 里程碑路线 */}
        <RevealOnScroll variant="ink" className="mt-16">
          <div className="glass-card-dark relative overflow-hidden p-8 md:p-10">
            <div className="flex flex-col gap-8 md:flex-row md:items-center">
              <div className="md:w-56 shrink-0">
                <h3 className="text-lg font-semibold text-paper-50">演进路线</h3>
                <p className="mt-2 text-xs leading-relaxed text-paper-200/50">
                  软件化先行验证价值,再逐步走向大规模与硬件商业化。
                </p>
              </div>

              {/* 时间线 */}
              <div className="relative flex-1">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
                  {MILESTONES.map((m, i) => (
                    <div key={m.phase} className="relative">
                      {/* 节点 */}
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${
                            m.active
                              ? 'bg-gold-400 text-ink-900 ring-gold-400'
                              : 'bg-ink-800/70 text-paper-200/40 ring-paper-200/15'
                          }`}
                        >
                          {m.phase}
                        </span>
                        {i < MILESTONES.length - 1 && (
                          <span className="hidden h-px flex-1 bg-gradient-to-r from-gold-400/40 to-transparent lg:block" />
                        )}
                      </div>
                      <h4 className={`mt-3 text-sm font-medium ${m.active ? 'text-paper-50' : 'text-paper-200/45'}`}>
                        {m.title}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-paper-200/40">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </Section>
  );
}