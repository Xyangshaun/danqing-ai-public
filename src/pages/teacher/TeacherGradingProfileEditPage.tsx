// ============================================================
// 丹青有AI - 教师端 · 评分档案编辑页(双阶段反馈框架 Phase 2 批次⑤)
// 数据: GET /api/v1/grading-profiles/:id
// 功能: 加载档案详情 → 渲染 LUT 式编辑器;内置档案只读展示
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getGradingProfile } from '../../services/grading-profile-api';
import type { GradingProfileDetail } from '../../types/grading-profile';
import { GRADING_PROFILE_CATEGORY_LABELS } from '../../types/grading-profile';
import GradingProfileEditor from '../../components/teacher/GradingProfileEditor';
import { useToast } from '../../components/ToastProvider';

export default function TeacherGradingProfileEditPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const toast = useToast();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GradingProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getGradingProfile(profileId);
      setDetail(res);
    } catch {
      // 错误已由 api.ts 统一 Toast(如 9301 档案不存在)
      setError('档案加载失败,可能已删除或停用');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-ink-400 animate-spin" />
          <span className="ml-2 text-sm text-ink-500">加载评分档案…</span>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <Link
          to="/teacher/grading-profiles"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-cinnabar transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回档案列表
        </Link>
        <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-10 text-center">
          <p className="text-sm text-ink-500">{error ?? '档案不存在'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/teacher/grading-profiles"
            className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-cinnabar transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回档案列表
          </Link>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2 mt-1.5">
            {detail.isBuiltIn ? '查看系统预设' : '编辑评分档案'}
            <span className="text-xs px-2 py-0.5 rounded bg-stone/10 text-stone font-normal">
              {GRADING_PROFILE_CATEGORY_LABELS[detail.category]}类目
            </span>
          </h1>
        </div>
      </div>

      <GradingProfileEditor
        detail={detail}
        onSaved={(updated) => {
          setDetail(updated);
          toast.success('档案已保存');
          navigate('/teacher/grading-profiles');
        }}
        onCancel={() => navigate('/teacher/grading-profiles')}
      />
    </div>
  );
}
