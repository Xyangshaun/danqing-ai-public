import React from 'react';

type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

/**
 * JSON-LD 结构化数据注入组件
 * 用于 Organization / Product / FAQ / BreadcrumbList / Article 等
 */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // JSON-LD 是静态结构化数据,内容受开发者控制,可安全注入
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
