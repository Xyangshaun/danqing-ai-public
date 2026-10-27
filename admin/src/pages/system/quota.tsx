// ============================================================
// 系统管理 - 配额管理
// 列表用 listTenants 现有数据(name/plan/maxSeats/memberCount),避免 N+1
// 行操作"配额详情"抽屉懒加载 getTenantStats(monthlyQuota/quotaUsageRate/monthlyAiCalls/avgScore)
// 行操作"调整配额"Modal 调 updateTenant 改 maxSeats/plan
// 套餐上限参考:listPlans(展示各 plan 的 maxQuota/maxSeats 作为引导)
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import {
  Tag,
  App,
  Modal,
  Form,
  InputNumber,
  Select,
  Drawer,
  Progress,
  Descriptions,
  Statistic,
  Row,
  Col,
  Empty,
  Alert,
  Table,
} from 'antd';
import { BarChartOutlined, EditOutlined } from '@ant-design/icons';
import type {
  AdminTenantListItem,
  AdminTenantStats,
  AdminPlanInfo,
  TenantPlan,
  TenantType,
  TenantStatus,
} from '@/types/api';
import { listTenants, updateTenant } from '@/services/system';
import { getTenantStats } from '@/services/stats';
import { listPlans } from '@/services/subscription';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import {
  PERM,
  PLAN_LABEL,
  PLAN_COLOR,
  PLAN_OPTIONS,
  TENANT_TYPE_LABEL,
  TENANT_TYPE_OPTIONS,
  TENANT_STATUS_LABEL,
  TENANT_STATUS_OPTIONS,
} from '@/constants';

export default function QuotaPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  // 二级只读管理员:隐藏"调整配额"写操作入口
  const readonly = useReadonlyAdmin();

  // ============ 配额详情 抽屉 ============
  const [statsDrawerOpen, setStatsDrawerOpen] = useState(false);
  const [statsTenant, setStatsTenant] = useState<AdminTenantListItem | null>(null);
  const [stats, setStats] = useState<AdminTenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const loadStats = useCallback(async (tenantId: string) => {
    setStatsLoading(true);
    try {
      const res = await getTenantStats(tenantId);
      setStats(res);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const openStatsDrawer = (record: AdminTenantListItem) => {
    setStatsTenant(record);
    setStats(null);
    setStatsDrawerOpen(true);
    loadStats(record.id);
  };

  useEffect(() => {
    if (statsDrawerOpen && statsTenant) {
      loadStats(statsTenant.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsDrawerOpen, statsTenant]);

  // ============ 调整配额 Modal ============
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTenant, setAdjustTenant] = useState<AdminTenantListItem | null>(null);
  const [adjustForm] = Form.useForm();
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [plans, setPlans] = useState<AdminPlanInfo[]>([]);

  useEffect(() => {
    listPlans()
      .then((res) => setPlans(res ?? []))
      .catch(() => setPlans([]));
  }, []);

  const openAdjust = (record: AdminTenantListItem) => {
    setAdjustTenant(record);
    adjustForm.setFieldsValue({
      plan: record.plan,
      maxSeats: record.maxSeats,
    });
    setAdjustOpen(true);
  };

  const onAdjustPlanChange = (plan: TenantPlan) => {
    const p = plans.find((x) => x.plan === plan);
    if (p) {
      adjustForm.setFieldsValue({ maxSeats: p.maxSeats });
    }
  };

  const onAdjustSubmit = async () => {
    if (!adjustTenant) return;
    const values = await adjustForm.validateFields();
    setAdjustSubmitting(true);
    try {
      await updateTenant(adjustTenant.id, {
        plan: values.plan as TenantPlan,
        maxSeats: values.maxSeats as number,
      });
      message.success('配额已调整');
      setAdjustOpen(false);
      tableRef.current?.reload();
    } finally {
      setAdjustSubmitting(false);
    }
  };

  // ============ 列定义 ============
  const columns: ProColumns<AdminTenantListItem>[] = [
    {
      title: '租户名称',
      dataIndex: 'name',
      width: 200,
      fixed: 'left',
      fieldProps: { placeholder: '搜索租户名称' },
      render: (_, r) => <b>{r.name}</b>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueType: 'select',
      fieldProps: { options: TENANT_TYPE_OPTIONS, allowClear: true },
      render: (_, r) => <Tag>{TENANT_TYPE_LABEL[r.type]}</Tag>,
    },
    {
      title: '套餐',
      dataIndex: 'plan',
      width: 100,
      valueType: 'select',
      fieldProps: { options: PLAN_OPTIONS, allowClear: true },
      render: (_, r) => <Tag color={PLAN_COLOR[r.plan]}>{PLAN_LABEL[r.plan]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      valueType: 'select',
      fieldProps: { options: TENANT_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => <Tag color={r.status === 'active' ? 'success' : 'error'}>{TENANT_STATUS_LABEL[r.status]}</Tag>,
    },
    {
      title: '席位使用',
      dataIndex: 'memberCount',
      width: 160,
      hideInSearch: true,
      render: (_, r) => {
        const rate = r.maxSeats > 0 ? Math.min(100, (r.memberCount / r.maxSeats) * 100) : 0;
        const color = rate >= 100 ? '#c8392e' : rate >= 80 ? '#d4a13a' : '#3e7d5a';
        return (
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 12, marginBottom: 2 }}>
              {r.memberCount} / {r.maxSeats} 席
            </div>
            <Progress percent={Math.round(rate)} size="small" strokeColor={color} />
          </div>
        );
      },
    },
    {
      title: '最大席位',
      dataIndex: 'maxSeats',
      width: 90,
      hideInSearch: true,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      hideInSearch: true,
      render: (_, r) => r.createdAt,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      fixed: 'right',
      render: (_, r) => [
        <a key="stats" onClick={() => openStatsDrawer(r)}>
          <BarChartOutlined /> 配额详情
        </a>,
        !readonly && (
          <Access key="adjust" permission={PERM.tenantWrite}>
            <a onClick={() => openAdjust(r)}>
              <EditOutlined /> 调整配额
            </a>
          </Access>
        ),
      ],
    },
  ];

  // ============ 套餐参考表(调整 Modal 内显示) ============
  const planRefColumns = [
    { title: '套餐', dataIndex: 'plan', width: 100, render: (p: TenantPlan) => <Tag color={PLAN_COLOR[p]}>{PLAN_LABEL[p]}</Tag> },
    { title: '月度配额(次)', dataIndex: 'maxQuota', width: 120 },
    { title: '默认席位数', dataIndex: 'maxSeats', width: 110 },
  ];

  return (
    <PageContainer header={{ title: '配额管理', ghost: true }}>
      <ReadonlyAlert />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="配额管理说明"
        description="列表显示租户席位使用情况;点击「配额详情」查看月度 AI 调用配额与使用率;点击「调整配额」可修改套餐与最大席位数。配额上限由套餐决定,可在「订阅管理 → 套餐管理」中调整。"
      />
      <ProTable<AdminTenantListItem>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        size="small"
        search={{ labelWidth: 70, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100], showSizeChanger: true }}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await listTenants({
            page: current,
            pageSize,
            search: rest.name as string | undefined,
            type: rest.type as TenantType | undefined,
            plan: rest.plan as TenantPlan | undefined,
            status: rest.status as TenantStatus | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
      />

      {/* 配额详情 抽屉 */}
      <Drawer
        title={statsTenant ? `配额详情 · ${statsTenant.name}` : '配额详情'}
        open={statsDrawerOpen}
        onClose={() => setStatsDrawerOpen(false)}
        width={640}
        destroyOnClose
      >
        {statsLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>加载中...</div>
        ) : !stats ? (
          <Empty description="暂无统计数据" />
        ) : (
          <div>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="月度 AI 配额"
                  value={stats.monthlyQuota}
                  suffix="次"
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="本月已调用"
                  value={stats.monthlyAiCalls}
                  suffix="次"
                />
              </Col>
            </Row>
            <div style={{ marginTop: 24 }}>
              <Descriptions title="配额使用率" column={1} bordered size="small">
                <Descriptions.Item label="使用率">
                  <Progress
                    percent={Math.min(100, Math.round(stats.quotaUsageRate * 100))}
                    status={stats.quotaUsageRate >= 1 ? 'exception' : stats.quotaUsageRate >= 0.8 ? 'active' : 'normal'}
                    format={(p) => `${p}%`}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="剩余配额">
                  {Math.max(0, stats.monthlyQuota - stats.monthlyAiCalls)} 次
                </Descriptions.Item>
              </Descriptions>
            </div>
            <div style={{ marginTop: 24 }}>
              <Descriptions title="席位与作品" column={2} bordered size="small">
                <Descriptions.Item label="已用席位">{stats.usedSeats}</Descriptions.Item>
                <Descriptions.Item label="最大席位">{stats.maxSeats}</Descriptions.Item>
                <Descriptions.Item label="作品总数">{stats.artworkCount}</Descriptions.Item>
                <Descriptions.Item label="近 7 天新增作品">{stats.last7dArtworks}</Descriptions.Item>
                <Descriptions.Item label="平均评分" span={2}>
                  {stats.avgScore > 0 ? stats.avgScore.toFixed(2) : '暂无'}
                </Descriptions.Item>
              </Descriptions>
            </div>
          </div>
        )}
      </Drawer>

      {/* 调整配额 Modal */}
      <Modal
        title={adjustTenant ? `调整配额 · ${adjustTenant.name}` : '调整配额'}
        open={adjustOpen}
        onOk={onAdjustSubmit}
        onCancel={() => setAdjustOpen(false)}
        confirmLoading={adjustSubmitting}
        width={560}
        destroyOnClose
      >
        <Form form={adjustForm} layout="vertical">
          <Form.Item label="套餐" name="plan" rules={[{ required: true, message: '请选择套餐' }]}>
            <Select options={PLAN_OPTIONS} onChange={onAdjustPlanChange} />
          </Form.Item>
          <Form.Item
            label="最大席位数"
            name="maxSeats"
            rules={[{ required: true, message: '请输入席位数' }]}
            extra="切换套餐会自动填入该套餐的默认席位,可手动覆盖。"
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
        <div style={{ marginTop: 8 }}>
          <Alert
            type="info"
            showIcon
            message="套餐配额参考"
            style={{ marginBottom: 8 }}
          />
          <Table<AdminPlanInfo>
            size="small"
            rowKey="plan"
            pagination={false}
            dataSource={plans}
            columns={planRefColumns}
          />
        </div>
      </Modal>
    </PageContainer>
  );
}
