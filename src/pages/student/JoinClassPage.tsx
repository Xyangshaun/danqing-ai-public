// ============================================================
// 丹青有AI - 学生端 · 加入班级页
// 数据: POST /api/v1/auth/invitation/redeem   邀请码兑换(加入班级)
// 权限: 所有登录用户可访问(无角色守卫,外层 RequireAuth 兜底)
// 流程:
//   1. 已登录学生输入邀请码 → 服务端为现有账户添加班级成员关系,
//      切换激活租户为班级,返回新签发的 JWT(租户上下文 = 班级)
//   2. 前端 setAccessToken 落盘新 token → 后续作品诊断归入班级租户,
//      教师即可在班级管理中查看并打分
//   3. 刷新 AuthContext(user/tenant/memberships)+ 广播 tenant-switched
// ============================================================

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { joinClassByInvitation } from '../../services/class-api';
import type { JoinClassResult } from '../../services/class-api';
import { ApiError } from '../../services/api';
import { setAccessToken } from '../../services/token-store';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ToastProvider';

export default function JoinClassPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refreshUser, loadTenants } = useAuth();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [joined, setJoined] = useState<JoinClassResult | null>(null);

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setErrorMsg('请输入邀请码');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await joinClassByInvitation(trimmed);
      // 关键:落盘新 token(服务端已切换激活租户为班级,JWT 内 tenantId 已变更)
      setAccessToken(res.accessToken, res.accessTokenExpiresAt);
      setJoined(res);
      // 刷新认证态与租户成员列表(失败不阻塞成功页展示)
      try {
        await refreshUser();
        await loadTenants();
      } catch {
        // token 已落盘,刷新失败由后续请求拦截器兜底
      }
      // 广播租户切换,通知各页面基于班级租户重新加载数据
      window.dispatchEvent(
        new CustomEvent('tenant-switched', {
          detail: { tenantId: res.tenant.id, tenantName: res.tenant.name },
        }),
      );
      toast.success('已成功加入班级', res.tenant.name);
    } catch (err) {
      // silent 请求:错误在此内联展示(邀请码无效/过期/次数用尽等)
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : '加入失败,请检查邀请码后重试',
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* 加入成功态 */
  if (joined) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-jade/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-jade" />
          </div>
          <h1 className="text-lg font-semibold text-ink-900 font-serif mb-2">加入成功</h1>
          <p className="text-sm text-ink-500 mb-1">
            你已加入「{joined.tenant.name}」
          </p>
          <p className="text-2xs text-ink-400 mb-6">
            当前工作空间已切换至该班级,新提交的作品诊断老师可查看并评分
          </p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark transition-colors"
            >
              前往工作台
              <ArrowRight className="w-4 h-4" />
            </button>
            <Link
              to="/analyze"
              className="inline-flex items-center px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
            >
              去上传作品
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* 输入邀请码态 */
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-stone/10 flex items-center justify-center mx-auto mb-4">
            <Ticket className="w-7 h-7 text-stone" />
          </div>
          <h1 className="text-lg font-semibold text-ink-900 font-serif">加入班级</h1>
          <p className="text-xs text-ink-400 mt-1.5">输入老师分享的邀请码,加入班级提交作业</p>
        </div>

        <label htmlFor="invitation-code" className="block text-xs text-ink-500 mb-1.5">
          邀请码
        </label>
        <input
          id="invitation-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setErrorMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void handleJoin();
          }}
          disabled={submitting}
          maxLength={32}
          placeholder="例如:ABC123"
          autoFocus
          className="w-full h-11 px-3 rounded-md border border-ink-900/15 bg-white text-center text-base font-mono font-semibold tracking-[0.2em] text-ink-900 placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-stone/30"
        />

        {errorMsg && (
          <p className="flex items-center gap-1.5 mt-2 text-xs text-cinnabar" role="alert">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {errorMsg}
          </p>
        )}

        <button
          onClick={() => void handleJoin()}
          disabled={submitting || !code.trim()}
          className="w-full mt-4 inline-flex items-center justify-center gap-1.5 h-10 rounded-md bg-cinnabar text-rice-50 text-sm font-medium hover:bg-cinnabar-dark disabled:opacity-50 transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? '加入中…' : '加入班级'}
        </button>

        <p className="text-2xs text-ink-300 text-center mt-4">
          没有邀请码?请联系你的任课老师获取
        </p>
      </div>
    </div>
  );
}
