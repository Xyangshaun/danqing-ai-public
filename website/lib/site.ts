/**
 * 站点全局常量
 * 注意:官网为纯静态,不包含任何业务 API 端点
 * 所有 CTA 跳转至业务应用前端入口,由业务应用触发飞书 OAuth
 */

export const SITE = {
  name: '丹青有AI',
  nameEn: 'DanQing AI',
  shortName: '丹青',
  slogan: '丹青有AI,让艺术教育更智能',
  description:
    '丹青有AI 是面向高校艺术教育的 AI 作业诊断系统,3 秒智能分析构图、色彩、笔触,支持绘画、设计、产品设计、雕塑四种创意形式,以专业美院标准助力教师减负、学生成长。',
  url: 'https://www.danqing.site',
  // 业务应用入口(由业务应用自身触发飞书 OAuth,官网不接触 OAuth 细节)
  // 2026-08-04 调整:业务应用移至 /app 路径,官网占据根路径
  appUrl: 'https://www.danqing.site/app',
  // 联系方式(2026-08-09 统一为真实联系邮箱)
  email: '2692963779@qq.com',
  salesEmail: '2692963779@qq.com',
  // 社交(占位)
  wechatOfficial: '丹青有AI',
  // 2026-09-02 备案悬挂:工信部 ICP 号(静态)+ 公网安备号(静态)
  icpNumber: '陕ICP备2026023972号',
  // 2026-09-18 公安备案号需重新申请(原编号不符合要求),徽章组件判空自动隐藏;
  // 重新申请通过后将新编号填回此处即可恢复悬挂(图标+编号+链接三要素)
  mpsBeianNumber: '',
} as const;

export const NAV_LINKS = [
  { label: '产品功能', href: '/product' },
  { label: '客户案例', href: '/cases' },
  { label: '价格方案', href: '/pricing' },
  { label: '行业洞察', href: '/insights' },
  { label: '博客资源', href: '/blog' },
  { label: '关于我们', href: '/about' },
] as const;

export const FOOTER_LINKS = {
  product: {
    title: '产品',
    links: [
      { label: '产品功能', href: '/product' },
      { label: '价格方案', href: '/pricing' },
      { label: '客户案例', href: '/cases' },
    ],
  },
  resource: {
    title: '资源',
    links: [
      { label: '行业洞察', href: '/insights' },
      { label: '博客', href: '/blog' },
      { label: '关于我们', href: '/about' },
    ],
  },
  legal: {
    title: '法律',
    links: [
      { label: '隐私政策', href: '/privacy' },
      { label: '服务条款', href: '/terms' },
      // 2026-09-02 公安备案合规:安全管理制度公示(公安部令33号第十条)
      { label: '安全制度', href: '/security' },
    ],
  },
} as const;

/**
 * 业务应用入口链接(触发飞书 OAuth 登录由业务应用处理)
 * 官网仅做跳转,不暴露任何业务 API 端点
 */
export const CTA_LINKS = {
  // 立即体验 / 免费试用 - 跳转业务应用首页(业务应用内部处理登录态)
  // 2026-08-04 调整:业务应用移至 /app 路径
  trial: 'https://www.danqing.site/app/',
  // 预约演示 / 咨询(mailto)
  // 2026-09-02 备案合规:弱化销售话术,sales@danqing.site 邮箱未开通,统一走 QQ 邮箱
  contactSales: 'mailto:2692963779@qq.com?subject=%E9%99%A2%E6%A0%A1%E7%89%88%E6%BC%94%E7%A4%BA%E9%A2%84%E7%BA%A6',
} as const;

/**
 * 获取规范 URL(与 next.config.js trailingSlash:true 保持一致)
 * 页面路径统一以 / 结尾,sitemap/robots/canonical/og:url 均应调用此函数
 */
export function getCanonicalUrl(path: string): string {
  const cleanPath = path === '/' || path === '' ? '' : path.replace(/\/$/, '');
  return cleanPath ? `${SITE.url}${cleanPath}/` : `${SITE.url}/`;
}
