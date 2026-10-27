import type { Metadata } from 'next';
import { HeroWithIntro } from '@/components/home/HeroWithIntro';
import { CoreValue } from '@/components/home/CoreValue';
import { ArtGallery } from '@/components/home/ArtGallery';
import { CreativeForms } from '@/components/home/CreativeForms';
import { FeatureShowcase } from '@/components/home/FeatureShowcase';
import { Scenarios } from '@/components/home/Scenarios';
import { DataEndorsement } from '@/components/home/DataEndorsement';
import { FutureDirection } from '@/components/home/FutureDirection';
import { CTASection } from '@/components/ui/CTASection';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, productJsonLd, faqJsonLd, websiteJsonLd } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: '丹青有AI | 让艺术教育更智能',
  description:
    '丹青有AI 是面向高校艺术教育的 AI 作业诊断系统,3 秒智能分析构图、色彩、笔触,支持绘画、设计、产品设计、雕塑四种创意形式,以专业美院标准助力教师减负、学生成长。',
  path: '/',
  keywords: [
    'AI 艺术教育',
    '艺术作业诊断系统',
    '高校美术教学',
    '绘画 AI 评图',
    '3 秒智能分析',
  ],
});

const HOME_FAQ = [
  {
    question: '丹青有AI 支持哪些艺术形式?',
    answer:
      '系统支持绘画、设计、产品设计、雕塑四种创意形式的智能分析,针对每种形式建立专属视觉分析模型。',
  },
  {
    question: 'AI 分析一张作业需要多长时间?',
    answer:
      '从作业上传到生成诊断报告,全程 3 秒级响应,让学生在创作记忆鲜活时即刻获得反馈。',
  },
  {
    question: 'AI 评图会替代教师吗?',
    answer:
      '不会。AI 承接的是机械性的视觉特征识别与标准对照,教师聚焦于情感表达、文化语境与创作引导等需要人文判断的环节。',
  },
  {
    question: '如何开始使用?',
    answer:
      '点击"立即体验"跳转至丹青有AI 工作台,使用飞书账号登录即可。免费版每月含 50 次分析额度。',
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={productJsonLd()} />
      <JsonLd data={faqJsonLd(HOME_FAQ)} />

      <HeroWithIntro />
      <CoreValue />
      <ArtGallery />
      <CreativeForms />
      <FeatureShowcase />
      <Scenarios />
      <DataEndorsement />
      <FutureDirection />
      <CTASection
        title="免费试用,无需信用卡"
        description="3 秒智能分析,专业美院标准。即刻体验 AI 如何改变艺术作业诊断。"
      />
    </>
  );
}
