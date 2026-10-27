// ============================================================
// 数据看板 - 实时大屏
// 轮询拉取实时数据,深色大屏风格
// ============================================================

import { useEffect, useState } from 'react';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Row, Col, Tag, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { REALTIME_POLL_INTERVAL } from '@/constants';
import { getStatsRealtime, getStatsOverview } from '@/services/stats';
import { formatNumber, formatRelativeTime, formatLoad } from '@/utils/format';
import type { EChartsOption } from 'echarts';
import EChart from '@/components/EChart';

export default function RealtimePage() {
  const [history, setHistory] = useState<{ time: string; calls: number; online: number }[]>([]);

  const realtimeQ = useQuery({
    queryKey: ['stats', 'realtime-screen'],
    queryFn: getStatsRealtime,
    refetchInterval: REALTIME_POLL_INTERVAL,
  });
  const overviewQ = useQuery({
    queryKey: ['stats', 'overview-screen'],
    queryFn: getStatsOverview,
    refetchInterval: 60_000,
  });

  // 累积历史曲线(本地维护最近 30 个点)
  useEffect(() => {
    if (realtimeQ.data) {
      const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      setHistory((prev) => {
        const next = [
          ...prev,
          { time: now, calls: realtimeQ.data!.todayAiCalls, online: realtimeQ.data!.onlineUsers },
        ];
        return next.slice(-30);
      });
    }
  }, [realtimeQ.data?.timestamp]);

  const rt = realtimeQ.data;

  const trendOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: { data: ['在线用户', '今日 AI 调用'], textStyle: { color: '#a8a39a' } },
    grid: { top: 40, right: 30, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: history.map((h) => h.time),
      axisLabel: { color: '#a8a39a', fontSize: 11 },
      axisLine: { lineStyle: { color: '#3a3a3a' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a8a39a', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      {
        name: '在线用户',
        type: 'line',
        smooth: true,
        data: history.map((h) => h.online),
        lineStyle: { color: '#c9a961', width: 2 },
        itemStyle: { color: '#c9a961' },
        areaStyle: { color: 'rgba(201,169,97,0.12)' },
      },
      {
        name: '今日 AI 调用',
        type: 'line',
        smooth: true,
        data: history.map((h) => h.calls),
        lineStyle: { color: '#2e5c6e', width: 2 },
        itemStyle: { color: '#5b8fa3' },
        areaStyle: { color: 'rgba(91,143,163,0.12)' },
      },
    ],
  };

  return (
    <PageContainer header={{ title: '实时大屏', ghost: true }}>
      <div className="dq-realtime-screen">
        <div className="dq-screen-title">
          实时监控
          <Tag color="green" style={{ marginLeft: 8 }}>
            ● LIVE
          </Tag>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a8a39a' }}>
            更新于 {rt ? formatRelativeTime(rt.timestamp) : '-'} · 每 {REALTIME_POLL_INTERVAL / 1000}
            s 轮询
          </span>
        </div>

        <Spin spinning={realtimeQ.isLoading && !rt}>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">在线用户</div>
                <div className="dq-screen-value">{formatNumber(rt?.onlineUsers)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">今日 AI 调用</div>
                <div className="dq-screen-value">{formatNumber(rt?.todayAiCalls)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">处理中任务</div>
                <div className="dq-screen-value">{formatNumber(rt?.pendingTasks)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">系统负载</div>
                <div className="dq-screen-value">{formatLoad(rt?.systemLoad)}</div>
              </div>
            </Col>
          </Row>

          {/* Phase 5:待裁定争议实时可见(仲裁积压预警) */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">待裁定争议</div>
                <div
                  className="dq-screen-value"
                  style={{ color: (rt?.openDisputes ?? 0) > 0 ? '#c0504d' : undefined }}
                >
                  {formatNumber(rt?.openDisputes)}
                </div>
              </div>
            </Col>
          </Row>

          <ProCard
            title={<span style={{ color: '#f0ede4' }}>实时趋势</span>}
            style={{ marginTop: 16, background: 'transparent', border: 'none' }}
            bodyStyle={{ padding: 0 }}
          >
            <EChart option={trendOption} height={340} />
          </ProCard>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">DAU</div>
                <div className="dq-screen-value">{formatNumber(overviewQ.data?.dau)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">MAU</div>
                <div className="dq-screen-value">{formatNumber(overviewQ.data?.mau)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">总作品数</div>
                <div className="dq-screen-value">{formatNumber(overviewQ.data?.totalArtworks)}</div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">总租户数</div>
                <div className="dq-screen-value">{formatNumber(overviewQ.data?.totalTenants)}</div>
              </div>
            </Col>
          </Row>
        </Spin>
      </div>
    </PageContainer>
  );
}
