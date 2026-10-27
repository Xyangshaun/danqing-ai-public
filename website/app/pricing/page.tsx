import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CTASection } from '@/components/ui/CTASection';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd, faqJsonLd } from '@/lib/seo';
import { CTA_LINKS } from '@/lib/site';

export const metadata: Metadata = buildMetadata({
  title: '价格方案 - 免费版 / 标准版 / 院校版',
  description:
    '丹青有AI 提供免费版、标准版(教师 ¥99/月)、院校版三档套餐。免费版每月 50 次分析,标准版 2000 次全功能,院校版无限次定制服务。',
  path: '/pricing',
  keywords: ['价格', '套餐', '免费版', '标准版', '院校版', '教师版'],
});

type Plan = {
  name: string;
  tagline: string;
  price: string;
  period: string;
  cta: { label: string; href: string };
  highlight?: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    name: '免费版',
    tagline: '个人体验与轻度使用',
    price: '¥0',
    period: '/ 永久免费',
    cta: { label: '开始试用', href: CTA_LINKS.trial },
    features: [
      '每月 50 次 AI 分析',
      '构图 / 色彩 / 笔触基础诊断',
      '绘画与设计两种形式',
      '单用户使用',
      '社区支持',
    ],
  },
  {
    name: '标准版(教师)',
    tagline: '一线艺术教师的专业选择',
    price: '¥99',
    period: '/ 月',
    cta: { label: '内测免费体验', href: CTA_LINKS.trial },
    highlight: true,
    features: [
      '每月 2000 次 AI 分析',
      '三大维度深度诊断 + 可视化标注',
      '绘画 / 设计 / 产品设计 / 雕塑四形式',
      '班级管理与学生成长曲线',
      '灵感融合系统',
      '批量作业处理',
      '优先邮件支持',
    ],
  },
  {
    name: '院校版',
    tagline: '为院系与院校量身定制',
    price: '定制',
    period: '/ 预约演示',
    cta: { label: '预约演示', href: CTA_LINKS.contactSales },
    features: [
      '无限次 AI 分析',
      '全功能 + 高级定制',
      '多院系 / 多角色权限管理',
      '教学质量数据分析看板',
      '专属对接与培训',
      'SLA 服务保障',
      '数据私有化部署可选',
    ],
  },
];

const COMPARISON = [
  { feature: '每月 AI 分析次数', free: '50 次', standard: '2000 次', enterprise: '无限' },
  { feature: '分析维度', free: '基础', standard: '深度 + 可视化', enterprise: '深度 + 可视化' },
  { feature: '支持创意形式', free: '绘画 / 设计', standard: '全部四种', enterprise: '全部四种' },
  { feature: '班级管理', free: '—', standard: '✓', enterprise: '✓' },
  { feature: '学生成长曲线', free: '—', standard: '✓', enterprise: '✓' },
  { feature: '灵感融合系统', free: '—', standard: '✓', enterprise: '✓' },
  { feature: '批量作业处理', free: '—', standard: '✓', enterprise: '✓' },
  { feature: '多院系权限管理', free: '—', standard: '—', enterprise: '✓' },
  { feature: '教学质量看板', free: '—', standard: '—', enterprise: '✓' },
  { feature: '专属对接与培训', free: '—', standard: '—', enterprise: '✓' },
  { feature: 'SLA 服务保障', free: '—', standard: '—', enterprise: '✓' },
  { feature: '支持方式', free: '社区', standard: '优先邮件', enterprise: '专属对接' },
];

const PRICING_FAQ = [
  {
    question: '免费版有什么限制?',
    answer: '免费版每月提供 50 次 AI 分析,支持绘画与设计两种形式的基础诊断,适合个人体验。升级到标准版可解锁全部功能。',
  },
  {
    question: '标准版 2000 次分析够用吗?',
    answer: '以一位教师每周评阅 100 张作业计算,一月约 400-500 次,2000 次额度可覆盖 4-5 位教师的常规教学需求。',
  },
  {
    question: '院校版如何计费?',
    answer: '院校版将根据院系规模、用户数量与定制需求灵活计费。目前处于内测阶段,欢迎联系我们预约演示,我们将按院系情况介绍方案(内测期间不产生任何费用)。',
  },
  {
    question: '现在需要付费吗?',
    answer: '不需要。本产品目前处于内测阶段,未开通任何付费渠道,页面中的价格信息仅为产品规划预览;正式开通付费前,我们将在网站提前公示并同步更新服务条款。',
  },
  {
    question: '分析次数用完了怎么办?',
    answer: '当月额度用完后,可等待次月自动重置,或升级到更高套餐。院校版为无限次,不存在此问题。',
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '价格方案', url: '/pricing' },
        ])}
      />
      <JsonLd data={faqJsonLd(PRICING_FAQ)} />

      <PageHeader
        breadcrumb={[
          { name: '首页', href: '/' },
          { name: '价格方案', href: '/pricing' },
        ]}
        eyebrow="价格方案"
        title={<>按需选择,从免费开始</>}
        description="个人体验免费,教师专业版内测期间免费体验,院校版支持预约演示。"
      />

      {/* 三档套餐卡片 */}
      <Section spacing="md">
        <div className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <RevealOnScroll key={plan.name} delay={i * 0.12} variant="scale">
              <div
                className={`group relative flex h-full flex-col rounded-lg p-8 transition-all duration-500 ease-ink ${
                  plan.highlight
                    ? 'ink-card !overflow-visible border-2 !border-cinnabar-500/70 lg:-translate-y-4 lg:hover:-translate-y-6'
                    : 'ink-card'
                }`}
              >
                {/* 推荐卡:顶部朱砂渐变缎带 + 印章式"荐"角标 */}
                {plan.highlight ? (
                  <>
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-lg"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent 0%, #c8392e 20%, #d85f50 50%, #c8392e 80%, transparent 100%)',
                      }}
                      aria-hidden="true"
                    />
                    <span className="absolute -top-3.5 left-1/2 flex h-9 w-9 -translate-x-1/2 rotate-[-4deg] items-center justify-center rounded-sm bg-cinnabar-500 font-serif text-base font-bold text-paper-50 shadow-ink transition-transform duration-500 ease-ink group-hover:rotate-0">
                      荐
                    </span>
                  </>
                ) : (
                  /* 非推荐卡:右上角金色角饰,悬停显现 */
                  <div
                    className="pointer-events-none absolute right-0 top-0 h-10 w-10 opacity-0 transition-opacity duration-500 ease-ink group-hover:opacity-100"
                    style={{
                      background:
                        'linear-gradient(225deg, rgba(201,169,97,0.28) 0%, transparent 55%)',
                    }}
                    aria-hidden="true"
                  />
                )}
                <h3 className="text-xl font-semibold text-ink-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-ink-400">{plan.tagline}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span
                    className={`font-serif text-5xl font-semibold ${
                      plan.highlight ? 'text-cinnabar-500' : 'text-ink-900'
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span className="text-sm text-ink-400">{plan.period}</span>
                </div>
                <a
                  href={plan.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-7 w-full ${plan.highlight ? 'btn-primary' : 'btn-secondary'}`}
                  data-track={`pricing-${plan.name}`}
                >
                  {plan.cta.label}
                </a>
                <ul className="mt-8 space-y-3.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm text-ink-600">
                      <svg className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? 'text-cinnabar-500' : 'text-gold-500'}`} viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </RevealOnScroll>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-ink-400">
          所有套餐均含基础安全保障,院校版支持数据私有化部署可选。
          <br />
          本产品目前处于内测阶段,未开通任何在线付费渠道;页面中的价格与"订阅"字样仅为产品规划预览,
          不构成收费要约,正式收费前将在本页与服务条款中提前公示。
        </p>
      </Section>

      {/* 功能对比表 */}
      <Section spacing="lg" background="muted">
        <RevealOnScroll variant="blur">
          <h2 className="text-display-md font-semibold leading-tight text-ink-900">功能对比详情</h2>
        </RevealOnScroll>
        <RevealOnScroll variant="scale" className="mt-10">
          <div className="ink-card !p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-ink-200/80">
                    <th className="rounded-tl-lg bg-paper-200/60 py-4 pl-8 pr-4 text-left text-sm font-medium text-ink-500">
                      功能
                    </th>
                    <th className="bg-paper-200/60 px-4 py-4 text-center text-sm font-semibold text-ink-700">免费版</th>
                    <th className="bg-paper-200/60 px-4 py-4 text-center text-sm font-semibold text-cinnabar-600">标准版</th>
                    <th className="rounded-tr-lg bg-paper-200/60 px-4 py-4 text-center text-sm font-semibold text-ink-700">院校版</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr
                      key={row.feature}
                      className="group border-b border-ink-100/60 transition-colors duration-300 last:border-0 hover:bg-gold-50/40"
                    >
                      <td className="py-4 pl-8 pr-4 text-sm text-ink-700">{row.feature}</td>
                      <td className="px-4 py-4 text-center text-sm text-ink-500">{row.free}</td>
                      <td className="bg-cinnabar-50/30 px-4 py-4 text-center text-sm font-medium text-ink-800">
                        {row.standard}
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-ink-500">{row.enterprise}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </RevealOnScroll>
      </Section>

      {/* FAQ:原生 details 手风琴,展开收起带箭头旋转 */}
      <Section spacing="lg">
        <RevealOnScroll variant="blur">
          <h2 className="text-display-md font-semibold leading-tight text-ink-900">常见问题</h2>
        </RevealOnScroll>
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {PRICING_FAQ.map((faq, i) => (
            <RevealOnScroll key={faq.question} delay={i * 0.06} variant="scale">
              <details className="group rounded-lg border border-ink-100/80 bg-paper-50/85 backdrop-blur-md transition-all duration-300 ease-ink open:border-gold-300 open:shadow-ink [&::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 text-base font-semibold text-ink-900 transition-colors duration-300 hover:text-cinnabar-600 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                    {/* 墨点:收起态显示 */}
                    <span className="absolute h-1.5 w-1.5 rounded-full bg-gold-400 transition-all duration-300 group-open:scale-0 group-open:opacity-0" />
                    {/* 竖线:展开态旋转为十字隐去,形成"+"到"—"过渡 */}
                    <svg
                      className="h-4 w-4 text-ink-400 transition-transform duration-300 ease-ink group-open:rotate-45 group-open:text-cinnabar-500"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="px-6 pb-6 text-sm leading-[1.85] text-ink-500">{faq.answer}</p>
              </details>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      <CTASection
        title="还有疑问?联系我们预约演示"
        description="无论你是个人教师还是院校管理者,我们都乐意为你介绍产品并安排演示。"
        primaryLabel="开始免费试用"
        secondaryLabel="预约演示"
      />
    </>
  );
}
