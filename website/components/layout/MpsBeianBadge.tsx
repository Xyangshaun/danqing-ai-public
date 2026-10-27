import Image from 'next/image';
import { SITE } from '@/lib/site';

/**
 * 公网安备号悬挂徽章(公安联网备案合规)
 *
 * 官方规范三要素:公安备案图标 + 编号 + 链接(https://beian.mps.gov.cn/)
 * 图标为公安部备案平台下载的官方资源(/images/mps-beian.png,36x40)。
 * 编号固化于 lib/site.ts(2026-09-15 审核通过);链接带编号直达备案查询页,
 * 与公安平台下发的备案编号 HTML 模板一致。
 */
export function MpsBeianBadge() {
  const number = SITE.mpsBeianNumber.trim();
  if (!number) return null;

  // 链接直达备案查询页并带编号数字(官方模板格式)
  const digits = number.replace(/\D/g, '');
  const href = digits
    ? `https://beian.mps.gov.cn/#/query/webSearch?code=${digits}`
    : 'https://beian.mps.gov.cn/';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="公安备案信息查询"
      className="inline-flex items-center gap-1.5 transition-colors hover:text-paper-200/80"
    >
      <Image
        src="/images/mps-beian.png"
        alt="公安备案图标"
        width={13}
        height={14}
        className="shrink-0"
      />
      <span>{number}</span>
    </a>
  );
}
