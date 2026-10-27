import React from 'react';
import { Section } from './Section';
import { InkDecoration } from './InkDecoration';
import { MagneticButton } from './MagneticButton';
import { CTA_LINKS } from '@/lib/site';

type CTASectionProps = {
  title?: string;
  description?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
};

/**
 * 通用底部 CTA 区块
 * 墨黑背景 + 朱砂主按钮,用于页面转化收口
 */
export function CTASection({
  title = '让 AI 成为你的艺术教学助手',
  description = '3 秒智能分析,专业美院标准。免费试用,无需信用卡。',
  primaryLabel = '立即体验',
  primaryHref = CTA_LINKS.trial,
  secondaryLabel = '预约演示',
  secondaryHref = CTA_LINKS.contactSales,
}: CTASectionProps) {
  return (
    <Section spacing="lg" background="ink" contained={false}>
      <div className="container-content relative">
        {/* 水墨晕染背景 */}
        <InkDecoration
          variant="splash"
          color="cinnabar"
          opacity={0.18}
          className="right-0 top-1/2 h-[120%] w-1/2 -translate-y-1/2"
        />
        <InkDecoration
          variant="mist"
          color="gold"
          opacity={0.12}
          className="left-0 top-0 h-full w-1/3"
        />

        <div className="relative mx-auto max-w-3xl text-center">
          <span className="section-eyebrow justify-center text-gold-400">
            <span style={{ background: 'currentColor' }} className="inline-block h-px w-8" />
            开启智能艺术教育
          </span>
          <h2 className="mt-5 text-display-md font-semibold leading-tight text-paper-50">
            {title}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-paper-200/70 md:text-lg">
            {description}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <MagneticButton
              href={primaryHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full sm:w-auto"
              data-track="cta-section-primary"
            >
              {primaryLabel}
            </MagneticButton>
            {secondaryLabel && (
              <a
                href={secondaryHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-gold w-full sm:w-auto"
                data-track="cta-section-secondary"
              >
                {secondaryLabel}
              </a>
            )}
          </div>
          <p className="mt-6 text-xs text-paper-200/40">
            点击"立即体验"将跳转至丹青有AI 工作台,使用飞书账号登录
          </p>
        </div>
      </div>
    </Section>
  );
}
