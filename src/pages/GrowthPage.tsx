import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, BarChart3, Award, Sparkles, Lightbulb, Target, Layers, Eye, EyeOff } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { calculateGrowthInsights } from '../services/mockData';
import { getGrowthData, getAnalysisHistory } from '../services/data-service';
import type { GrowthData } from '../types';
import EmptyState from '../components/EmptyState';
import { CardSkeleton, SkeletonBox } from '../components/PageSkeleton';

/* 维度配置：统一管理颜色、字段、展示名，便于切换按钮与图表联动 */
type DimKey = 'dimension1' | 'dimension2' | 'dimension3' | 'overall';
const DIM_CONFIG: Record<DimKey, { name: string; stroke: string; gradientId: string; gradientFrom: string }> = {
  dimension1: { name: '维度一', stroke: '#c41e3a', gradientId: 'colorDim1', gradientFrom: '#c41e3a' },
  dimension2: { name: '维度二', stroke: '#2e5fa1', gradientId: 'colorDim2', gradientFrom: '#2e5fa1' },
  dimension3: { name: '维度三', stroke: '#d4af37', gradientId: 'colorDim3', gradientFrom: '#d4af37' },
  overall: { name: '综合', stroke: '#c8392c', gradientId: 'growthGradient', gradientFrom: '#c8392c' },
};

/* 自定义 Tooltip：水墨风格 + 显示日期/分数/维度名 */
function InkTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="bg-white/95 backdrop-blur-sm border border-ink-900/10 rounded-lg shadow-card px-3 py-2"
      style={{ boxShadow: '0 4px 14px rgba(26,26,26,0.08)' }}
    >
      <p className="text-xs font-medium text-ink-900 mb-1.5 pb-1.5 border-b border-ink-900/8">
        日期：{label}
      </p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-ink-600">{entry.name}</span>
            <span className="ml-auto font-serif font-bold text-ink-900">{entry.value}</span>
            <span className="text-ink-400">分</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GrowthPage() {
  const navigate = useNavigate();
  const [growthData, setGrowthData] = useState<GrowthData[]>([]);
  const [historyCount, setHistoryCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  /* 维度可见性：默认全部显示，用户可单独切换显示/隐藏 */
  const [visibleDims, setVisibleDims] = useState<Record<DimKey, boolean>>({
    dimension1: true,
    dimension2: true,
    dimension3: true,
    overall: true,
  });
  const toggleDim = (key: DimKey) => {
    setVisibleDims((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 点击图表数据点跳转到对应日期的历史记录
  const handleChartClick = (payload: { payload?: GrowthData } | undefined) => {
    const dataPoint = payload?.payload;
    if (dataPoint?.date) {
      navigate(`/history?date=${encodeURIComponent(dataPoint.date)}`);
    }
  };

  // 异步加载成长数据和分析次数：通过 data-service 自动选择数据源
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, records] = await Promise.all([
          getGrowthData(),
          getAnalysisHistory(),
        ]);
        if (!cancelled) {
          setGrowthData(data);
          setHistoryCount(records.length);
        }
      } catch (err) {
        console.error('加载成长数据失败:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const insights = useMemo(() => {
    return calculateGrowthInsights(growthData);
  }, [growthData]);

  const calculateTrend = (data: GrowthData[], key: keyof GrowthData) => {
    if (data.length < 2) return 'stable';
    const first = data[0][key] as number;
    const last = data[data.length - 1][key] as number;
    if (last > first + 5) return 'up';
    if (last < first - 5) return 'down';
    return 'stable';
  };

  const dimension1Trend = calculateTrend(growthData, 'dimension1');
  const dimension2Trend = calculateTrend(growthData, 'dimension2');
  const dimension3Trend = calculateTrend(growthData, 'dimension3');
  const overallTrend = calculateTrend(growthData, 'overall');

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="w-4 h-4 text-jade" />;
    if (trend === 'down') return <TrendingDown className="w-4 h-4 text-cinnabar" />;
    return <span className="w-4 h-4" />;
  };

  const getTrendText = (trend: string) => {
    if (trend === 'up') return '上升趋势';
    if (trend === 'down') return '下降趋势';
    return '平稳';
  };

  const getTrendColor = (trend: string) => {
    if (trend === 'up') return 'text-jade';
    if (trend === 'down') return 'text-cinnabar';
    return 'text-ink-500';
  };

  const avgScore = growthData.length > 0
    ? Math.round(growthData.reduce((sum, d) => sum + d.overall, 0) / growthData.length)
    : 0;

  const maxScore = growthData.length > 0
    ? Math.max(...growthData.map(d => d.overall))
    : 0;

  /* 最佳作品：取整体评分最高的那一天，作为"最佳"高亮卡片展示 */
  const bestRecord = useMemo(() => {
    if (growthData.length === 0) return null;
    return growthData.reduce((best, cur) => (cur.overall > best.overall ? cur : best), growthData[0]);
  }, [growthData]);

  // historyCount 已通过 useEffect 异步加载,见上方状态声明

  /* 加载中：用骨架屏占位，避免误显示数据不足的空状态 */
  if (loading) {
    return (
      <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
              <BarChart3 className="w-4 h-4 text-cinnabar" />
              <span className="text-sm text-ink-600">个人成长追踪</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
              成长曲线
            </h1>
            <p className="text-ink-600">基于真实分析数据，追踪你的创作能力成长轨迹</p>
          </div>
          {/* Stats Cards 骨架 */}
          <CardSkeleton count={4} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" />
          {/* 图表区骨架 */}
          <div className="bg-rice-50 rounded-2xl p-6 md:p-8 shadow-card mb-8">
            <SkeletonBox className="h-6 w-40 mb-6" />
            <SkeletonBox className="h-80 md:h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  /* 数据不足时显示空状态：完成 3 次以上分析后才展示成长曲线 */
  if (historyCount < 3) {
    return (
      <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
              <BarChart3 className="w-4 h-4 text-cinnabar" />
              <span className="text-sm text-ink-600">个人成长追踪</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
              成长曲线
            </h1>
            <p className="text-ink-600">基于真实分析数据，追踪你的创作能力成长轨迹</p>
          </div>
          <EmptyState
            icon={TrendingUp}
            title="数据还不足以生成曲线"
            desc="完成3次以上分析后即可查看成长趋势"
            actionLabel="去分析"
            to="/analyze"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <BarChart3 className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">个人成长追踪</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
            成长曲线
          </h1>
          <p className="text-ink-600">基于真实分析数据，追踪你的创作能力成长轨迹</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-rice-50 rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <Award className="w-6 h-6 text-gold" />
              <span className="text-sm text-ink-500">平均评分</span>
            </div>
            <div className="font-serif text-3xl font-bold text-ink-900">{avgScore}</div>
          </div>
          <div className="bg-rice-50 rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <TrendingUp className="w-6 h-6 text-jade" />
              <span className="text-sm text-ink-500">最高评分</span>
            </div>
            <div className="font-serif text-3xl font-bold text-ink-900">{maxScore}</div>
          </div>
          <div className="bg-rice-50 rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <Sparkles className="w-6 h-6 text-cinnabar" />
              <span className="text-sm text-ink-500">分析次数</span>
            </div>
            <div className="font-serif text-3xl font-bold text-ink-900">{historyCount}</div>
          </div>
          <div className="bg-rice-50 rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <Layers className="w-6 h-6 text-stone" />
              <span className="text-sm text-ink-500">当前趋势</span>
            </div>
            <div className={`font-serif text-xl font-bold flex items-center gap-2 ${getTrendColor(overallTrend)}`}>
              {getTrendIcon(overallTrend)}
              {getTrendText(overallTrend)}
            </div>
          </div>
        </div>

        {/* Smart Insights */}
        {insights && (
          <div className="bg-rice-50 rounded-2xl p-6 shadow-card mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-cinnabar/10 rounded-lg flex items-center justify-center">
                <Lightbulb className="w-5 h-5 text-cinnabar" />
              </div>
              <div>
                <h3 className="font-serif text-lg font-bold text-ink-900">智能成长洞察</h3>
                <p className="text-sm text-ink-500">基于 {growthData.length} 天的分析数据</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-rice-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-cinnabar" />
                  <span className="text-sm font-medium text-ink-700">整体变化</span>
                </div>
                <p className={`text-2xl font-bold font-serif ${insights.overallChange >= 0 ? 'text-jade' : 'text-cinnabar'}`}>
                  {insights.overallChange >= 0 ? '+' : ''}{insights.overallChange} 分
                </p>
              </div>
              <div className="bg-rice-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-jade" />
                  <span className="text-sm font-medium text-ink-700">最强维度</span>
                </div>
                <p className="text-2xl font-bold font-serif text-ink-900">
                  {insights.strongest}
                </p>
                <p className="text-sm text-ink-500">
                  +{Math.max(insights.d1Change, insights.d2Change, insights.d3Change)} 分
                </p>
              </div>
              <div className="bg-rice-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="w-4 h-4 text-cinnabar" />
                  <span className="text-sm font-medium text-ink-700">波动指数</span>
                </div>
                <p className="text-2xl font-bold font-serif text-ink-900">
                  {insights.volatility}
                </p>
                <p className="text-sm text-ink-500">
                  {insights.volatility < 3 ? '稳定' : insights.volatility < 6 ? '中等' : '波动较大'}
                </p>
              </div>
            </div>
            <div className="bg-gradient-to-r from-cinnabar/5 to-gold/5 rounded-xl p-4 border border-cinnabar/10">
              <p className="text-sm text-ink-700 leading-relaxed">
                {insights.suggestion}
              </p>
            </div>
          </div>
        )}

        {/* Area Chart */}
        <div className="bg-rice-50 rounded-2xl p-6 md:p-8 shadow-card mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
            <h2 className="font-serif text-xl font-bold text-ink-900">能力成长趋势</h2>
            {/* 维度切换按钮组：点击切换显示/隐藏对应曲线 */}
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(DIM_CONFIG) as DimKey[]).map((key) => {
                const cfg = DIM_CONFIG[key];
                const visible = visibleDims[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDim(key)}
                    aria-pressed={visible}
                    className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium border transition-all ${
                      visible
                        ? 'bg-rice-100 text-ink-900 border-ink-900/15 shadow-subtle'
                        : 'bg-rice-50 text-ink-400 border-ink-900/8 hover:bg-rice-100'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: visible ? cfg.stroke : '#cbd0cc' }}
                    />
                    {cfg.name}
                    {visible
                      ? <Eye className="w-3 h-3 text-ink-500" />
                      : <EyeOff className="w-3 h-3 text-ink-400" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-80 md:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growthData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }} onClick={(payload) => handleChartClick(payload as { payload?: GrowthData })}>
                <defs>
                  {/* 主成长曲线（综合）使用朱砂红水墨渐变：cinnabar/30 → cinnabar/0 */}
                  <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c8392c" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#c8392c" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDim1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c41e3a" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#c41e3a" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDim2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2e5fa1" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#2e5fa1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDim3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d4af37" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#d4af37" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ede8df" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#595959', fontSize: 12 }}
                  axisLine={{ stroke: '#ede8df' }}
                  tickLine={{ stroke: '#ede8df' }}
                />
                <YAxis
                  domain={[60, 100]}
                  tick={{ fill: '#595959', fontSize: 12 }}
                  axisLine={{ stroke: '#ede8df' }}
                  tickLine={{ stroke: '#ede8df' }}
                />
                <Tooltip content={<InkTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '16px' }}
                  iconType="circle"
                />
                {visibleDims.dimension1 && (
                  <Area
                    type="monotone"
                    dataKey="dimension1"
                    name="维度一"
                    stroke="#c41e3a"
                    fill="url(#colorDim1)"
                    strokeWidth={2}
                  />
                )}
                {visibleDims.dimension2 && (
                  <Area
                    type="monotone"
                    dataKey="dimension2"
                    name="维度二"
                    stroke="#2e5fa1"
                    fill="url(#colorDim2)"
                    strokeWidth={2}
                  />
                )}
                {visibleDims.dimension3 && (
                  <Area
                    type="monotone"
                    dataKey="dimension3"
                    name="维度三"
                    stroke="#d4af37"
                    fill="url(#colorDim3)"
                    strokeWidth={2}
                  />
                )}
                {visibleDims.overall && (
                  <Area
                    type="monotone"
                    dataKey="overall"
                    name="综合"
                    stroke="#c8392c"
                    fill="url(#growthGradient)"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#c8392c', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: '#c8392c', strokeWidth: 2 }}
                    onClick={(payload) => handleChartClick(payload as { payload?: GrowthData })}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 最佳作品卡片：金色边框 + 朱砂印章效果，突出展示最高分记录 */}
        {bestRecord && (
          <div className="mb-8 bg-gradient-to-br from-gold/8 via-rice-50 to-rice-50 rounded-2xl p-6 md:p-8 shadow-card border-2 border-gold/40 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-gold/10 rounded-full blur-2xl pointer-events-none" />
            {/* 朱砂印章 */}
            <div className="absolute top-5 right-5 w-14 h-14 bg-cinnabar rounded-lg flex items-center justify-center shadow-card rotate-6">
              <span className="font-serif text-white text-base font-bold leading-none tracking-wider">最佳</span>
            </div>
            <div className="relative flex items-center gap-4">
              <div className="w-14 h-14 bg-gold/15 rounded-lg flex items-center justify-center flex-shrink-0">
                <Award className="w-7 h-7 text-gold-dark" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gold-dark font-medium mb-1">最佳表现 · BEST RECORD</p>
                <h3 className="font-serif text-xl font-bold text-ink-900 mb-1">
                  最高评分 <span className="text-gold-dark">{bestRecord.overall}</span> 分
                </h3>
                <p className="text-sm text-ink-600">
                  出现在 <span className="font-medium text-ink-900">{bestRecord.date}</span>
                  ，维度一 {bestRecord.dimension1} / 维度二 {bestRecord.dimension2} / 维度三 {bestRecord.dimension3}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/history?date=${encodeURIComponent(bestRecord.date)}`)}
                className="hidden md:inline-flex items-center gap-1.5 px-4 h-9 bg-ink-900 hover:bg-ink-800 text-rice-100 rounded-md text-sm font-medium transition-colors flex-shrink-0"
              >
                查看当日记录
              </button>
            </div>
          </div>
        )}

        {/* Dimension Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-cinnabar/10 rounded-lg flex items-center justify-center">
                <Layers className="w-5 h-5 text-cinnabar" />
              </div>
              <h3 className="font-serif text-lg font-bold text-ink-900">维度一</h3>
            </div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-ink-500">当前趋势</span>
              <div className={`flex items-center gap-1 ${getTrendColor(dimension1Trend)}`}>
                {getTrendIcon(dimension1Trend)}
                <span className="text-sm font-medium">{getTrendText(dimension1Trend)}</span>
              </div>
            </div>
            {insights && (
              <div className="mb-4 p-3 bg-rice-50 rounded-lg">
                <p className="text-xs text-ink-500">变化幅度</p>
                <p className={`text-lg font-bold font-serif ${insights.d1Change >= 0 ? 'text-jade' : 'text-cinnabar'}`}>
                  {insights.d1Change >= 0 ? '+' : ''}{insights.d1Change} 分
                </p>
              </div>
            )}
            <div className="space-y-3">
              {growthData.slice(-5).reverse().map((data) => (
                <div key={data.date} className="flex items-center justify-between">
                  <span className="text-sm text-ink-500">{data.date}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-cinnabar rounded-full"
                        style={{ width: `${data.dimension1}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-ink-700 w-8">{data.dimension1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-stone/10 rounded-lg flex items-center justify-center">
                <Layers className="w-5 h-5 text-stone" />
              </div>
              <h3 className="font-serif text-lg font-bold text-ink-900">维度二</h3>
            </div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-ink-500">当前趋势</span>
              <div className={`flex items-center gap-1 ${getTrendColor(dimension2Trend)}`}>
                {getTrendIcon(dimension2Trend)}
                <span className="text-sm font-medium">{getTrendText(dimension2Trend)}</span>
              </div>
            </div>
            {insights && (
              <div className="mb-4 p-3 bg-rice-50 rounded-lg">
                <p className="text-xs text-ink-500">变化幅度</p>
                <p className={`text-lg font-bold font-serif ${insights.d2Change >= 0 ? 'text-jade' : 'text-cinnabar'}`}>
                  {insights.d2Change >= 0 ? '+' : ''}{insights.d2Change} 分
                </p>
              </div>
            )}
            <div className="space-y-3">
              {growthData.slice(-5).reverse().map((data) => (
                <div key={data.date} className="flex items-center justify-between">
                  <span className="text-sm text-ink-500">{data.date}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-stone rounded-full"
                        style={{ width: `${data.dimension2}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-ink-700 w-8">{data.dimension2}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
                <Layers className="w-5 h-5 text-gold" />
              </div>
              <h3 className="font-serif text-lg font-bold text-ink-900">维度三</h3>
            </div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-ink-500">当前趋势</span>
              <div className={`flex items-center gap-1 ${getTrendColor(dimension3Trend)}`}>
                {getTrendIcon(dimension3Trend)}
                <span className="text-sm font-medium">{getTrendText(dimension3Trend)}</span>
              </div>
            </div>
            {insights && (
              <div className="mb-4 p-3 bg-rice-50 rounded-lg">
                <p className="text-xs text-ink-500">变化幅度</p>
                <p className={`text-lg font-bold font-serif ${insights.d3Change >= 0 ? 'text-jade' : 'text-cinnabar'}`}>
                  {insights.d3Change >= 0 ? '+' : ''}{insights.d3Change} 分
                </p>
              </div>
            )}
            <div className="space-y-3">
              {growthData.slice(-5).reverse().map((data) => (
                <div key={data.date} className="flex items-center justify-between">
                  <span className="text-sm text-ink-500">{data.date}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gold rounded-full"
                        style={{ width: `${data.dimension3}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-ink-700 w-8">{data.dimension3}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
