import type { Metadata } from 'next';
import { LegalPage } from '@/components/ui/LegalPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: '安全管理制度',
  description:
    '丹青有AI 网络安全保护管理制度公示:安全保护管理制度、用户登记与信息管理制度、违法不良信息处置流程(24小时内向公安机关报告)及用户举报渠道。',
  path: '/security',
  keywords: ['安全管理制度', '网络信息安全', '违法不良信息处置', '公安备案'],
});

/**
 * 安全管理制度公示页(公安联网备案合规)
 * 依据:《计算机信息网络国际联网安全保护管理办法》(公安部令第33号)第十条
 * 要求建立并公示:安全保护管理制度、用户登记与信息管理制度、
 * 违法有害信息处置制度(发现→留存→24小时内报告属地公安机关)
 */
export default function SecurityPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '安全管理制度', url: '/security' },
        ])}
      />
      <LegalPage
        title="安全管理制度"
        lastUpdated="2026年9月2日"
        intro="为落实网络安全保护责任,依据《中华人民共和国网络安全法》《计算机信息网络国际联网安全保护管理办法》(公安部令第33号)等法律法规,丹青有AI 建立以下安全管理制度并予以公示,接受社会监督。"
        sections={[
          {
            heading: '安全保护管理制度',
            body: (
              <>
                <p>本平台建立并执行以下安全保护管理措施:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li>全站强制 HTTPS 加密传输,防止数据在传输链路中被窃取或篡改;</li>
                  <li>服务器部署于境内合规云服务商(腾讯云),由专人负责运维与安全加固;</li>
                  <li>数据库、文件存储实施访问控制与权限最小化原则,敏感信息加密存储;</li>
                  <li>定期检查系统漏洞并更新依赖组件,防范常见 Web 安全风险;</li>
                  <li>网络日志留存不少于六个月(《网络安全法》第二十一条),日志异地备份保存。</li>
                </ul>
              </>
            ),
          },
          {
            heading: '用户登记与信息管理制度',
            body: (
              <>
                <p>本平台对用户实行实名登记管理:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li>用户通过飞书 OAuth(企业实名认证体系)或邮箱注册登录,登记信息包括姓名、账号标识、联系方式等;</li>
                  <li>用户登记信息依法保密,仅用于身份识别与账号安全,不向第三方出售或非法提供;</li>
                  <li>用户注销账号后,其个人信息在合理期限内删除或匿名化处理;</li>
                  <li>发现账号被冒用、盗用的,可联系平台核查处置。</li>
                </ul>
              </>
            ),
          },
          {
            heading: '违法不良信息处置流程',
            body: (
              <>
                <p>对用户上传内容中的违法不良信息,本平台按以下流程处置:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li><strong>发现</strong>:通过系统巡查、用户举报等渠道发现涉嫌违法不良信息的内容;</li>
                  <li><strong>留存</strong>:先行保存原始记录(含上传时间、账号、内容等)及相关日志证据;</li>
                  <li><strong>报告</strong>:在发现之时起<strong>24小时内</strong>向属地公安机关报告,并按要求提供相关材料;</li>
                  <li><strong>处置</strong>:视情况对违法内容采取删除、屏蔽、暂停账号等措施;</li>
                  <li><strong>记录</strong>:处置全过程记录留存,以备公安机关核查。</li>
                </ul>
              </>
            ),
          },
          {
            heading: '用户举报渠道',
            body: (
              <>
                <p>任何单位和个人发现本平台存在违法不良信息或违反本制度的行为,均可通过以下渠道举报:</p>
                <ul className="list-disc space-y-2 pl-6">
                  <li>举报邮箱:<a href="mailto:2692963779@qq.com?subject=%E8%BF%9D%E6%B3%95%E4%B8%8D%E8%89%AF%E4%BF%A1%E6%81%AF%E4%B8%BE%E6%8A%A5" className="text-cinnabar-600 underline decoration-cinnabar-200 underline-offset-2">2692963779@qq.com</a>(邮件主题注明"违法不良信息举报");</li>
                  <li>应用内"投诉举报"入口(登录页及应用内均可发起);</li>
                  <li>平台收到举报后将在 24 小时内核查处理,涉违法信息的按上述流程向公安机关报告。</li>
                </ul>
              </>
            ),
          },
          {
            heading: '制度执行与责任',
            body: (
              <>
                <p>本平台指定专人负责网络安全保护工作,落实上述各项制度。对不履行安全保护职责、造成危害后果的,将依法承担相应责任。</p>
                <p>本制度自公示之日起施行,如有更新将以页面更新日期为准。</p>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
