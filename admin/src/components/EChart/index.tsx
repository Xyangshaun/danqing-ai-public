// ============================================================
// EChart 组件:echarts-for-react 封装
// 采用 echarts(轻量、构建可靠),满足"数据看板"图表需求
// 主题色融入水墨美学(石青/朱砂/金色)
// ============================================================

import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { memo } from 'react';

interface EChartProps {
  option: EChartsOption;
  height?: number | string;
  loading?: boolean;
  opts?: Record<string, unknown>;
  onEvents?: Record<string, (params: unknown) => void>;
}

const INK_PALETTE = [
  '#2e5c6e',
  '#c9a961',
  '#c8392e',
  '#3e7d5a',
  '#6b6b6b',
  '#8a5a44',
  '#5b8fa3',
  '#a8843c',
];

function EChart({ option, height = 320, loading = false, opts, onEvents }: EChartProps) {
  const mergedOption: EChartsOption = {
    color: INK_PALETTE,
    textStyle: {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 12,
      color: '#6b6b6b',
    },
    grid: { top: 36, right: 20, bottom: 32, left: 48, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(26,26,26,0.92)',
      borderWidth: 0,
      textStyle: { color: '#faf8f3', fontSize: 12 },
    },
    legend: {
      textStyle: { color: '#6b6b6b', fontSize: 12 },
      itemWidth: 12,
      itemHeight: 8,
    },
    ...option,
  };

  return (
    <ReactECharts
      option={mergedOption}
      style={{ height, width: '100%' }}
      showLoading={loading}
      opts={{ renderer: 'canvas', ...(opts ?? {}) }}
      onEvents={onEvents}
      notMerge
      lazyUpdate
    />
  );
}

export default memo(EChart);
export { INK_PALETTE };
