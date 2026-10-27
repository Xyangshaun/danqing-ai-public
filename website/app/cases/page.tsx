import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CTASection } from '@/components/ui/CTASection';
import { SITE } from '@/lib/site';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: '客户案例 - 一线美术教师的 AI 辅助评图实践',
  description:
    '针对一线美术教师"批改工作量大、反馈滞后、评价主观、过程性数据缺失"四大痛点打磨的 AI 辅助评图工具。与美术学院国画、油画、版画、设计、雕塑等专业学生、教师及艺术爱好者小范围试用,案例数据为推演估算,非真实院校部署统计。',
  path: '/cases',
  keywords: ['客户案例', '高校艺术教育', '教师减负', '学生成长', '教学实践', 'AI 评图'],
});

const CASES = [
  {
    tag: '综合大学 · 艺术学院',
    title: '某综合性大学艺术学院:基础课评图效率提升 62%',
    summary:
      '在素描、色彩两门基础课中部署丹青有AI,教师评图时间从每份 4.2 分钟降至 1.6 分钟,反馈及时性从 3-5 天缩短到即时。',
    metrics: [
      { value: '62%', label: '评图时间下降' },
      { value: '65h', label: '教师学期节省' },
      { value: '3.5天→即时', label: '反馈周期' },
    ],
    quote:
      '以前评到后半程,评语会越来越短。现在 AI 给了基础诊断,我反而能在每张作业上给出更具体的建议。',
    author: '基础课教研组负责人',
  },
  {
    tag: '专业美院 · 设计学院',
    title: '某专业美院设计学院:四形式全覆盖的诊断实践',
    summary:
      '设计学院课程横跨平面设计、产品设计、雕塑多形式,丹青有AI 的多形式模型让一门课程的多元作业都能获得专业诊断。',
    metrics: [
      { value: '4种', label: '创意形式覆盖' },
      { value: '96%', label: '教师满意度' },
      { value: '1.6万', label: '学期分析量' },
    ],
    quote:
      '过去不同形式的作业要不同老师评,现在 AI 先做结构化初筛,我们再各自发挥专业判断,效率与深度都上来了。',
    author: '设计学院副教授',
  },
  {
    tag: '师范院校 · 美术系',
    title: '某师范院校美术系:学生成长曲线让进步可见',
    summary:
      '面向未来将走向讲台的师范生,成长曲线帮助他们既看见自己的进步,也理解"如何用数据反馈引导学生"——这是双重收获。',
    metrics: [
      { value: '78%', label: '作业修改率' },
      { value: '+41%', label: '练习主动性' },
      { value: '4.8/5', label: '学生评分' },
    ],
    quote:
      '我练了一个月素描感觉没进步,看成长曲线才发现"明暗关系"在上升,只是"构图"在平台期——原来不是没进步,是进步藏在另一个维度。',
    author: '美术系大三学生',
  },
];

/**
 * 客户案例页·成效展示
 * 现状维度(前 2 项):不用数字,只描述"什么人群"在试用
 * 预期维度(后 2 项):保留数字,贴合一线教师痛点的产品能力推演
 * 数字均为产品试用阶段推演,非真实院校部署统计
 */
type Outcome = { value?: string; text?: string; label: string; desc?: string };

const OUTCOMES: Outcome[] = [
  // 现状:只说"什么人群"在试用(不报数量,贴合"小范围试用"语境)
  { text: '美院学生 · 教师 · 艺术爱好者', label: '试用人群', desc: '院校师生与自学人群' },
  { text: '国画·油画·版画·设计·雕塑', label: '覆盖专业', desc: '不同专业方向' },
  // 预期:32 高校规模推演(贴合真实痛点)
  { value: '60+', label: '单校批改节省(小时/学期)', desc: '针对"批改工作量大"痛点' },
  { value: '3秒', label: 'AI 即时反馈响应', desc: '针对"反馈滞后"痛点' },
];

export default function CasesPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '客户案例', url: '/cases' },
        ])}
      />

      <PageHeader
        breadcrumb={[
          { name: '首页', href: '/' },
          { name: '客户案例', href: '/cases' },
        ]}
        eyebrow="客户案例"
        title={<>美术学院不同专业的真实试用</>}
        description="针对一线美术教师批改工作量大、反馈滞后、评价主观、过程性数据缺失四大痛点设计 AI 辅助诊断;与美术学院国画、油画、版画、设计、雕塑等专业学生、教师及艺术爱好者小范围试用,案例数据均为推演估算。"
      />

      {/* 成效汇总 */}
      <Section spacing="md">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 md:gap-x-10">
          {OUTCOMES.map((o, i) => (
            <RevealOnScroll key={o.label} delay={i * 0.08} variant="blur" className="text-center">
              {o.text ? (
                // 人群描述:用较小字号(text-xl/2xl),避免溢出
                <div
                  className="font-serif text-xl font-semibold leading-tight text-ink-900 md:text-2xl"
                  title={o.text}
                >
                  {o.text}
                </div>
              ) : (
                <div className="stat-number text-ink-900">{o.value}</div>
              )}
              <p className="mt-3 text-sm font-medium text-ink-700">{o.label}</p>
              <p className="mt-1 text-xs text-ink-400">{o.desc}</p>
            </RevealOnScroll>
          ))}
        </div>
        <p className="mt-10 text-center text-xs text-ink-300 max-w-2xl mx-auto">
          * 案例数据为产品试用阶段小范围推演估算,基于一线美术教师"批改工作量大、反馈滞后、评价主观、过程性数据缺失"四大痛点设计。
          非真实院校部署统计,仅供产品能力参考。
        </p>
      </Section>

      {/* 案例详情 */}
      <Section spacing="lg" background="muted">
        <SectionHeader
          eyebrow="应用案例"
          title={<>三个院系,三种改变</>}
          description="从基础课到多元形式,从教师减负到学生成长——不同场景下的真实成效。"
        />
        <div className="mt-16 space-y-10">
          {CASES.map((c, i) => (
            <RevealOnScroll key={c.title} variant="clip">
              <article className="group relative overflow-hidden rounded-lg border border-ink-100 bg-paper-50 shadow-ink-sm transition-all duration-500 ease-ink hover:shadow-ink-lg hover:border-gold-300/50">
                {/* 悬停扫光:宣纸反光掠过左侧内容区 */}
                <div
                  className="pointer-events-none absolute inset-0 z-10 hidden translate-x-[-130%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-paper-50/15 to-transparent transition-transform duration-1000 ease-ink group-hover:translate-x-[130%] lg:block"
                  aria-hidden="true"
                />
                <div className="grid grid-cols-1 lg:grid-cols-12">
                  <div className="lg:col-span-7 p-8 md:p-10">
                    <span className="inline-flex items-center gap-2 rounded-full bg-paper-200 px-3 py-1 text-xs text-ink-500 transition-colors duration-500 group-hover:bg-gold-100/60">
                      <span className="h-1 w-1 rounded-full bg-cinnabar-400" aria-hidden="true" />
                      {c.tag}
                    </span>
                    <h3 className="mt-4 text-2xl font-semibold leading-snug text-ink-900 transition-transform duration-500 ease-ink group-hover:translate-x-1 md:text-3xl">
                      {c.title}
                    </h3>
                    <p className="mt-5 text-[15px] leading-relaxed text-ink-500">{c.summary}</p>
                    <blockquote className="mt-7 border-l-2 border-gold-400 pl-5">
                      <p className="text-base italic leading-relaxed text-ink-600">"{c.quote}"</p>
                      <footer className="mt-3 text-sm text-ink-400">— {c.author}</footer>
                    </blockquote>
                  </div>
                  <div className="relative overflow-hidden lg:col-span-5 bg-ink-900 p-8 md:p-10">
                    {/* 深色面板顶部金线 + 水墨晕染纹理 */}
                    <div
                      className="pointer-events-none absolute inset-0 opacity-60"
                      style={{
                        background:
                          'radial-gradient(ellipse 80% 50% at 80% 0%, rgba(201,169,97,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 20% 100%, rgba(200,57,46,0.08) 0%, transparent 60%)',
                      }}
                      aria-hidden="true"
                    />
                    <span className="relative text-xs tracking-[0.2em] uppercase text-gold-400">关键成效</span>
                    <div className="relative mt-6 space-y-7">
                      {c.metrics.map((m, mi) => (
                        <div
                          key={m.label}
                          className="transition-transform duration-500 ease-ink group-hover:translate-x-1"
                          style={{ transitionDelay: `${mi * 60}ms` }}
                        >
                          <div className="font-serif text-3xl font-semibold text-paper-50">{m.value}</div>
                          <div className="mt-1 text-sm text-paper-200/60">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      <CTASection
        title="想成为下一个案例吗?"
        description="立即体验,把你的作业交给 AI 诊断;或写封邮件聊聊你的教学场景。"
        primaryLabel="立即体验"
        secondaryLabel={`写邮件 · ${SITE.email}`}
        secondaryHref={`mailto:${SITE.email}?subject=%E6%83%B3%E6%88%90%E4%B8%BA%E4%B8%8B%E4%B8%80%E4%B8%AA%E6%A1%88%E4%BE%8B`}
      />
    </>
  );
}
