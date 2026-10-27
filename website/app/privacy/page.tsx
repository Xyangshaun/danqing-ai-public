import type { Metadata } from 'next';
import { LegalPage } from '@/components/ui/LegalPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';
import { SITE } from '@/lib/site';

export const metadata: Metadata = buildMetadata({
  title: '隐私政策',
  description:
    '丹青有AI 隐私政策:说明我们如何收集、使用、存储与保护用户信息,包括学生作品数据、教学数据与账号信息的处理方式。',
  path: '/privacy',
  keywords: ['隐私政策', '数据保护', '个人信息'],
});

export default function PrivacyPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '隐私政策', url: '/privacy' },
        ])}
      />
      <LegalPage
        title="隐私政策"
        lastUpdated="2026年8月8日"
        intro='丹青有AI(以下简称"我们")高度重视用户隐私。本政策说明我们在官网与产品中如何收集、使用、存储与保护你的信息。使用我们的服务即视为你同意本政策。'
        sections={[
          {
            heading: '我们收集的信息',
            body: (
              <>
                <p>我们收集的信息主要包括:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li><strong>账号信息</strong>:通过飞书 OAuth 登录时获取的姓名、邮箱、头像等基本身份信息。</li>
                  <li><strong>作品数据</strong>:用户上传的学生作业图片及其 AI 诊断结果。</li>
                  <li><strong>使用数据</strong>:页面访问、功能使用、操作日志等用于服务改进的脱敏数据。</li>
                  <li><strong>设备信息</strong>:浏览器类型、操作系统等用于兼容性保障的基础信息。</li>
                </ul>
              </>
            ),
          },
          {
            heading: '信息的使用',
            body: (
              <>
                <p>我们使用收集的信息用于:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li>提供 AI 作业诊断服务及个性化成长曲线功能;</li>
                  <li>改进 AI 模型与产品体验(使用脱敏数据);</li>
                  <li>提供教学数据分析与院校管理功能;</li>
                  <li>保障服务安全、防止滥用与违规行为;</li>
                  <li>遵守法律法规义务。</li>
                </ul>
                <p>我们不会将你的个人信息出售给第三方。</p>
              </>
            ),
          },
          {
            heading: '信息的存储与保护',
            body: (
              <>
                <p>我们采取业界标准的安全措施保护你的信息,包括传输加密、访问控制、数据隔离与定期安全审计。</p>
                <p>院校版用户可选择数据私有化部署,作品与教学数据存储于院校自有服务器。我们遵循多租户数据隔离原则,不同院校之间数据严格隔离。</p>
                <p>尽管我们努力保护信息,但任何互联网传输都无法保证 100% 安全,请理解这一风险。</p>
              </>
            ),
          },
          {
            heading: 'Cookie 与本地存储',
            body: (
              <>
                <p>官网使用必要的 Cookie 与本地存储以维持登录状态与基础功能体验。官网<strong>不使用</strong> LocalStorage 存储业务数据,业务数据均由业务应用通过安全方式处理。</p>
                <p>你可以通过浏览器设置管理或删除 Cookie,但这可能影响部分功能。</p>
              </>
            ),
          },
          {
            heading: '第三方服务',
            body: (
              <>
                <p>我们的服务涉及以下第三方:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li><strong>飞书</strong>:提供 OAuth 登录身份验证,受飞书隐私政策约束;</li>
                  <li><strong>云服务商</strong>:提供计算与存储基础设施;</li>
                  <li><strong>分析服务</strong>:用于聚合统计官网访问行为(脱敏)。</li>
                </ul>
                <p>我们要求所有第三方遵循同等的数据保护标准。</p>
              </>
            ),
          },
          {
            heading: '你的权利',
            body: (
              <>
                <p>根据相关法律法规,你享有以下权利:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li>查询、复制你的个人信息;</li>
                  <li>请求更正不准确的信息;</li>
                  <li>请求删除你的个人信息(法律法规另有规定的除外);</li>
                  <li>撤回授权同意;</li>
                  <li>投诉与举报。</li>
                </ul>
                <p>行使上述权利请通过 {SITE.email} 联系我们。</p>
              </>
            ),
          },
          {
            heading: '未成年人保护',
            body: (
              <p>我们的服务主要面向高校艺术教育场景,用户通常为成年人。若涉及未满 18 周岁的学生作品数据,其使用需经过其所在院校及法定监护人的同意,并由院校负责管理。我们不会主动收集未成年人个人信息。</p>
            ),
          },
          {
            heading: '政策更新',
            body: (
              <p>本政策可能不时更新。重大变更时我们将通过官网公告或邮件通知。继续使用服务即视为你同意更新后的政策。</p>
            ),
          },
        ]}
      />
    </>
  );
}
