import React from 'react';
import { Breadcrumb } from './Breadcrumb';
import { Section } from './Section';
import { SITE } from '@/lib/site';

type LegalSection = {
  heading: string;
  body: React.ReactNode;
};

type LegalPageProps = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

/**
 * 法律文档页面通用布局
 * 用于隐私政策、服务条款等
 */
export function LegalPage({ title, lastUpdated, intro, sections }: LegalPageProps) {
  return (
    <Section spacing="md">
      <div className="mx-auto max-w-prose-cn">
        <Breadcrumb
          items={[
            { name: '首页', href: '/' },
            { name: title, href: '#' },
          ]}
        />

        <header className="mt-8 border-b border-ink-100 pb-8">
          <h1 className="text-display-md font-semibold leading-tight text-ink-900">{title}</h1>
          <p className="mt-3 text-sm text-ink-400">最后更新:{lastUpdated}</p>
          <p className="mt-5 text-base leading-relaxed text-ink-500">{intro}</p>
        </header>

        <div className="mt-10 space-y-10">
          {sections.map((section, index) => (
            <section key={section.heading}>
              <h2 className="flex items-baseline gap-3 text-xl font-semibold text-ink-900">
                <span className="font-serif text-cinnabar-500">{String(index + 1).padStart(2, '0')}</span>
                {section.heading}
              </h2>
              <div className="mt-4 space-y-4 text-[15px] leading-[1.85] text-ink-500">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-16 border-t border-ink-100 pt-8 text-sm text-ink-400">
          如对本{title}有任何疑问,请通过{' '}
          <a
            href={`mailto:${SITE.email}`}
            className="text-cinnabar-600 underline decoration-cinnabar-200 underline-offset-2 hover:text-cinnabar-700"
          >
            {SITE.email}
          </a>{' '}
          与我们联系。
        </footer>
      </div>
    </Section>
  );
}
