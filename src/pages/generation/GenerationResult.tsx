// ============================================================
// 生成结果组件(M2-T7,M4-T6 扩展风格拆解卡)
// ------------------------------------------------------------
// success 后展示生成图列表(GeneratedImage[]):
//   - 审核状态控制:reviewStatus=flagged/rejected 的图灰显并提示
//     "内容审核未通过",不提供下载/一键诊断,不进入下游
//   - 每张图提供"查看大图"(新窗口打开)与"下载"能力
//   - "一键诊断"按钮:后端未暴露 submitForAnalysis 端点,按 M2-T7
//     任务指令渲染为占位态,点击 toast 提示功能即将上线
//   - usedFallback=true 时展示"已自动切换备用服务"提示
//   - styleAnalysis 非空(style 模式)时并列展示风格拆解卡
//     (StyleAnalysisCard 七字段),lg 起双栏:生成图网格占 2/3、
//     拆解卡占 1/3;小屏纵向堆叠,对齐页面既有栅格风格
// ============================================================

import {
  ExternalLink, Download, Wand2, ShieldAlert, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import type { GeneratedImage, ReviewStatus, StyleAnalysis } from '../../services/generationService';
import { useToast } from '../../components/ToastProvider';
import StyleAnalysisCard from './StyleAnalysisCard';

interface GenerationResultProps {
  /** 生成图列表 */
  images: GeneratedImage[];
  /** 是否经过降级(主提供商失败自动切换备用服务) */
  usedFallback: boolean;
  /** 风格拆解(style 模式两阶段落库产物,非 style 任务为空;M4-T6) */
  styleAnalysis?: StyleAnalysis | null;
  /** 重新生成(回到表单) */
  onRegenerate: () => void;
}

/** 是否可展示/可进入下游(flagged/rejected 不可) */
function isDisplayable(img: GeneratedImage): boolean {
  return img.reviewStatus === 'approved' || img.reviewStatus === 'pending';
}

/** 审核状态 → 提示文案 */
const REVIEW_META: Record<ReviewStatus, string> = {
  approved: '审核通过',
  pending: '待审核',
  rejected: '内容审核未通过',
  flagged: '内容存疑',
};

/**
 * 生成结果卡片
 * @param props 见 GenerationResultProps
 */
export default function GenerationResult({
  images, usedFallback, styleAnalysis, onRegenerate,
}: GenerationResultProps) {
  const toast = useToast();

  /* 一键诊断(占位):后端未暴露 submitForAnalysis 端点 */
  const handleOneClickDiagnosis = () => {
    toast.info('功能即将上线', '教学闭环接口尚未开放，敬请期待');
  };

  /* 下载生成图:新窗口打开原图,由用户自行保存 */
  const handleDownload = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const displayableCount = images.filter(isDisplayable).length;

  /* 主卡片(生成图网格 + 一键诊断) */
  const mainCard = (
    <div className="bg-rice-50 border border-ink-900/8 rounded-lg shadow-subtle overflow-hidden">
      {/* 卡片标题 */}
      <div className="px-6 pt-6 pb-4 border-b border-ink-900/8 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-bold text-ink-900">生成结果</h2>
          <p className="text-sm text-ink-500 mt-1">
            共生成 {images.length} 张作品{displayableCount !== images.length ? `，${displayableCount} 张可展示` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          className="px-3 h-9 rounded border border-ink-900/10 bg-rice-100 text-sm text-ink-600 hover:border-ink-900/20 transition-colors"
        >
          重新生成
        </button>
      </div>

      {/* 降级提示 */}
      {usedFallback && (
        <div className="px-6 py-2.5 bg-gold/10 border-b border-gold/20 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-gold-dark flex-shrink-0" />
          <p className="text-xs text-gold-dark">已自动切换备用 AI 服务，本次生成使用降级通道</p>
        </div>
      )}

      {/* 生成图网格(拆解卡并列时主栏变窄,缩为最多 2 列) */}
      <div className="p-6">
        <div
          className={`grid gap-4 ${
            styleAnalysis ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {images.map((img, idx) => {
            const displayable = isDisplayable(img);
            return (
              <div
                key={`${img.imageUrl}-${idx}`}
                className={`relative rounded-md border overflow-hidden bg-rice-100 group ${
                  displayable ? 'border-ink-900/10' : 'border-ink-900/10 opacity-60'
                }`}
              >
                {/* 图片(外部图,新窗口打开避免 SPA 劫持) */}
                <img
                  src={img.imageUrl}
                  alt={`生成作品 ${idx + 1}`}
                  loading="lazy"
                  className={`w-full aspect-square object-cover ${displayable ? '' : 'grayscale'}`}
                />

                {/* 审核状态角标 */}
                {!displayable && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900/50 text-rice-100">
                    <ShieldAlert className="w-6 h-6" />
                    <p className="text-xs">{REVIEW_META[img.reviewStatus]}</p>
                  </div>
                )}

                {/* 底部操作条 */}
                <div className="absolute bottom-0 inset-x-0 px-2 py-1.5 bg-gradient-to-t from-ink-900/70 to-transparent flex items-center justify-end gap-1">
                  {/* 查看大图:外部链接,新窗口打开(安全:target=_blank + rel) */}
                  <a
                    href={img.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-7 h-7 flex items-center justify-center text-rice-100 rounded hover:bg-white/20 transition-colors"
                    aria-label={`查看大图 ${idx + 1}`}
                    title="查看大图"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  {displayable && (
                    <button
                      type="button"
                      onClick={() => handleDownload(img.imageUrl)}
                      className="w-7 h-7 flex items-center justify-center text-rice-100 rounded hover:bg-white/20 transition-colors"
                      aria-label={`下载作品 ${idx + 1}`}
                      title="下载"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 一键诊断(占位) */}
        {displayableCount > 0 && (
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-md bg-rice-100 border border-ink-900/8">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-jade flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-ink-900">生成完成，进入诊断闭环</p>
                <p className="text-xs text-ink-500 mt-0.5">
                  一键提交诊断，获取构图 / 色彩 / 技法专业批改建议
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOneClickDiagnosis}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded bg-cinnabar text-white text-sm font-medium hover:bg-cinnabar-dark transition-colors"
            >
              <Wand2 className="w-4 h-4" />
              一键诊断
            </button>
          </div>
        )}
      </div>
    </div>
  );

  /* 风格拆解卡与生成图网格并列(真源 §7.2:结果页同时展示两者;§八) */
  if (styleAnalysis) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">{mainCard}</div>
        <StyleAnalysisCard analysis={styleAnalysis} />
      </div>
    );
  }
  return mainCard;
}
