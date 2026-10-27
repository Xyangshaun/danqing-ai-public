// ============================================================
// 丹青有AI - 管理员 · 实时监控大屏
// 对应文档: docs/superpowers/specs/2026-08-08-admin-dashboard-api-design.md §1
//
// 数据分三档刷新:
//   - 高频轮询(10-15s): stats/realtime + system/health
//   - 指标(60s,依赖 metrics 开关): metrics/sla + metrics/ai
//   - 低频缓存(5min): stats/overview + ai-usage/*
//
// metrics 开关未开启时,指标区显示「未开启」占位而非报错(决策 §5.2)。
// ============================================================

import { useMemo, useState } from 'react';
import { Activity, RefreshCw, Server, Users, Zap, Database, Cpu, CloudRain, Scale } from 'lucide-react';
import { usePolling } from '../../hooks/usePolling';
import {
  getStatsRealtime,
  getSystemHealth,
  getStatsOverview,
  getScoreConsistency,
  getMetricsSla,
  getMetricsAi,
  getAiUsageOverview,
  getAiUsageByProvider,
  getAiUsageTrend,
} from '../../services/admin-api';
import {
  AdminSection,
  KpiCard,
  StatusDot,
  DisabledPlaceholder,
  SectionSkeleton,
  MiniBars,
  formatPct,
} from '../../components/admin/AdminUI';
import { ApiError } from '../../services/api';

function isForbidden(err: Error | null): boolean {
  return err instanceof ApiError && (err.httpStatus === 403 || err.code === 2004);
}

export default function AdminDashboardPage() {
  const [slaDays] = useState(7);

  // 高频:实时心跳 + 健康(15s)
  const realtime = usePolling(getStatsRealtime, { intervalMs: 15000 });
  const health = usePolling(getSystemHealth, { intervalMs: 15000 });
  // 低频:业务总览(60s)
  const overview = usePolling(getStatsOverview, { intervalMs: 60000 });
  // 低频:AI-教师评分一致性(框架二 P2,差异数据仅在评审/裁定时产生,5min 足够)
  const consistency = usePolling(() => getScoreConsistency({ days: 90 }), { intervalMs: 300000 });
  // 指标:SLA / AI(60s,可能因 metrics 开关关闭返回 403)
  const sla = usePolling(() => getMetricsSla({ days: slaDays }), { intervalMs: 60000 });
  const ai = usePolling(() => getMetricsAi(), { intervalMs: 60000 });
  // 低频:AI 用量(5min)
  const usageOverview = usePolling(() => getAiUsageOverview({ days: slaDays }), { intervalMs: 300000 });
  const usageProvider = usePolling(() => getAiUsageByProvider({ days: slaDays }), { intervalMs: 300000 });
  const usageTrend = usePolling(() => getAiUsageTrend({ days: slaDays }), { intervalMs: 300000 });

  const metricsOff = isForbidden(sla.error) || isForbidden(ai.error);

  const trendBars = useMemo(
    () => (usageTrend.data?.dataPoints ?? []).map((p) => p.totalCount),
    [usageTrend.data],
  );
  const slaBars = useMemo(
    () => (sla.data?.dailySla ?? []).map((d) => Math.round(d.complianceRate * 100)),
    [sla.data],
  );

  const refreshing = realtime.loading || health.loading;
  const refreshAll = () => {
    realtime.refresh();
    health.refresh();
    overview.refresh();
    consistency.refresh();
    sla.refresh();
    ai.refresh();
    usageOverview.refresh();
    usageProvider.refresh();
    usageTrend.refresh();
  };

  const rt = realtime.data;
  const ov = overview.data;
  const hv = health.data;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <Activity className="w-5 h-5 text-cinnabar" />
            实时监控大屏
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            {rt?.timestamp ? `更新于 ${new Date(rt.timestamp).toLocaleTimeString()}` : '加载中…'}
            {metricsOff && ' · 可观测性指标未开启'}
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 系统健康状态条 */}
      <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="inline-flex items-center gap-2 text-sm text-ink-700">
          <Server className="w-4 h-4 text-ink-400" />
          系统:
          {hv ? <StatusDot status={hv.status} /> : <span className="text-xs text-ink-400">…</span>}
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-ink-700">
          <Database className="w-4 h-4 text-ink-400" />
          数据库: {hv ? <StatusDot status={hv.services.database} /> : '…'}
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-ink-700">
          <Zap className="w-4 h-4 text-ink-400" />
          缓存: {hv ? <StatusDot status={hv.services.redis} /> : '…'}
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-ink-700">
          <CloudRain className="w-4 h-4 text-ink-400" />
          AI 服务: {hv ? <StatusDot status={hv.services.aiService} /> : '…'}
        </span>
        {hv && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-ink-400">
            <Cpu className="w-3.5 h-3.5" />
            内存 {hv.memoryUsageMb}MB · 运行 {Math.floor(hv.uptime / 3600)}h · Node {hv.nodeVersion}
          </span>
        )}
      </div>

      {/* KPI 卡片区 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="在线用户" value={rt?.onlineUsers ?? '--'} sub="5分钟内活跃" />
        <KpiCard label="今日 AI 调用" value={rt?.todayAiCalls ?? '--'} sub="当日累计" />
        <KpiCard label="处理中任务" value={rt?.pendingTasks ?? '--'} sub="队列任务" />
        <KpiCard
          label="系统负载"
          value={rt ? formatPct(rt.systemLoad, 0) : '--'}
          sub="0-100%"
          tone={rt && rt.systemLoad > 0.85 ? 'bad' : rt && rt.systemLoad > 0.7 ? 'warn' : 'default'}
        />
        <KpiCard label="日活 DAU" value={ov?.dau ?? '--'} sub={ov ? `MAU ${ov.mau}` : undefined} />
        <KpiCard label="总用户" value={ov?.totalUsers ?? '--'} sub={ov ? `租户 ${ov.totalTenants}` : undefined} />
      </div>

      {/* AI-教师评分一致性(框架二 P2) */}
      <AdminSection title="AI-教师评分一致性" desc="近 90 天 · 教师评审与仲裁裁定的差异快照">
        {consistency.loading && !consistency.data ? (
          <SectionSkeleton />
        ) : consistency.data && consistency.data.sampleCount > 0 ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono text-ink-900">
                {formatPct(consistency.data.bandAgreementRate)}
              </span>
              <span className="text-xs text-ink-400">四档档位一致率</span>
              <span className="ml-auto text-xs text-ink-400">样本 {consistency.data.sampleCount} 份</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Row label="MAE" value={`${consistency.data.mae} 分`} />
              <Row label="RMSE" value={`${consistency.data.rmse} 分`} />
              <Row label="AI 偏低" value={String(consistency.data.aiUnderCount)} />
              <Row label="AI 偏高" value={String(consistency.data.aiOverCount)} />
            </div>
            {Object.keys(consistency.data.dimensionMae).length > 0 && (
              <div className="pt-2 border-t border-ink-900/5">
                <div className="text-xs text-ink-400 mb-2 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  维度级 MAE(分)
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(consistency.data.dimensionMae).map(([key, mae]) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rice-100 text-xs text-ink-700"
                    >
                      {DIMENSION_LABELS[key] ?? key}
                      <span className="font-mono">{mae}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(consistency.data.bySource).length > 0 && (
              <div className="pt-2 border-t border-ink-900/5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
                {Object.entries(consistency.data.bySource).map(([source, s]) => (
                  <span key={source}>
                    {SOURCE_LABELS[source] ?? source}:MAE {s.mae} 分 · 档位一致 {formatPct(s.bandAgreementRate)} · {s.sampleCount} 份
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <DisabledPlaceholder
            text="暂无差异数据:教师评审或仲裁裁定作品评分后将自动记录"
            onRetry={consistency.refresh}
          />
        )}
      </AdminSection>

      {/* SLA / AI 指标区(依赖 metrics 开关) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminSection title="SLA 达标率" desc={`近 ${slaDays} 天 · ≤3s 占比`}>
          {metricsOff ? (
            <DisabledPlaceholder text="可观测性指标功能未开启,请联系平台管理员启用 metrics 开关" onRetry={sla.refresh} />
          ) : sla.loading && !sla.data ? (
            <SectionSkeleton />
          ) : sla.data ? (
            <div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-3xl font-semibold font-mono text-ink-900">
                  {formatPct(sla.data.avgComplianceRate)}
                </span>
                <span className="text-xs text-ink-400">平均达标率</span>
              </div>
              <MiniBars data={slaBars} barClass="bg-jade/70" />
              <div className="flex justify-between text-2xs text-ink-400 mt-1">
                <span>{sla.data.dailySla[0]?.date.slice(5)}</span>
                <span>{sla.data.dailySla[sla.data.dailySla.length - 1]?.date.slice(5)}</span>
              </div>
            </div>
          ) : (
            <DisabledPlaceholder text="暂无数据" onRetry={sla.refresh} />
          )}
        </AdminSection>

        <AdminSection title="AI 服务可用性" desc="双提供商成功率 / 降级率">
          {metricsOff ? (
            <DisabledPlaceholder text="可观测性指标功能未开启" onRetry={ai.refresh} />
          ) : ai.loading && !ai.data ? (
            <SectionSkeleton />
          ) : ai.data ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-600">GLM</span>
                <span className="font-mono text-sm text-ink-800">
                  {formatPct(ai.data.providerAvailability.glm.successRate)}
                  <span className="text-2xs text-ink-400 ml-2">切换 {ai.data.providerAvailability.glm.switchCount}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-600">TRAE</span>
                <span className="font-mono text-sm text-ink-800">
                  {formatPct(ai.data.providerAvailability.trae.successRate)}
                  <span className="text-2xs text-ink-400 ml-2">切换 {ai.data.providerAvailability.trae.switchCount}</span>
                </span>
              </div>
              <div className="pt-2 border-t border-ink-900/5 flex items-center justify-between">
                <span className="text-sm text-ink-600">降级率</span>
                <span
                  className={`font-mono text-sm ${
                    ai.data.aiFallbackRate > 0.1 ? 'text-cinnabar' : 'text-ink-800'
                  }`}
                >
                  {formatPct(ai.data.aiFallbackRate)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-600">平均耗时</span>
                <span className="font-mono text-sm text-ink-800">{ai.data.analysis.avgDurationMs}ms</span>
              </div>
            </div>
          ) : (
            <DisabledPlaceholder text="暂无数据" onRetry={ai.refresh} />
          )}
        </AdminSection>
      </div>

      {/* AI 用量趋势 + 提供商成本 + 用量总览 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <AdminSection title="AI 调用趋势" desc={`近 ${slaDays} 天调用量`}>
          {usageTrend.loading && !usageTrend.data ? (
            <SectionSkeleton />
          ) : trendBars.length ? (
            <div>
              <MiniBars data={trendBars} height={72} />
              <div className="text-xs text-ink-400 mt-2">
                累计成本 ¥{usageTrend.data?.totalCostYuan.toFixed(2) ?? '--'}
              </div>
            </div>
          ) : (
            <DisabledPlaceholder text="暂无数据" onRetry={usageTrend.refresh} />
          )}
        </AdminSection>

        <AdminSection title="提供商成本" desc="按 Provider 分组">
          {usageProvider.loading && !usageProvider.data ? (
            <SectionSkeleton />
          ) : usageProvider.data?.stats.length ? (
            <div className="space-y-2.5">
              {usageProvider.data.stats.map((s) => (
                <div key={s.provider} className="flex items-center justify-between text-sm">
                  <span className="text-ink-600 uppercase">{s.provider}</span>
                  <span className="font-mono text-ink-800">
                    {s.totalCount} 次 · ¥{s.totalCostYuan.toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t border-ink-900/5 flex justify-between text-sm font-medium">
                <span className="text-ink-700">总成本</span>
                <span className="font-mono text-cinnabar">¥{usageProvider.data.totalCostYuan.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <DisabledPlaceholder text="暂无数据" onRetry={usageProvider.refresh} />
          )}
        </AdminSection>

        <AdminSection title="AI 用量总览" desc={`近 ${slaDays} 天`}>
          {usageOverview.loading && !usageOverview.data ? (
            <SectionSkeleton />
          ) : usageOverview.data ? (
            <div className="space-y-2.5 text-sm">
              <Row label="总调用" value={String(usageOverview.data.totalCount)} />
              <Row label="成功率" value={formatPct(usageOverview.data.successRate)} />
              <Row label="总 Token" value={usageOverview.data.totalTokens.toLocaleString()} />
              <Row label="平均耗时" value={`${usageOverview.data.avgDurationMs}ms`} />
              <Row label="总成本" value={`¥${usageOverview.data.totalCostYuan.toFixed(2)}`} accent />
            </div>
          ) : (
            <DisabledPlaceholder text="暂无数据" onRetry={usageOverview.refresh} />
          )}
        </AdminSection>
      </div>

      {/* 业务总览补充 */}
      {ov && (
        <AdminSection title="业务总览" desc="Redis 缓存 1 分钟">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Row label="总作品数" value={ov.totalArtworks.toLocaleString()} />
            <Row label="今日新增作品" value={String(ov.todayNewArtworks)} />
            <Row label="今日新增用户" value={String(ov.todayNewUsers)} />
            <Row label="今日 AI 调用" value={String(ov.todayAiCalls)} />
          </div>
        </AdminSection>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-ink-300" />
        {label}
      </span>
      <span className={`font-mono ${accent ? 'text-cinnabar font-medium' : 'text-ink-800'}`}>{value}</span>
    </div>
  );
}

/** 维度键 → 中文标签(四类作品维度 + 总评) */
const DIMENSION_LABELS: Record<string, string> = {
  composition: '构图',
  color: '色彩',
  brushwork: '笔触',
  visualHierarchy: '视觉层次',
  typography: '排版',
  colorApplication: '色彩应用',
  form: '形态',
  materialExpression: '材料表现',
  functionExpression: '功能表达',
  spatialComposition: '空间构成',
  bodyLanguage: '形体语言',
  materialLanguage: '材料语言',
  overall: '总评',
};

/** 差异记录来源 → 中文标签 */
const SOURCE_LABELS: Record<string, string> = {
  teacher_review: '教师评审',
  dispute_resolve: '仲裁裁定',
};
