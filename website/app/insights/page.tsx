import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CTASection } from '@/components/ui/CTASection';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: '行业洞察 - AI 艺术教育政策、市场与可行性',
  description:
    '梳理 AI+艺术教育领域的国家政策、学术前沿、市场规模与实践案例，结合丹青有AI 产品定位解读赛道增长逻辑与项目可行性。',
  path: '/insights',
  keywords: ['AI 艺术教育', '教育数字化', '人工智能+教育', '美术教育', '艺考培训', '智慧美育', 'AI 作业诊断'],
});

const POLICIES = [
  {
    title: '《“人工智能+教育”行动计划》',
    source: '教育部、国家发改委、工信部、科技部、国家数据局，2026 年 4 月',
    href: 'http://www.moe.gov.cn/srcsite/A16/s3342/202604/t20260410_1433240.html',
    points: [
      '到 2030 年，人工智能与教育深度融合格局基本形成',
      '推动智能技术与教育全要素融合、全过程贯通、全场景覆盖',
      '鼓励“政产学研金”协同，培育高价值、可推广、可复制的应用场景',
      '明确提出人工智能赋能教师教学、学生学习、学校治理与科学研究',
    ],
  },
  {
    title: '《教育强国建设规划纲要（2024—2035年）》',
    source: '中共中央、国务院，2025 年 1 月',
    href: 'https://www.gov.cn/zhengce/202501/content_6999914.htm',
    points: [
      '教育数字化被确立为建设教育强国的核心突破口',
      '促进人工智能助力教育变革',
      '推动优质教育资源普惠共享，深化教育评价改革',
    ],
  },
  {
    title: '《关于加快推进教育数字化的意见》',
    source: '教育部等九部门，2025 年 4 月',
    href: 'https://hudong.moe.gov.cn/srcsite/A01/s7048/202504/t20250416_1187476.html',
    points: [
      '将生成式 AI 视为深度赋能教学模式变革与科研范式转型的核心路径',
      '增加思政、体育、美育、劳动教育等数字资源供给',
      '推动覆盖课前、课中、课后全环节的智能应用',
    ],
  },
  {
    title: '《关于全面加强和改进新时代学校美育工作的意见》',
    source: '中共中央办公厅、国务院办公厅，2020 年',
    href: 'https://www.gov.cn/zhengce/2020-10/15/content_5551609.htm',
    points: [
      '把美育纳入各级各类学校人才培养全过程',
      '到 2025 年，全国中小学美育课程开课率达到 100%',
      '推动美育与信息技术深度融合',
    ],
  },
];

const MARKET_DATA = [
  {
    value: '3442 亿',
    label: '2025 年中国 GenAI+教育市场规模',
    source: '艾瑞咨询《2026 年中国 GenAI+教育行业发展报告》',
  },
  {
    value: '8910 亿',
    label: '预计 2028 年 GenAI+教育市场规模',
    source: '艾瑞咨询《2026 年中国 GenAI+教育行业发展报告》',
  },
  {
    value: '37%',
    label: '2025-2028 年复合增长率',
    source: '艾瑞咨询《2026 年中国 GenAI+教育行业发展报告》',
  },
  {
    value: '620 亿',
    label: '2024 年中国美术培训市场规模',
    source: '中国报告大厅、博研咨询，2024',
  },
  {
    value: '1800-2500 亿',
    label: '预计 2030 年美术培训市场规模区间',
    source: '中国报告大厅《2026-2031 行业预测》',
  },
  {
    value: '15%',
    label: '2025 年美术培训 AI 辅助教学预计覆盖率',
    source: '博研咨询&市场调研在线网，2025',
  },
];

const CASES = [
  {
    title: '清华大学 ArtEval 系统',
    desc: '从创意性、技术性、文化内涵、情感表达四个维度评估艺术作品，与专家评审一致性系数达 0.89，验证了 AI 艺术评估在专业场景的可行性。',
    source: '《人工智能时代对美术教育的影响及应对策略》，2025',
  },
  {
    title: '上海人工智能实验室 × 中国美术学院 ArtiMuse',
    desc: 'CVPR 2026 发布的美学理解大模型，构建 10K 级细粒度图像美学评估数据集，覆盖构图与设计、原创性与创造力等 8 个维度，同时具备评分与专家级点评能力。',
    source: '上海人工智能实验室 / 中国美术学院，2026',
  },
  {
    title: '中国美术学院“中国画智能体”',
    desc: '与火山引擎联合研发，用数万张中国画精品训练垂类模型，让 AI 理解“留白”“气韵生动”“皴法”等国画概念，已在 2026 世界数字教育大会现场展示。',
    source: '中国美术学院 / 火山引擎，2026',
  },
  {
    title: '中国美术学院出版社“美心美育”AI 绘画课程',
    desc: '入选教育部教育技术与资源发展中心 2025 年度智能化美育应用案例，覆盖中小学、美育机构、社区、美术馆等多元场景。',
    source: '教育部教育技术与资源发展中心，2026',
  },
];

const REASONS = [
  {
    title: '政策窗口明确',
    desc: '从《教育强国建设规划纲要》到《“人工智能+教育”行动计划》，国家层面已将教育数字化和 AI 赋能教育列为战略重点；美育课程开课率要求、智能化美育案例征集为艺术教育 AI 化提供直接落点。',
  },
  {
    title: '刚需痛点真实',
    desc: '高校艺术院系与艺考机构中，一名教师往往面对数十甚至上百份作业，评图负担重、反馈周期长、过程性数据缺失。AI 可承担构图、色彩、笔触等机械性识别与标准对照，让教师回归创造性教学。',
  },
  {
    title: '市场空间可观',
    desc: 'GenAI+教育市场 2025 年已超 3400 亿元，美术培训市场 2024 年达 620 亿元且预计 2030 年迈向 1800-2500 亿元区间；AI 辅助教学覆盖率仍处于早期，渗透空间巨大。',
  },
  {
    title: '技术成熟度提升',
    desc: '多模态大模型、计算机视觉与生成式 AI 在图像理解、风格识别、构图分析上的能力已能满足 3 秒级作业诊断需求；清华 ArtEval、ArtiMuse 等案例已证明 AI 艺术评估的专业可靠性。',
  },
  {
    title: '模式可持续',
    desc: '院校版 SaaS 订阅 + 机构版按诊断量付费 + 未来硬件盒子商业化，形成从软件验证到硬件落地的清晰商业路径；数据沉淀后还可反向优化模型与教学标准。',
  },
  {
    title: '差异化定位清晰',
    desc: '市面上多数 AI 绘画工具以“生成”为导向，而丹青有AI 专注“诊断+教学”，以专业美院标准对齐评价体系，形成难以被通用工具替代的教学闭环。',
  },
];

export default function InsightsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '行业洞察', url: '/insights' },
        ])}
      />

      <PageHeader
        breadcrumb={[
          { name: '首页', href: '/' },
          { name: '行业洞察', href: '/insights' },
        ]}
        eyebrow="行业洞察"
        title={<>AI + 艺术教育：政策、市场与可行性</>}
        description="梳理国家政策、学术前沿、市场规模与实践案例，回答“为什么丹青有AI 这个项目可以做”。"
      />

      {/* 核心论点 */}
      <Section spacing="lg">
        <SectionHeader
          eyebrow="核心结论"
          title="为什么 AI 艺术教育是一个有前景的赛道"
          description="政策支持力度空前、市场需求真实存在、技术能力日趋成熟、商业模式清晰可落地。"
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {REASONS.map((item, i) => (
            <RevealOnScroll key={item.title} delay={i * 0.08} variant="scale">
              <div className="ink-card h-full">
                <h3 className="text-lg font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-500">{item.desc}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      {/* 市场规模 */}
      <Section spacing="lg" background="muted">
        <SectionHeader
          eyebrow="市场规模"
          title="GenAI + 教育与美术培训双重增长"
          description="教育 AI 化正处于高速增长期，艺术教育作为素质教育与升学考试交汇的细分领域，具备明确的付费意愿与数字化空间。"
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MARKET_DATA.map((d, i) => (
            <RevealOnScroll key={d.label} delay={i * 0.08} variant="blur">
              <div className="glass-card p-6 text-center">
                <div className="stat-number text-4xl md:text-5xl">{d.value}</div>
                <p className="mt-2 text-sm font-medium text-ink-600">{d.label}</p>
                <p className="mt-1 text-xs text-ink-400">{d.source}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      {/* 政策依据 */}
      <Section spacing="lg">
        <SectionHeader
          eyebrow="政策依据"
          title="国家级政策连续加码 AI 与教育数字化"
          description="从教育强国战略到行动计划，AI 赋能教育已从“鼓励探索”进入“系统部署”阶段，美育数字化是其中的重要组成。"
        />
        <div className="mt-12 space-y-6">
          {POLICIES.map((p, i) => (
            <RevealOnScroll key={p.title} delay={i * 0.08} variant="ink">
              <div className="ink-card">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <h3 className="text-lg font-semibold text-ink-900">{p.title}</h3>
                  <span className="text-xs text-ink-400">{p.source}</span>
                </div>
                <ul className="mt-4 space-y-2">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3 text-sm text-ink-500">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cinnabar-500" />
                      {pt}
                    </li>
                  ))}
                </ul>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-block text-sm font-medium text-cinnabar-600 underline decoration-cinnabar-200 underline-offset-2 hover:text-cinnabar-700"
                >
                  查看原文 →
                </a>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      {/* 实践案例 */}
      <Section spacing="lg" background="muted">
        <SectionHeader
          eyebrow="实践案例"
          title="AI 艺术教育的先行探索"
          description="从高校研究到国家级美育案例，AI 辅助艺术评估与教学已在绘画、书法、数字艺术等场景取得可验证进展。"
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
          {CASES.map((c, i) => (
            <RevealOnScroll key={c.title} delay={i * 0.08} variant="scale">
              <div className="glass-card h-full p-6">
                <h3 className="text-base font-semibold text-ink-900">{c.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-500">{c.desc}</p>
                <p className="mt-4 text-xs text-ink-400">{c.source}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </Section>

      {/* 数据来源声明 */}
      <Section spacing="md">
        <div className="rounded-lg border border-ink-100/60 bg-paper-50/70 p-6 text-sm text-ink-500 backdrop-blur-md">
          <p className="font-medium text-ink-700">数据说明</p>
          <p className="mt-2">
            本页引用的政策、市场数据与学术案例均来自公开渠道，标注了来源与时间。部分市场数据来自行业研报与媒体报道，仅供趋势判断参考，具体数字请以官方统计或第三方机构最新报告为准。
          </p>
        </div>
      </Section>

      <CTASection
        title="与丹青有AI 一起拥抱教育智能化"
        description="政策、技术与市场的三重共振下，AI 艺术教育正迎来最好的时代。"
      />
    </>
  );
}
