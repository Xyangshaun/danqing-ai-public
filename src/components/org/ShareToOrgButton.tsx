// ============================================================
// ShareToOrgButton — 「分享到组织」按钮(封装弹窗逻辑)
//
// 行为:
//   - 仅服务器端分析记录(UUID)可分享;本地结果不渲染
//   - 点击打开 ShareToOrgDialog(caption 输入 + 确认)
//   - 分享成功(含 409 幂等)后按钮变为「已分享 · 查看动态」跳转链接
// ============================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, CheckCircle2 } from 'lucide-react';
import ShareToOrgDialog from './ShareToOrgDialog';

/** 服务器端分析记录 ID 为 UUID;本地分析结果(如 local-xxx)不可分享 */
const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShareToOrgButtonProps {
  analysisId: string;
  /** 按钮附加类名(与所在操作栏风格对齐) */
  className?: string;
  /** 图标类名(默认 w-5 h-5;紧凑操作栏可传 w-4 h-4) */
  iconClassName?: string;
}

export default function ShareToOrgButton({ analysisId, className = '', iconClassName = 'w-5 h-5' }: ShareToOrgButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shared, setShared] = useState(false);

  /* 本地分析结果无服务器记录,不可分享 */
  if (!SERVER_ID_RE.test(analysisId)) return null;

  if (shared) {
    return (
      <Link
        to="/org/feed"
        aria-label="已分享,查看组织动态"
        className={`inline-flex items-center gap-2 ${className}`}
      >
        <CheckCircle2 className={iconClassName} />
        <span className="font-medium">已分享 · 查看动态</span>
      </Link>
    );
  }

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        aria-label="分享到组织"
        className={`inline-flex items-center gap-2 ${className}`}
      >
        <Users className={iconClassName} />
        <span className="font-medium">分享到组织</span>
      </button>
      <ShareToOrgDialog
        analysisId={analysisId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onShared={() => setShared(true)}
      />
    </>
  );
}
