// ============================================================
// 数据看板 - 可观测性(指标监控)
// AI 图像生成相关的关键指标与告警,深色大屏风格(对齐实时大屏)
// - /metrics/ai 每 60s 轮询
// - /metrics/sla 每 5 分钟轮询
// ============================================================

import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Row, Col, Tag, Spin, Alert, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getMetricsAi, getMetricsSla } from '@/services/metrics';
import { formatNumber, formatPercent, formatDuration } from '@/utils/format';
import type { EChartsOption } from 'echarts';
import EChart from '@/components/EChart';

/** 轮询间隔 */
const AI_POLL_INTERVAL = 60_000;
const SLA_POLL_INTERVAL = 5 * 60_000;

/** SLA 达标天数 */
const SLA_DAYS = 7;

/** 告警阈值(说明用,规则由后端环境变量控制,此处仅展示) */
const ALERT_RULES = [
  {
    rule: 'SLA 达标率',
    condition: '< 99%',
    level: 'warning',
    levelLabel: '警告',
    action: '向值班群推送告警通知',
  },
  {
    rule: 'AI 降级率',
    condition: '> 10%',
    level: 'warning',
    levelLabel: '警告',
    action: '向值班群推送告警通知',
  },
  {
    rule: '静默窗口',
    condition: '30 分钟',
    level: 'info',
    levelLabel: '规则',
    action: '同一告警 30 分钟内不重复触发',
  },
];

export default function ObservabilityPage() {
  const aiQ = useQuery({
    queryKey: ['metrics', 'ai'],
    queryFn: getMetricsAi,
    refetchInterval: AI_POLL_INTERVAL,
  });
  const slaQ = useQuery({
    queryKey: ['metrics', 'sla', SLA_DAYS],
    queryFn: () => getMetricsSla(SLA_DAYS),
    refetchInterval: SLA_POLL_INTERVAL,
  });

  const ai = aiQ.data;

  // SLA 达标率逐日趋势(百分比)
  const slaTrendOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${Number(v).toFixed(2)}%` },
    legend: { data: ['SLA 达标率'], textStyle: { color: '#a8a39a' } },
    grid: { top: 40, right: 30, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: slaQ.data?.dailySla.map((d) => d.date) ?? [],
      axisLabel: { color: '#a8a39a', fontSize: 11 },
      axisLine: { lineStyle: { color: '#3a3a3a' } },
    },
    yAxis: {
      type: 'value',
      min: 90,
      max: 100,
      axisLabel: { color: '#a8a39a', fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      {
        name: 'SLA 达标率',
        type: 'line',
        smooth: true,
        data: slaQ.data?.dailySla.map((d) => Number((d.complianceRate * 100).toFixed(2))) ?? [],
        lineStyle: { color: '#3e7d5a', width: 2 },
        itemStyle: { color: '#3e7d5a' },
        areaStyle: { color: 'rgba(62,125,90,0.15)' },
      },
    ],
  };

  // 成本逐日趋势(元)
  const costTrendOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => `¥${Number(v).toFixed(2)}`,
    },
    legend: { data: ['成本(元)'], textStyle: { color: '#a8a39a' } },
    grid: { top: 40, right: 30, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: ai?.costByDay.map((c) => c.date) ?? [],
      axisLabel: { color: '#a8a39a', fontSize: 11 },
      axisLine: { lineStyle: { color: '#3a3a3a' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a8a39a', fontSize: 11, formatter: '¥{value}' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      {
        name: '成本(元)',
        type: 'line',
        smooth: true,
        areaStyle: { color: 'rgba(201,169,97,0.15)' },
        data: ai?.costByDay.map((c) => Number(c.costYuan.toFixed(2))) ?? [],
        lineStyle: { color: '#c9a961', width: 2 },
        itemStyle: { color: '#c9a961' },
      },
    ],
  };

  return (
    <PageContainer header={{ title: '可观测性', ghost: true }}>
      <div className="dq-realtime-screen">
        <div className="dq-screen-title">
          指标监控
          <Tag color="green" style={{ marginLeft: 8 }}>
            ● LIVE
          </Tag>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a8a39a' }}>
            AI 每 {AI_POLL_INTERVAL / 1000}s 轮询 · SLA 每 {SLA_POLL_INTERVAL / 1000 / 60} 分钟轮询
          </span>
        </div>

        {aiQ.isError || slaQ.isError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="可观测性数据获取失败"
            description="请稍后重试,或检查后端 /api/admin/metrics 服务是否可用。"
          />
        ) : null}

        <Spin spinning={(aiQ.isLoading && !ai) || (slaQ.isLoading && !slaQ.data)}>
          {/* KPI 卡片 */}
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">SLA 达标率</div>
                <div className="dq-screen-value" style={{ fontSize: 24 }}>
                  {formatPercent(ai?.slaComplianceRate)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag color={(ai?.slaComplianceRate ?? 0) >= 0.99 ? 'green' : 'red'}>
                    {(ai?.slaComplianceRate ?? 0) >= 0.99 ? '达标' : '未达标'}
                  </Tag>
                </div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">AI 降级率</div>
                <div className="dq-screen-value" style={{ fontSize: 24 }}>
                  {formatPercent(ai?.aiFallbackRate)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag color={(ai?.aiFallbackRate ?? 0) <= 0.1 ? 'green' : 'red'}>
                    {(ai?.aiFallbackRate ?? 0) <= 0.1 ? '正常' : '偏高'}
                  </Tag>
                </div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">分析请求量</div>
                <div className="dq-screen-value" style={{ fontSize: 24 }}>
                  {formatNumber(ai?.analysis.total)}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(240,237,228,0.6)' }}>
                  成功率 {formatPercent(ai?.analysis.successRate)}
                </div>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="dq-screen-card">
                <div className="dq-screen-label">平均耗时</div>
                <div className="dq-screen-value" style={{ fontSize: 24 }}>
                  {formatDuration(ai?.analysis.avgDurationMs)}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(240,237,228,0.6)' }}>
                  分析任务平均响应时间
                </div>
              </div>
            </Col>
          </Row>

          {/* 双提供商可用性 */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <div className="dq-screen-card">
                <div className="dq-screen-label" style={{ fontSize: 14, color: '#c9a961' }}>
                  GLM 提供商可用性
                </div>
                <div className="dq-screen-value" style={{ fontSize: 28 }}>
                  {formatPercent(ai?.providerAvailability.glm.successRate)}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(240,237,228,0.6)' }}>
                  本轮切换次数 {formatNumber(ai?.providerAvailability.glm.switchCount)}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="dq-screen-card">
                <div className="dq-screen-label" style={{ fontSize: 14, color: '#5b8fa3' }}>
                  TRAE 提供商可用性
                </div>
                <div className="dq-screen-value" style={{ fontSize: 28 }}>
                  {formatPercent(ai?.providerAvailability.trae.successRate)}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(240,237,228,0.6)' }}>
                  本轮切换次数 {formatNumber(ai?.providerAvailability.trae.switchCount)}
                </div>
              </div>
            </Col>
          </Row>

          {/* 趋势图 */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <ProCard
                title={<span style={{ color: '#f0ede4' }}>SLA 达标率逐日趋势</span>}
                style={{ background: 'transparent', border: 'none' }}
                bodyStyle={{ padding: 0 }}
              >
                <EChart option={slaTrendOption} height={300} />
              </ProCard>
            </Col>
            <Col xs={24} md={12}>
              <ProCard
                title={<span style={{ color: '#f0ede4' }}>成本逐日趋势</span>}
                style={{ background: 'transparent', border: 'none' }}
                bodyStyle={{ padding: 0 }}
              >
                <EChart option={costTrendOption} height={300} />
              </ProCard>
            </Col>
          </Row>

          {/* 告警配置说明 */}
          <div
            style={{
              marginTop: 16,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(201,169,97,0.15)',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 14, color: '#f0ede4', fontWeight: 600, marginBottom: 12 }}>
              告警配置说明
            </div>
            <Table
              size="small"
              rowKey="rule"
              pagination={false}
              dataSource={ALERT_RULES}
              columns={[
                { title: '指标/规则', dataIndex: 'rule', width: 160 },
                { title: '触发条件', dataIndex: 'condition', width: 160 },
                {
                  title: '级别',
                  dataIndex: 'level',
                  width: 100,
                  render: (_, r) => <Tag color={r.level}>{r.levelLabel}</Tag>,
                },
                { title: '动作', dataIndex: 'action' },
              ]}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(240,237,228,0.5)' }}>
              说明:告警阈值由后端环境变量控制(如 SLA_ALERT_THRESHOLD、FALLBACK_RATE_ALERT_THRESHOLD、ALERT_SILENCE_MS),此处仅作展示,不提供编辑。
            </div>
          </div>
        </Spin>
      </div>
    </PageContainer>
  );
}
