// ============================================================
// 数据看板 - 租户下钻
// 选择租户查看其统计明细
// ============================================================

import { useState } from 'react';
import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components';
import { Select, Spin, Row, Col, Progress, Empty, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listTenants } from '@/services/system';
import { getTenantStats } from '@/services/stats';
import { formatNumber, formatPercent } from '@/utils/format';
import { PLAN_LABEL, PLAN_COLOR } from '@/constants';

export default function TenantDrilldownPage() {
  const [tenantId, setTenantId] = useState<string | undefined>();

  const tenantsQ = useQuery({
    queryKey: ['tenants', 'options'],
    queryFn: () => listTenants({ page: 1, pageSize: 100 }),
    staleTime: 5 * 60_000,
  });

  const statsQ = useQuery({
    queryKey: ['stats', 'tenant', tenantId],
    queryFn: () => getTenantStats(tenantId!),
    enabled: !!tenantId,
  });

  const s = statsQ.data;

  return (
    <PageContainer header={{ title: '租户下钻', ghost: true }}>
      <ProCard
        title="选择租户"
        bodyStyle={{ padding: 16 }}
        extra={
          <Select
            showSearch
            style={{ width: 320 }}
            placeholder="搜索/选择租户"
            value={tenantId}
            onChange={setTenantId}
            options={(tenantsQ.data?.items ?? []).map((t) => ({
              value: t.id,
              label: `${t.name}(${t.id.slice(0, 8)})`,
            }))}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            loading={tenantsQ.isLoading}
          />
        }
      >
        {!tenantId ? (
          <Empty description="请选择租户查看统计明细" />
        ) : (
          <Spin spinning={statsQ.isLoading}>
            {!s ? (
              <Empty description="暂无数据" />
            ) : (
              <>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{s.tenantName}</span>
                  <Tag color={PLAN_COLOR[s.plan]}>{PLAN_LABEL[s.plan]}</Tag>
                  <span style={{ fontSize: 12, color: '#6b6b6b' }}>ID: {s.tenantId}</span>
                </div>

                <Row gutter={[12, 12]}>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard statistic={{ title: '用户数', value: s.userCount }} />
                  </Col>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard statistic={{ title: '作品数', value: s.artworkCount }} />
                  </Col>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard statistic={{ title: '当月 AI 调用', value: s.monthlyAiCalls }} />
                  </Col>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard
                      statistic={{
                        title: '近 7 日作品',
                        value: s.last7dArtworks,
                      }}
                    />
                  </Col>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard statistic={{ title: '平均评分', value: s.avgScore }} />
                  </Col>
                  <Col xs={12} md={6} xl={4}>
                    <StatisticCard statistic={{ title: '席位使用', value: `${s.usedSeats}/${s.maxSeats}` }} />
                  </Col>
                </Row>

                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                  <Col xs={24} md={12}>
                    <div className="dq-stat-card">
                      <div className="dq-stat-label">
                        配额使用率
                        {s.monthlyQuota === -1 && (
                          <Tag style={{ marginLeft: 8 }}>无限额</Tag>
                        )}
                      </div>
                      <Progress
                        percent={
                          s.monthlyQuota === -1
                            ? 0
                            : Math.min(100, Math.round(s.quotaUsageRate * 100))
                        }
                        status={
                          s.monthlyQuota === -1
                            ? 'active'
                            : s.quotaUsageRate > 0.9
                              ? 'exception'
                              : 'normal'
                        }
                        format={() =>
                          s.monthlyQuota === -1 ? '无限' : `${formatNumber(s.monthlyAiCalls)} / ${s.monthlyQuota === -1 ? '∞' : s.monthlyQuota}`
                        }
                      />
                    </div>
                  </Col>
                  <Col xs={24} md={12}>
                    <div className="dq-stat-card">
                      <div className="dq-stat-label">席位使用率</div>
                      <Progress
                        percent={s.maxSeats > 0 ? Math.round((s.usedSeats / s.maxSeats) * 100) : 0}
                        status={s.usedSeats / s.maxSeats > 0.9 ? 'exception' : 'normal'}
                        format={() => `${s.usedSeats} / ${s.maxSeats}`}
                      />
                      <div style={{ marginTop: 8, fontSize: 12, color: '#6b6b6b' }}>
                        使用率 {formatPercent(s.maxSeats > 0 ? s.usedSeats / s.maxSeats : 0)}
                      </div>
                    </div>
                  </Col>
                </Row>
              </>
            )}
          </Spin>
        )}
      </ProCard>
    </PageContainer>
  );
}
