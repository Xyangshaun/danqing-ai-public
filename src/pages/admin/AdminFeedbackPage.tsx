// ============================================================
// 丹青有AI - 管理员 · 标注反馈看板(反馈闭环 Phase 5 批次②)
// 对应文档: docs/phase5-flywheel-profile-checklist.md 三、批次②
//
// 页面结构(照 AdminDashboardPage 模式):
//   - KPI 卡片:总反馈 / 有用率 / 近 7 天 / 独立用户 / 覆盖分析
//   - 维度分布:哪个维度最常被点「没用」(飞轮改进定位)
//   - 类型分布:分类型训练集规模盘点
//   - 趋势图:近 N 天按日反馈量
//   - 训练数据导出:NDJSON 下载(owner 可选全局/本租户)
//
// 数据刷新:5 分钟轮询(与后端 Redis 缓存 TTL 一致);
// 导出按钮即时请求(导出端点无缓存,要求新鲜数据)。
// ============================================================

import { useMemo, useState } from 'react';
import { RefreshCw, Download, Recycle, Database } from 'lucide-react';
import { usePolling } from '../../hooks/usePolling';
import {
  getFeedbackOverview,
  getFeedbackByDimension,
  getFeedbackByWorkType,
  getFeedbackTrend,
  exportFeedbackTrainingData,
} from '../../services/admin-feedback-api';
import {
  AdminSection,
  KpiCard,
  DisabledPlaceholder,
  SectionSkeleton,
  MiniBars,
  formatPct,
} from '../../components/admin/AdminUI';
import { useAuth } from '../../hooks/useAuth';

/** 趋势图展示天数(后端 clamp 1-90) */
const TREND_DAYS = 14;

/** workType → 中文标签 */
const WORK_TYPE_LABELS: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品',
  sculpture: '雕塑',
  unknown: '未分类',
};

export default function AdminFeedbackPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  // 5 分钟轮询(与后端缓存 TTL 一致)
  const overview = usePolling(() => getFeedbackOverview(), { intervalMs: 300000 });
  const byDimension = usePolling(() => getFeedbackByDimension(), { intervalMs: 300000 });
  const byWorkType = usePolling(() => getFeedbackByWorkType(), { intervalMs: 300000 });
  const trend = usePolling(() => getFeedbackTrend({ days: TREND_DAYS }), { intervalMs: 300000 });

  // ---------- 训练数据导出控件 ----------
  /** owner 导出范围:all=全局(所有租户);own=本租户。非 owner 无选择权(后端强制本租户) */
  const [scope, setScope] = useState<'all' | 'own'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshAll = () => {
    overview.refresh();
    byDimension.refresh();
    byWorkType.refresh();
    trend.refresh();
  };

  const trendBars = useMemo(
    () => (trend.data?.dataPoints ?? []).map((p) => p.totalCount),
    [trend.data],
  );

  /** 维度分布按总量降序(飞轮视角:优先看大头) */
  const dimensionStats = useMemo(
    () => [...(byDimension.data?.stats ?? [])].sort((a, b) => b.totalCount - a.totalCount),
    [byDimension.data],
  );
  const workTypeStats = useMemo(
    () => [...(byWorkType.data?.stats ?? [])].sort((a, b) => b.totalCount - a.totalCount),
    [byWorkType.data],
  );

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const rowCount = await exportFeedbackTrainingData({
        ...(isOwner && scope === 'all' ? { tenantId: 'all' } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      setExportResult({ ok: true, text: `已导出 ${rowCount} 行训练数据(.jsonl)` });
    } catch (err) {
      setExportResult({
        ok: false,
        text: err instanceof Error ? err.message : '导出失败,请稍后重试',
      });
    } finally {
      setExporting(false);
    }
  };

  const ov = overview.data;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <Recycle className="w-5 h-5 text-cinnabar" />
            标注反馈看板
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            数据飞轮 · 标注反馈统计(5 分钟缓存口径){isOwner ? ' · 平台 owner 视角' : ' · 本租户数据'}
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${overview.loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* KPI 卡片区 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="总反馈" value={ov?.totalCount ?? '--'} sub={ov ? `认同 ${ov.upCount} · 没用 ${ov.downCount}` : undefined} />
        <KpiCard
          label="有用率"
          value={ov ? formatPct(ov.usefulRate) : '--'}
          sub="up / 总量"
          tone={ov ? (ov.usefulRate >= 0.6 ? 'good' : ov.usefulRate >= 0.4 ? 'warn' : 'bad') : 'default'}
        />
        <KpiCard label="近 7 天" value={ov?.last7DaysCount ?? '--'} sub="恒定近 7 天口径" />
        <KpiCard label="独立用户" value={ov?.uniqueUsers ?? '--'} sub="参与反馈人数" />
        <KpiCard label="覆盖分析" value={ov?.analysesCovered ?? '--'} sub="被反馈的分析数" />
      </div>

      {/* 维度分布 + 类型分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminSection title="维度分布" desc="哪个维度的标注最常被点「没用」——飞轮改进定位">
          {byDimension.loading && !byDimension.data ? (
            <SectionSkeleton />
          ) : dimensionStats.length ? (
            <div className="space-y-2.5">
              {dimensionStats.map((s) => (
                <div key={s.dimension} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate text-ink-600" title={s.dimension}>
                    {s.dimension}
                  </span>
                  <RateBar rate={s.usefulRate} />
                  <span className="font-mono text-ink-800 tabular-nums w-14 text-right">
                    {formatPct(s.usefulRate)}
                  </span>
                  <span className="ml-auto text-xs text-ink-400 tabular-nums">
                    {s.totalCount} 条
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DisabledPlaceholder text="暂无反馈数据" onRetry={byDimension.refresh} />
          )}
        </AdminSection>

        <AdminSection title="类型分布" desc="分类型训练集规模盘点">
          {byWorkType.loading && !byWorkType.data ? (
            <SectionSkeleton />
          ) : workTypeStats.length ? (
            <div className="space-y-2.5">
              {workTypeStats.map((s) => (
                <div key={s.workType} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate text-ink-600">
                    {WORK_TYPE_LABELS[s.workType] ?? s.workType}
                  </span>
                  <RateBar rate={s.usefulRate} />
                  <span className="font-mono text-ink-800 tabular-nums w-14 text-right">
                    {formatPct(s.usefulRate)}
                  </span>
                  <span className="ml-auto text-xs text-ink-400 tabular-nums">
                    {s.totalCount} 条
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DisabledPlaceholder text="暂无反馈数据" onRetry={byWorkType.refresh} />
          )}
        </AdminSection>
      </div>

      {/* 反馈趋势 */}
      <AdminSection title="反馈趋势" desc={`近 ${TREND_DAYS} 天按日反馈量`}>
        {trend.loading && !trend.data ? (
          <SectionSkeleton />
        ) : trendBars.length ? (
          <div>
            <MiniBars data={trendBars} height={72} barClass="bg-jade/60" />
            <div className="flex justify-between text-2xs text-ink-400 mt-1">
              <span>{trend.data?.dataPoints[0]?.date.slice(5)}</span>
              <span>{trend.data?.dataPoints[trend.data.dataPoints.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        ) : (
          <DisabledPlaceholder text="暂无反馈数据" onRetry={trend.refresh} />
        )}
      </AdminSection>

      {/* 训练数据导出(批次②:数据飞轮备料) */}
      <AdminSection
        title="训练数据导出"
        desc="marker 反馈导出为 JSONL(marker 快照平铺 + action + workType + diagnosisMode + 采集时间);正负样本全量导出,由训练侧自行切分"
        action={<Database className="w-4 h-4 text-ink-300" />}
      >
        <div className="flex flex-wrap items-end gap-3">
          {isOwner && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">导出范围</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'all' | 'own')}
                className="h-9 rounded-md border border-ink-900/15 bg-white px-2 text-sm text-ink-700"
              >
                <option value="all">全局(所有租户)</option>
                <option value="own">本租户</option>
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">开始日期(可空)</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 rounded-md border border-ink-900/15 bg-white px-2 text-sm text-ink-700"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">结束日期(可空)</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 rounded-md border border-ink-900/15 bg-white px-2 text-sm text-ink-700"
            />
          </label>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md border border-cinnabar/40 bg-cinnabar/10 text-sm text-cinnabar hover:bg-cinnabar/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className={`w-4 h-4 ${exporting ? 'animate-bounce' : ''}`} />
            {exporting ? '导出中…' : '导出训练数据'}
          </button>
        </div>
        {exportResult && (
          <p className={`mt-3 text-sm ${exportResult.ok ? 'text-jade' : 'text-cinnabar'}`}>
            {exportResult.text}
          </p>
        )}
        {!isOwner && (
          <p className="mt-3 text-xs text-ink-400">数据主权:租户管理员仅可导出本租户的反馈数据</p>
        )}
      </AdminSection>
    </div>
  );
}

/** 有用率横条(≥60% 墨绿 / ≥40% 金 / 其余朱砂) */
function RateBar({ rate }: { rate: number }) {
  const barClass =
    rate >= 0.6 ? 'bg-jade/70' : rate >= 0.4 ? 'bg-gold/70' : 'bg-cinnabar/70';
  return (
    <div className="h-1.5 flex-1 min-w-16 rounded-full bg-ink-900/10 overflow-hidden">
      <div
        className={`h-full rounded-full ${barClass} transition-all`}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%` }}
      />
    </div>
  );
}
