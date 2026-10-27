import React from 'react';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CountUp } from '@/components/ui/CountUp';

const STATS: Array<{
  value?: number;
  text?: string;
  suffix?: string;
  label: string;
  sub: string;
}> = [
  // 现状:2 个小范围试用场景(数字克制)
  { value: 3, suffix: '+', label: '试用班级', sub: '素描·色彩·设计课' },
  { value: 2, suffix: '+', label: '合作院校', sub: '综合大学与师范院校' },
  // 预期:投入产品后基于 32 高校规模推演(贴合原"48 万+ · 65h")
  { value: 48, suffix: '万+', label: '投入后年累计分析', sub: '32 高校推演 · 教师 65h/学期' },
  // 政策:AI+教育 国家战略
  { text: '国发〔2017〕35号', label: '政策依据', sub: '国务院《新一代人工智能发展规划》' },
];

/**
 * 数据背书区块
 * 玻璃卡片化 + 渐变描边数字 + 数字滚动动画(进入视口时递增)
 * 2 项现状(克制) + 1 项预期(基于规模推演) + 1 项国家政策(AI+教育)
 */
export function DataEndorsement() {
  return (
    <Section spacing="lg" id="stats">
      <SectionHeader
        eyebrow="数据背书"
        subtitleEn="Proven Results"
        title={<>现状试用 · 投入预期 · 政策背书</>}
        description="现状:与院校小范围试用,围绕一线美术教师批改工作量大、反馈滞后、评价主观、过程性数据缺失四大痛点持续打磨;预期:32 高校规模年累计 48 万+ 作品,教师每学期可节省 65 小时;政策:国家 AI+教育战略。"
        
        align="center"
      />

      <div className="mt-16 grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-6">
        {STATS.map((stat, i) => (
          <RevealOnScroll key={stat.label} delay={i * 0.1} variant="blur">
            <div className="glass-card group h-full p-7 text-center">
              {/* 顶部装饰:渐变金线 */}
              <div className="mx-auto mb-4 h-px w-8 divider-gradient opacity-60 transition-all duration-500 ease-ink group-hover:w-12 group-hover:opacity-100" />

              {/* 数字滚动 / 政策文字 */}
              <div className="flex min-h-[3.5rem] items-baseline justify-center md:min-h-[4rem]">
                {stat.text ? (
                  // 政策文字:用较小字号,避免溢出
                  <span
                    className="font-serif text-xl font-semibold leading-tight text-ink-900 md:text-2xl"
                    title={stat.text}
                  >
                    {stat.text}
                  </span>
                ) : (
                  <CountUp
                    value={stat.value!}
                    suffix={stat.suffix}
                    className="stat-number"
                  />
                )}
              </div>

              {/* 标签 */}
              <p className="mt-3 text-sm font-medium text-ink-700 md:text-base">{stat.label}</p>
              <p className="mt-1 text-xs text-ink-400">{stat.sub}</p>

              {/* 底部装饰:悬浮时显现的小圆点 */}
              <div className="mt-4 flex justify-center">
                <span className="h-1 w-1 rounded-full bg-gold-400 opacity-0 transition-opacity duration-500 ease-ink group-hover:opacity-100" />
              </div>
            </div>
          </RevealOnScroll>
        ))}
      </div>

      <p className="mt-12 text-center text-xs text-ink-300">
        * 前两项为现状(产品试用阶段);第三项为 32 高校规模投入后推演;政策依据为公开发文
      </p>
    </Section>
  );
}