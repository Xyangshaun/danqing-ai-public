import React from 'react';
import { GALLERY_ART } from '@/lib/artworks';
import { Section, SectionHeader } from '@/components/ui/Section';
import { RevealGroup, RevealItem } from '@/components/ui/RevealGroup';
import { ResilientImage } from '@/components/ui/ResilientImage';

/**
 * 艺术画廊专区
 * 以水墨画作展示丹青有AI 所理解的多元艺术形式,增强品牌调性与视觉吸引力。
 * - 四幅竖版画作横向陈列,悬停浮起 + 轻微缩放
 * - 每幅配题字(画作名 + 艺术术语)
 * - 交错入场,克制而动
 */
export function ArtGallery() {
  return (
    <Section spacing="lg" id="gallery">
      <SectionHeader
        eyebrow="水墨之境"
        subtitleEn="Ink Gallery"
        title={<>丹青有AI 所理解的艺术</>}
        description="从山水到花鸟,从写意到雕塑——专业 AI 视觉模型,读懂每一种艺术语言。"
        align="center"
      />

      <RevealGroup className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {GALLERY_ART.map((artItem, i) => (
          <RevealItem key={artItem.title} variant="ink">
            <figure className="group relative overflow-hidden rounded-lg bg-paper-200 shadow-ink-sm transition-shadow duration-500 ease-ink hover:shadow-ink-lg">
              {/* 画作 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <ResilientImage
                localSrc={artItem.url}
                alt={`${artItem.title}水墨画作`}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition-transform duration-700 ease-ink group-hover:scale-[1.06]"
              />
              {/* 悬停扫光:斜向光带从左滑向右,似宣纸反光 */}
              <div
                className="pointer-events-none absolute inset-0 translate-x-[-130%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-paper-50/25 to-transparent transition-transform duration-1000 ease-ink group-hover:translate-x-[130%]"
                aria-hidden="true"
              />
              {/* 底部渐变遮罩 */}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-900/70 via-ink-900/20 to-transparent" />
              {/* 题字层 */}
              <figcaption className="absolute inset-x-0 bottom-0 p-5">
                <div className="flex items-end justify-between">
                  <div className="transition-transform duration-500 ease-ink group-hover:-translate-y-1">
                    <span className="block font-serif text-2xl font-semibold text-paper-50">
                      {artItem.title}
                    </span>
                    <span className="mt-1 block text-xs tracking-[0.2em] text-gold-300/90">
                      {artItem.subtitle}
                    </span>
                  </div>
                  {/* 序号 */}
                  <span className="font-serif text-3xl font-semibold text-paper-50/30 transition-colors duration-500 group-hover:text-gold-300/60">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              </figcaption>
            </figure>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}