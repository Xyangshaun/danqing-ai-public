import React from 'react';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { TiltCard } from '@/components/ui/TiltCard';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { CTA_LINKS } from '@/lib/site';

const IMG_ROOT = '/images';

/** 绘画:特色大卡 */
const PAINTING_IMG = `${IMG_ROOT}/gallery-flower.jpg`;

/** 设计:小卡 */
const DESIGN_IMG = `${IMG_ROOT}/gallery-lotus.jpg`;

/** 产品设计:小卡 */
const PRODUCT_IMG = `${IMG_ROOT}/gallery-mountain.jpg`;

/** 雕塑:宽幅卡 */
const SCULPTURE_IMG = `${IMG_ROOT}/gallery-sculpture.jpg`;

type FormItem = {
  title: string;
  hanzi: string;
  desc: string;
  tags: string[];
  img: string;
  imgAlt: string;
  badge: string;
  spanClass: string;
};

const FORMS: FormItem[] = [
  {
    title: '设计',
    hanzi: '設',
    desc: '版式、色彩与视觉层级的智能评估,识别视觉重心与信息流。',
    tags: ['版式', '色彩', '层级'],
    img: DESIGN_IMG,
    imgAlt: '平面设计作业 AI 分析示意',
    badge: '平面',
    spanClass: 'bento-cell',
  },
  {
    title: '产品设计',
    hanzi: '器',
    desc: '形态、人因与结构合理性的多角度诊断,匹配工业设计规范。',
    tags: ['形态', '人因', '结构'],
    img: PRODUCT_IMG,
    imgAlt: '产品设计作业 AI 分析示意',
    badge: '工业',
    spanClass: 'bento-cell',
  },
];

const SCULPTURE: FormItem = {
  title: '雕塑',
  hanzi: '塑',
  desc: '三维形态、体量与空间关系的视觉理解,支持多视角上传与体积感评估。',
  tags: ['三维形态', '体量', '空间关系', '多视角'],
  img: SCULPTURE_IMG,
  imgAlt: '雕塑作业 AI 多视角分析示意',
  badge: '立体',
  spanClass: 'bento-cell-wide',
};

/**
 * 创作形式区块:Bento Grid 布局
 * - 绘画(特色大卡,4×2)+ 设计 / 产品设计(小卡,2×1)+ 雕塑(宽幅卡,6×1)
 * - 每张卡片用 TiltCard 包裹,悬停 3D 倾斜 + 光斑跟随
 * - 图片渐变遮罩 + badge + 汉字图标 + 标题 + 描述 + 标签
 */
export function CreativeForms() {
  return (
    <Section spacing="lg" background="muted" id="creative-forms">
      <SectionHeader
        eyebrow="创作形式"
        subtitleEn="Creative Forms"
        title={<>四种创意形式,一套专业诊断</>}
        description="绘画、设计、产品设计、雕塑——针对每种形式的视觉语言建立专属分析模型,贴合高校艺术教育的多元课程。"
      />

      <div className="mt-16 bento-grid">
        {/* 绘画:特色大卡 */}
        <RevealOnScroll variant="clip" className="bento-cell-featured bento-cell-featured-wrap">
          <TiltCard className="group h-full">
            <div className="bento-visual h-full min-h-[320px] rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <ResilientImage localSrc={PAINTING_IMG} alt="绘画作业 AI 构图色彩笔触分析示意" loading="lazy" />
              <div className="bento-overlay" />
              {/* 内容层 */}
              <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
                <div className="flex items-center gap-2">
                  <span className="bento-badge">特色 · 绘画</span>
                  <span className="bento-badge">16:9</span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <span className="block font-serif text-5xl font-semibold text-gold-300/90 md:text-6xl">
                      繪
                    </span>
                    <h3 className="mt-2 text-2xl font-semibold text-paper-50 md:text-3xl">
                      绘画
                    </h3>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-paper-200/75 md:text-[15px]">
                      构图、色彩、笔触三维度深度诊断,对齐美院基础教学规范。
                    </p>
                  </div>
                  <a
                    href={CTA_LINKS.trial}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-magnetic shrink-0"
                    data-track="home-forms-painting"
                    aria-label="体验绘画诊断"
                  >
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-cinnabar-500 text-paper-50 transition-transform duration-300 group-hover:translate-x-1">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M5 10h10M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </TiltCard>
        </RevealOnScroll>

        {/* 设计 / 产品设计:两个小卡 */}
        {FORMS.map((form, i) => (
          <RevealOnScroll key={form.title} delay={0.1 + i * 0.1} variant="clip" className={`${form.spanClass} bento-cell-wrap`}>
            <TiltCard className="group h-full">
              <div className="bento-visual h-full min-h-[200px] rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <ResilientImage localSrc={form.img} alt={form.imgAlt} loading="lazy" />
                <div className="bento-overlay" />
                <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-6">
                  <span className="bento-badge self-start">{form.badge}</span>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="font-serif text-3xl font-semibold text-gold-300/90">
                      {form.hanzi}
                    </span>
                    <h3 className="text-xl font-semibold text-paper-50">{form.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-paper-200/75">{form.desc}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-ink bg-white/10 px-2 py-0.5 text-[11px] text-paper-200/80 backdrop-blur-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </TiltCard>
          </RevealOnScroll>
        ))}

        {/* 雕塑:宽幅卡(整行 banner) */}
        <RevealOnScroll variant="clip" className={`${SCULPTURE.spanClass} bento-cell-wrap`}>
          <TiltCard className="group h-full">
            <div className="bento-visual h-full min-h-[220px] rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <ResilientImage localSrc={SCULPTURE.img} alt={SCULPTURE.imgAlt} loading="lazy" />
              <div className="bento-overlay" />
              <div className="absolute inset-0 flex flex-col justify-between p-6 md:flex-row md:items-end md:p-8">
                <div className="max-w-xl">
                  <span className="bento-badge self-start">{SCULPTURE.badge}</span>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="font-serif text-4xl font-semibold text-gold-300/90">
                      {SCULPTURE.hanzi}
                    </span>
                    <h3 className="text-2xl font-semibold text-paper-50 md:text-3xl">
                      {SCULPTURE.title}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-paper-200/75 md:text-[15px]">
                    {SCULPTURE.desc}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5 md:mt-0 md:justify-end">
                  {SCULPTURE.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-ink bg-white/10 px-2 py-0.5 text-[11px] text-paper-200/80 backdrop-blur-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </TiltCard>
        </RevealOnScroll>
      </div>
    </Section>
  );
}
