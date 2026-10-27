import React from 'react';
import { Section } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { InkDecoration } from '@/components/ui/InkDecoration';
import { Parallax } from '@/components/ui/RevealGroup';

const SCENARIOS = [
  {
    no: '01',
    tag: '课堂教学',
    title: '课堂即时评图',
    desc: '教师上传学生作业,3 秒获得诊断报告,投影到大屏逐项讲解,把"讲评环节"从课后搬到课中。',
  },
  {
    no: '02',
    tag: '课后作业',
    title: '批量作业诊断',
    desc: '一节课 40 张作业一次性提交,系统批量完成初筛与标注,教师只需聚焦个性化点评与创作引导。',
  },
  {
    no: '03',
    tag: '学生自学',
    title: '个人成长追踪',
    desc: '学生提交练习后即时获得反馈,历次作业的成长曲线让进步可见,让瓶颈可被识别。',
  },
  {
    no: '04',
    tag: '院校管理',
    title: '教学质量评估',
    desc: '院校管理者通过脱敏的群体数据,洞察教学效果与课程改进方向,数据驱动教研决策。',
  },
];

/**
 * 适用场景区块
 * 墨黑背景 + 玻璃卡片 + 渐变边框光 + 立体层次
 * 与宣纸白主体形成水墨阴阳对比
 */
export function Scenarios() {
  return (
    <Section spacing="lg" background="ink" contained={false}>
      {/* 装饰层 1:水墨晕染(视差,慢速移动) */}
      <Parallax distance={40} className="absolute right-0 top-0 h-full w-1/2">
        <InkDecoration variant="mist" color="cinnabar" opacity={0.12} className="h-full w-full" />
      </Parallax>
      {/* 装饰层 2:科技感网格(深色版) */}
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
            适用场景
          </span>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.25em] text-paper-200/30">
            Use Scenarios
          </p>
          <h2 className="mt-2 text-display-md font-semibold leading-tight text-paper-50">
            从课堂到院校,贯穿艺术教学全链路
          </h2>
          <p className="mt-5 text-base leading-relaxed text-paper-200/70 md:text-lg">
            丹青有AI 服务于高校艺术教育的每一个环节——教师、学生、管理者,各取所需,各得其便。
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s, i) => (
            <RevealOnScroll key={s.title} delay={i * 0.1} variant="ink">
              <div className="glass-card-dark group relative h-full p-7">
                {/* 顶部:编号 + 标签 */}
                <div className="flex items-start justify-between">
                  <span className="font-serif text-3xl font-semibold text-paper-200/30 transition-colors duration-500 ease-ink group-hover:text-gold-400/70">
                    {s.no}
                  </span>
                  <span className="inline-block rounded-full border border-gold-400/40 px-3 py-1 text-[11px] tracking-wider text-gold-300 backdrop-blur-sm">
                    {s.tag}
                  </span>
                </div>

                {/* 标题与描述 */}
                <h3 className="mt-6 text-xl font-semibold text-paper-50">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-paper-200/60">{s.desc}</p>

                {/* 底部装饰:渐变金线 + 箭头 */}
                <div className="mt-6 flex items-center gap-2">
                  <span className="h-px w-0 bg-gradient-to-r from-gold-400 to-transparent transition-all duration-500 ease-ink group-hover:w-10" />
                  <span className="text-gold-400 opacity-0 transition-all duration-500 ease-ink group-hover:translate-x-0 group-hover:opacity-100 -translate-x-2">
                    →
                  </span>
                </div>

                {/* hover 时显现的角标装饰 */}
                <div className="pointer-events-none absolute right-5 top-5 h-8 w-8 opacity-0 transition-opacity duration-500 ease-ink group-hover:opacity-100">
                  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M 4 28 L 28 4" stroke="#c9a961" strokeWidth="1" opacity="0.6" />
                    <circle cx="28" cy="4" r="2" fill="#c9a961" opacity="0.8" />
                  </svg>
                </div>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </Section>
  );
}
