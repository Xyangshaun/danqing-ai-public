// ============================================================
// 数据看板 - 总览
// - 核心指标卡片(DAU/MAU/作品数/AI调用量/营收等)
// - 成长趋势折线图(日/周/月维度)
// - AI 成本柱状图
// - 实时指标快照
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components';
import { Segmented, Spin, Row, Col, App } from 'antd';
import type { EChartsOption } from 'echarts';
import {
  UserOutlined,
  PictureOutlined,
  RobotOutlined,
  TeamOutlined,
  RiseOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import EChart from '@/components/EChart';
import {
  getStatsOverview,
  getStatsGrowth,
  getStatsAiCost,
  getStatsRealtime,
} from '@/services/stats';
import { formatNumber, formatRelativeTime, lastNDaysRange, dayjs } from '@/utils/format';
import type {
  AdminStatsOverview,
  AdminStatsGrowthResponse,
  AdminStatsAiCostResponse,
  AdminStatsRealtime,
} from '@/types/api';

type Granularity = 'day' | 'week' | 'month';

export default function DashboardOverviewPage() {
  const { message } = App.useApp();
  const [granularity, setGranularity] = useState<Granularity>('day');

  const range = useMemo(() => lastNDaysRange(30), []);

  const overviewQ = useQuery<AdminStatsOverview>({
    queryKey: ['stats', 'overview'],
    queryFn: getStatsOverview,
    refetchInterval: 60_000,
  });

  const growthQ = useQuery<AdminStatsGrowthResponse>({
    queryKey: ['stats', 'growth', granularity, range.start, range.end],
    queryFn: () =>
      getStatsGrowth({
        granularity,
        startDate: range.start,
        endDate: range.end,
        metric: 'users',
      }),
  });

  const aiCostQ = useQuery<AdminStatsAiCostResponse>({
    queryKey: ['stats', 'ai-cost', range.start, range.end],
    queryFn: () =>
      getStatsAiCost({
        startDate: range.start,
        endDate: range.end,
        groupBy: 'day',
      }),
  });

  const realtimeQ = useQuery<AdminStatsRealtime>({
    queryKey: ['stats', 'realtime'],
    queryFn: getStatsRealtime,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (overviewQ.error) message.error('总览数据加载失败');
  }, [overviewQ.error, message]);

  const ov = overviewQ.data;

  const growthChartOption: EChartsOption = useMemo(() => {
    const points = growthQ.data?.dataPoints ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['新增', '累计'] },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => dayjs(p.date).format('MM-DD')),
        axisLabel: { fontSize: 11 },
      },
      yAxis: [
        { type: 'value', name: '新增' },
        { type: 'value', name: '累计' },
      ],
      series: [
        {
          name: '新增',
          type: 'bar',
          data: points.map((p) => p.count),
          itemStyle: { color: '#2e5c6e', borderRadius: [3, 3, 0, 0] },
          barWidth: '45%',
        },
        {
          name: '累计',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((p) => p.cumulative),
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#c9a961', width: 2 },
          itemStyle: { color: '#c9a961' },
        },
      ],
    };
  }, [growthQ.data]);

  const aiCostChartOption: EChartsOption = useMemo(() => {
    const stats = aiCostQ.data?.stats ?? [];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['调用次数', '估算成本(元)'] },
      xAxis: {
        type: 'category',
        data: stats.map((s) => s.dimension),
        axisLabel: { fontSize: 11 },
      },
      yAxis: [
        { type: 'value', name: '次数' },
        { type: 'value', name: '成本(元)' },
      ],
      series: [
        {
          name: '调用次数',
          type: 'bar',
          data: stats.map((s) => s.callCount),
          itemStyle: { color: '#2e5c6e' },
        },
        {
          name: '估算成本(元)',
          type: 'line',
          yAxisIndex: 1,
          data: stats.map((s) => Number(s.estimatedCost.toFixed(2))),
          smooth: true,
          lineStyle: { color: '#c8392e', width: 2 },
          itemStyle: { color: '#c8392e' },
        },
      ],
    };
  }, [aiCostQ.data]);

  return (
    <PageContainer
      header={{
        title: '数据总览',
        ghost: true,
        subTitle: `数据更新于 ${ov ? formatRelativeTime(ov.timestamp) : '-'}`,
      }}
    >
      <Spin spinning={overviewQ.isLoading}>
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '日活用户(DAU)',
                value: ov?.dau ?? 0,
                icon: <UserOutlined style={{ fontSize: 20, color: '#2e5c6e' }} />,
                description: (
                  <span style={{ fontSize: 12, color: '#6b6b6b' }}>
                    今日新增 {ov?.todayNewUsers ?? 0}
                  </span>
                ),
              }}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '月活用户(MAU)',
                value: ov?.mau ?? 0,
                icon: <TeamOutlined style={{ fontSize: 20, color: '#c9a961' }} />,
              }}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '总作品数',
                value: ov?.totalArtworks ?? 0,
                icon: <PictureOutlined style={{ fontSize: 20, color: '#3e7d5a' }} />,
                description: (
                  <span style={{ fontSize: 12, color: '#6b6b6b' }}>
                    今日新增 {ov?.todayNewArtworks ?? 0}
                  </span>
                ),
              }}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '今日 AI 调用',
                value: ov?.todayAiCalls ?? 0,
                icon: <RobotOutlined style={{ fontSize: 20, color: '#c8392e' }} />,
              }}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '总用户数',
                value: ov?.totalUsers ?? 0,
                icon: <RiseOutlined style={{ fontSize: 20, color: '#8a5a44' }} />,
              }}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <StatisticCard
              statistic={{
                title: '总租户数',
                value: ov?.totalTenants ?? 0,
                icon: <PlusOutlined style={{ fontSize: 20, color: '#6b6b6b' }} />,
              }}
            />
          </Col>
        </Row>
      </Spin>

      <ProCard
        title="成长趋势"
        extra={
          <Segmented
            size="small"
            value={granularity}
            onChange={(v) => setGranularity(v as Granularity)}
            options={[
              { label: '日', value: 'day' },
              { label: '周', value: 'week' },
              { label: '月', value: 'month' },
            ]}
          />
        }
        style={{ marginTop: 12 }}
        bodyStyle={{ padding: 16 }}
      >
        <Spin spinning={growthQ.isLoading}>
          <EChart option={growthChartOption} height={320} />
        </Spin>
      </ProCard>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} xl={16}>
          <ProCard title="AI 成本统计" bodyStyle={{ padding: 16 }}>
            <Spin spinning={aiCostQ.isLoading}>
              <EChart option={aiCostChartOption} height={300} />
            </Spin>
          </ProCard>
        </Col>
        <Col xs={24} xl={8}>
          <ProCard title="实时指标" bodyStyle={{ padding: 16 }}>
            <Spin spinning={realtimeQ.isLoading}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="dq-stat-card">
                  <div className="dq-stat-label">在线用户</div>
                  <div className="dq-stat-value">{formatNumber(realtimeQ.data?.onlineUsers)}</div>
                </div>
                <div className="dq-stat-card">
                  <div className="dq-stat-label">处理中任务</div>
                  <div className="dq-stat-value">{formatNumber(realtimeQ.data?.pendingTasks)}</div>
                </div>
                <div className="dq-stat-card">
                  <div className="dq-stat-label">今日 AI 调用</div>
                  <div className="dq-stat-value">{formatNumber(realtimeQ.data?.todayAiCalls)}</div>
                </div>
                <div className="dq-stat-card">
                  <div className="dq-stat-label">系统负载</div>
                  <div className="dq-stat-value">
                    {((realtimeQ.data?.systemLoad ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#6b6b6b', textAlign: 'right' }}>
                更新于 {realtimeQ.data ? formatRelativeTime(realtimeQ.data.timestamp) : '-'}
              </div>
            </Spin>
          </ProCard>
        </Col>
      </Row>
    </PageContainer>
  );
}
