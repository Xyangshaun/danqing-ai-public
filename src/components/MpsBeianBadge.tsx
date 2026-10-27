import mpsBeianIcon from '../assets/mps-beian.png';

/**
 * 公网安备号悬挂徽章(公安联网备案合规)
 *
 * 官方规范三要素:公安备案图标 + 编号 + 链接(https://beian.mps.gov.cn/)
 * 图标为公安部备案平台下载的官方资源(src/assets/mps-beian.png,36x40)。
 * 编号固化于此;链接带编号直达备案查询页,与公安平台下发的备案编号 HTML 模板一致。
 * 2026-09-18:原编号不符合要求需重新申请,清空后组件判空自动隐藏;
 * 重新申请通过后将新编号填回此处即可恢复悬挂。
 */
const MPS_BEIAN_NUMBER: string = '';

export function MpsBeianBadge() {
  if (!MPS_BEIAN_NUMBER) return null;

  // 链接直达备案查询页并带编号数字(官方模板格式)
  const digits = MPS_BEIAN_NUMBER.replace(/\D/g, '');
  const href = digits
    ? `https://beian.mps.gov.cn/#/query/webSearch?code=${digits}`
    : 'https://beian.mps.gov.cn/';

  return (
    <>
      {' · '}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="公安备案信息查询"
        className="inline-flex items-center gap-1 hover:text-ink-600 transition-colors"
      >
        <img src={mpsBeianIcon} alt="公安备案图标" width={13} height={14} className="shrink-0" />
        {MPS_BEIAN_NUMBER}
      </a>
    </>
  );
}
