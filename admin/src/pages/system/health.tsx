// ============================================================
// 系统管理 - 系统健康状态
// - 总体状态(正常/降级/宕机)
// - 各服务状态(数据库/Redis/AI 服务)
// - 系统信息(运行时长/内存/Node 版本)
// - 自动轮询刷新(10s)+ 手动刷新
// ============================================================

import { useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Tag, Button, Switch, Space, Spin, App, Row, Col, Statistic } from 'antd';
import { ReloadOutlined, CheckCircleFilled, CloseCircleFilled, StopFilled } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getSystemHealth } from '@/services/system';
import { formatUptime, formatMemory, formatDateTime } from '@/utils/format';
import { REALTIME_POLL_INTERVAL } from '@/constants';

type ServiceStatus = 'up' | 'down' | 'disabled';

const STATUS_CONFIG: Record<
  'up' | 'degraded' | 'down',
  { label: string; color: string; bg: string }
> = {
  up: { label: '运行正常', color: '#3e7d5a', bg: 'rgba(62, 125, 90, 0.08)' },
  degraded: { label: '服务降级', color: '#c9a961', bg: 'rgba(201, 169, 97, 0.1)' },
  down: { label: '服务异常', color: '#c8392e', bg: 'rgba(200, 57, 46, 0.08)' },
};

const SERVICE_LABEL: Record<string, string> = {
  database: '数据库',
  redis: 'Redis 缓存',
  aiService: 'AI 服务',
};

export default function SystemHealthPage() {
  const { message } = App.useApp();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const healthQ = useQuery({
    queryKey: ['system-health'],
    queryFn: getSystemHealth,
    refetchInterval: autoRefresh ? REALTIME_POLL_INTERVAL * 2 : false,
  });

  const onManualRefresh = () => {
    healthQ.refetch();
    message.info('正在刷新...');
  };

  const data = healthQ.data;
  const isLoading = healthQ.isLoading;

  const renderServiceIcon = (status: ServiceStatus) => {
    if (status === 'up') return <CheckCircleFilled style={{ color: '#3e7d5a', fontSize: 18 }} />;
    if (status === 'down') return <CloseCircleFilled style={{ color: '#c8392e', fontSize: 18 }} />;
    return <StopFilled style={{ color: '#bfb8a8', fontSize: 18 }} />;
  };

  return (
    <PageContainer
      header={{ title: '系统健康', ghost: true }}
      extra={[
        <Space key="controls" size={12}>
          <span style={{ fontSize: 13, color: '#6b6b6b' }}>自动刷新</span>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
          <Button icon={<ReloadOutlined />} onClick={onManualRefresh} size="small">
            刷新
          </Button>
        </Space>,
      ]}
    >
      <Spin spinning={isLoading && !data}>
        {data && (
          <>
            {/* 总体状态 */}
            <Card
              style={{
                marginBottom: 16,
                background: STATUS_CONFIG[data.status].bg,
                borderColor: STATUS_CONFIG[data.status].color,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {renderServiceIcon(
                    data.status === 'up' ? 'up' : data.status === 'degraded' ? 'up' : 'down',
                  )}
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: STATUS_CONFIG[data.status].color }}>
                      {STATUS_CONFIG[data.status].label}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b6b6b' }}>
                      最后检查:{formatDateTime(data.timestamp)}
                    </div>
                  </div>
                </div>
                <Tag
                  color={data.status === 'up' ? 'success' : data.status === 'degraded' ? 'warning' : 'error'}
                  style={{ fontSize: 13, padding: '4px 12px' }}
                >
                  {STATUS_CONFIG[data.status].label}
                </Tag>
              </div>
            </Card>

            {/* 各服务状态 */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              {Object.entries(data.services).map(([key, status]) => {
                const serviceStatus = status as ServiceStatus;
                return (
                  <Col key={key} xs={24} sm={8}>
                    <Card
                      style={{
                        borderColor: serviceStatus === 'up' ? '#3e7d5a' : serviceStatus === 'down' ? '#c8392e' : '#bfb8a8',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {renderServiceIcon(serviceStatus)}
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>
                            {SERVICE_LABEL[key] ?? key}
                          </div>
                          <div style={{ fontSize: 12, color: serviceStatus === 'up' ? '#3e7d5a' : '#c8392e' }}>
                            {serviceStatus === 'up' ? '正常' : serviceStatus === 'down' ? '异常' : '已禁用'}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>

            {/* 系统信息 */}
            <Card title="系统信息">
              <Row gutter={[24, 24]}>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="运行时长"
                    value={formatUptime(data.uptime)}
                    valueStyle={{ fontSize: 18, color: '#2e5c6e' }}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="内存使用"
                    value={formatMemory(data.memoryUsageMb)}
                    valueStyle={{ fontSize: 18, color: '#2e5c6e' }}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="Node 版本"
                    value={data.nodeVersion}
                    valueStyle={{ fontSize: 18, color: '#2e5c6e' }}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="检查时间"
                    value={formatDateTime(data.timestamp)}
                    valueStyle={{ fontSize: 14, color: '#6b6b6b' }}
                  />
                </Col>
              </Row>
            </Card>
          </>
        )}
      </Spin>
    </PageContainer>
  );
}
