// ============================================================
// 维度雷达图(Recharts RadarChart 封装,报告/分析页共用)
// ============================================================

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type { RadarDataPoint } from '../../types/api-contract';

interface ReportRadarChartProps {
  data: RadarDataPoint[];
  /** 容器高度(px) */
  height?: number;
  /** 是否显示刻度环标签(打印模板建议关闭以保持简洁) */
  showRadiusLabel?: boolean;
}

export default function ReportRadarChart({
  data,
  height = 260,
  showRadiusLabel = false,
}: ReportRadarChartProps) {
  if (data.length < 3) {
    // 雷达图至少 3 个维度才有意义;不足时降级为条形列表
    return (
      <div className="space-y-2" style={{ minHeight: height / 2 }}>
        {data.map((d) => (
          <div key={d.dimension} className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-500">{d.label}</span>
            <div className="flex-1 h-2 bg-rice-300 rounded-full overflow-hidden">
              <div
                className="h-full bg-cinnabar rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }}
              />
            </div>
            <span className="w-8 text-right text-xs font-mono text-ink-700">{d.score}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }} role="img" aria-label="维度雷达图">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e0d9c9" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: '#2d2d2d', fontSize: 12 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tickCount={5}
            tick={showRadiusLabel ? { fill: '#a3a3a3', fontSize: 10 } : false}
            axisLine={false}
          />
          <Radar
            name="得分"
            dataKey="score"
            stroke="#c41e3a"
            fill="#c41e3a"
            fillOpacity={0.25}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
