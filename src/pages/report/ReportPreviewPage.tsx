// ============================================================
// 报告预览页(打印友好布局)
// 路由:/report/:id?template=student|teacher|summary
// 数据:GET /analyses/:id/report-data(报告数据聚合)
// 导出:PDF(浏览器打印) / PNG 图片卡片(原生 Canvas)
// 对应规划:.trae/specs/report-export-org-share/spec.md §3
// ============================================================

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, ImageDown, Loader2, AlertCircle } from 'lucide-react';
import { getReportData } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ToastProvider';
import {
  buildReportViewModel,
  REPORT_TEMPLATE_LABELS,
  type ReportTemplate,
  type ReportViewModel,
} from '../../components/report/reportTypes';
import StudentTemplate from '../../components/report/StudentTemplate';
import TeacherTemplate from '../../components/report/TeacherTemplate';
import SummaryTemplate from '../../components/report/SummaryTemplate';
import { exportSummaryImage } from '../../components/report/exportSummaryImage';

const VALID_TEMPLATES: ReportTemplate[] = ['student', 'teacher', 'summary'];

function isValidTemplate(v: string | null): v is ReportTemplate {
  return v !== null && (VALID_TEMPLATES as string[]).includes(v);
}

export default function ReportPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [vm, setVm] = useState<ReportViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exportingImage, setExportingImage] = useState(false);

  /* 模板选择:URL 参数优先;无参数时教师/管理员默认教学版,其余默认学生版 */
  const template: ReportTemplate = useMemo(() => {
    const q = searchParams.get('template');
    if (isValidTemplate(q)) return q;
    const role = user?.role;
    return role === 'teacher' || role === 'admin' || role === 'owner' ? 'teacher' : 'student';
  }, [searchParams, user?.role]);

  /* 打印模式:挂载期间给 body 加类,打印时隐藏应用骨架(见 index.css) */
  useEffect(() => {
    document.body.classList.add('report-print-mode');
    return () => document.body.classList.remove('report-print-mode');
  }, []);

  const load = useCallback(async (analysisId: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await getReportData(analysisId);
      setVm(buildReportViewModel(data));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '报告数据加载失败';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setErrorMsg('缺少分析记录 ID');
      setLoading(false);
      return;
    }
    void load(id);
  }, [id, load]);

  const switchTemplate = (t: ReportTemplate) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('template', t);
      return next;
    }, { replace: true });
  };

  const handleExportPdf = () => {
    window.print();
  };

  const handleExportImage = async () => {
    if (!vm || exportingImage) return;
    setExportingImage(true);
    try {
      const ok = await exportSummaryImage(vm);
      if (ok) {
        toast.success('图片已导出', 'PNG 卡片已开始下载');
      } else {
        toast.error('导出失败', '浏览器不支持 Canvas 导出,请使用 PDF 导出');
      }
    } catch {
      toast.error('导出失败', '图片生成异常,请重试');
    } finally {
      setExportingImage(false);
    }
  };

  /* ---------- 加载 / 错误态 ---------- */
  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-ink-400">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">正在生成报告…</p>
      </div>
    );
  }

  if (errorMsg || !vm) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-cinnabar" />
        <p className="text-ink-700 font-medium">报告数据加载失败</p>
        <p className="text-sm text-ink-400 max-w-md text-center">{errorMsg ?? '未知错误'}</p>
        <div className="flex gap-3">
          {id && (
            <button
              onClick={() => void load(id)}
              className="px-4 py-2 bg-cinnabar text-rice-50 rounded-lg text-sm hover:bg-cinnabar-dark transition-colors"
            >
              重试
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 border border-ink-900/20 text-ink-700 rounded-lg text-sm hover:bg-ink-900/5 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  /* ---------- 正常渲染 ---------- */
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* 工具栏(打印时隐藏) */}
      <div className="no-print mb-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 transition-colors"
            aria-label="返回"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900 text-rice-50 rounded-lg text-sm hover:bg-cinnabar transition-colors"
              aria-label="导出 PDF"
            >
              <FileDown className="w-4 h-4" />
              导出 PDF
            </button>
            <button
              onClick={() => void handleExportImage()}
              disabled={exportingImage}
              className="inline-flex items-center gap-2 px-4 py-2 bg-cinnabar text-rice-50 rounded-lg text-sm hover:bg-stone transition-colors disabled:opacity-60"
              aria-label="导出图片卡片"
            >
              {exportingImage ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImageDown className="w-4 h-4" />
              )}
              导出图片卡片
            </button>
          </div>
        </div>

        {/* 模板切换 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-400 mr-1">报告模板</span>
          {VALID_TEMPLATES.map((t) => (
            <button
              key={t}
              onClick={() => switchTemplate(t)}
              aria-pressed={template === t}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                template === t
                  ? 'bg-cinnabar text-rice-50'
                  : 'bg-ink-900/5 text-ink-600 hover:bg-ink-900/10'
              }`}
            >
              {REPORT_TEMPLATE_LABELS[t]}
            </button>
          ))}
          <span className="text-2xs text-ink-300 ml-auto hidden sm:inline">
            导出 PDF 将调用浏览器打印,选择"另存为 PDF"即可
          </span>
        </div>
      </div>

      {/* 报告主体(A4 宽度约束,打印时仅此区域输出) */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden print:shadow-none">
        {template === 'student' && <StudentTemplate vm={vm} />}
        {template === 'teacher' && <TeacherTemplate vm={vm} />}
        {template === 'summary' && <SummaryTemplate vm={vm} />}
      </div>
    </div>
  );
}
