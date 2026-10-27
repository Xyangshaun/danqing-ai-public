import React from 'react';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { TiltCard } from '@/components/ui/TiltCard';

const VALUES = [
  {
    no: '01',
    title: '3 秒智能分析',
    desc: '从作业上传到诊断报告,全程 3 秒级响应。AI 视觉模型在毫秒间完成构图、色彩、笔触的多维度识别,让学生在创作记忆鲜活时即刻获得反馈。',
    accent: 'cinnabar' as const,
    metric: '2.8s',
    metricLabel: '平均响应',
  },
  {
    no: '02',
    title: '多形态支持',
    desc: '不止绘画。系统覆盖绘画、设计、产品设计、雕塑四种创意形式,针对每种形式的视觉语言建立专属分析模型,真正贴合高校艺术教育的多元课程需求。',
    accent: 'stone' as const,
    metric: '4',
    metricLabel: '创意形式',
  },
  {
    no: '03',
    title: '专业美院标准',
    desc: '诊断维度对齐专业美院教学规范——构图的黄金分割与视觉重量、色彩的五调子与冷暖关系、笔触的骨法与韵律。让 AI 评图有人文厚度,而非机械打分。',
    accent: 'gold' as const,
    metric: '12+',
    metricLabel: '诊断维度',
  },
];

const accentTextGradient = {
  cinnabar: 'text-gradient-cinnabar',
  stone: 'text-stone-500',
  gold: 'text-gradient-gold',
};

const accentBar = {
  cinnabar: 'bg-cinnabar-500',
  stone: 'bg-stone-500',
  gold: 'bg-gold-500',
};

const accentMetricColor = {
  cinnabar: 'text-cinnabar-600',
  stone: 'text-stone-600',
  gold: 'text-gold-700',
};

/**
 * 核心价值区块
 * 玻璃卡片三栏,立体层次 + 渐变编号 + 悬停浮起
 * 替代纯文字三栏,增加品牌官网的成熟感
 */
export function CoreValue() {
  return (
    <Section spacing="lg" id="core-value">
      <SectionHeader
        eyebrow="核心价值"
        subtitleEn="Core Value"
        title={<>为什么选择丹青有AI</>}
        description="我们用 AI 视觉理解能力,重新定义艺术作业的诊断效率与专业深度。"
      />

      <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-6">
        {VALUES.map((value, i) => (
          <RevealOnScroll key={value.no} delay={i * 0.12} variant="scale">
            <TiltCard className="h-full">
              <div className="ink-card group h-full p-8 md:p-9">
              {/* 顶部:大编号 + 右上角指标 */}
              <div className="flex items-start justify-between">
                <span
                  className={`font-serif text-6xl font-semibold ${accentTextGradient[value.accent]} opacity-90 transition-all duration-500 ease-ink group-hover:opacity-100 group-hover:scale-105 origin-left`}
                >
                  {value.no}
                </span>
                {/* 指标徽章 */}
                <div className="flex flex-col items-end">
                  <span className={`font-serif text-2xl font-semibold ${accentMetricColor[value.accent]}`}>
                    {value.metric}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.15em] text-ink-400">
                    {value.metricLabel}
                  </span>
                </div>
              </div>

              {/* 装饰横线 */}
              <div className="mt-6 flex items-center gap-2">
                <span className={`h-0.5 w-8 ${accentBar[value.accent]} transition-all duration-500 ease-ink group-hover:w-12`} />
                <span className="h-px w-12 bg-ink-100" />
              </div>

              <h3 className="mt-5 text-2xl font-semibold text-ink-900">
                {value.title}
              </h3>

              <p className="mt-4 text-[15px] leading-[1.8] text-ink-500">
                {value.desc}
              </p>

              {/* 底部装饰:悬浮时显现的金线 */}
              <div className="mt-6 h-px w-full bg-gradient-to-r from-transparent via-gold-400/40 to-transparent opacity-0 transition-opacity duration-500 ease-ink group-hover:opacity-100" />
              </div>
            </TiltCard>
          </RevealOnScroll>
        ))}
      </div>
    </Section>
  );
}
