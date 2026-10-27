// ============================================================
// 订阅管理 - 订阅列表
// - 搜索(租户)+ 筛选(套餐/状态/日期)+ 分页
// - 取消订阅(周期结束生效,二次确认)
// - 退款处理(表单:金额 + 原因,二次确认)
// - 跳转订阅详情
// ============================================================

import { useRef, useState } from 'react';
import { history } from '@umijs/max';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Tag, App, Modal, Form, Input, InputNumber, Alert } from 'antd';
import { EyeOutlined, StopOutlined, RollbackOutlined } from '@ant-design/icons';
import type {
  AdminSubscriptionListItem,
  TenantPlan,
  SubscriptionStatus,
} from '@/types/api';
import {
  listSubscriptions,
  cancelSubscription,
  refundSubscription,
} from '@/services/subscription';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { useConfirmAction } from '@/components/ConfirmAction';
import {
  PERM,
  PLAN_LABEL,
  PLAN_COLOR,
  PLAN_OPTIONS,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_COLOR,
  SUBSCRIPTION_STATUS_OPTIONS,
} from '@/constants';
import { formatDateTime, formatCurrency } from '@/utils/format';

export default function SubscriptionListPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏取消/退款写操作入口
  const readonly = useReadonlyAdmin();
  const [refundOpen, setRefundOpen] = useState<AdminSubscriptionListItem | null>(null);
  const [refundForm] = Form.useForm();

  const onCancel = (record: AdminSubscriptionListItem) => {
    confirm(
      {
        title: '取消订阅',
        content: (
          <div>
            确认取消租户「<b>{record.tenantName}</b>」的订阅?
            <br />
            将在当前周期结束(<b>{formatDateTime(record.periodEnd)}</b>)生效,届时状态变为已取消。
          </div>
        ),
        okText: '取消订阅',
        danger: true,
        requireText: '取消',
      },
      () => cancelSubscription(record.id),
    ).then((res) => {
      if (res) {
        message.success(`订阅将在 ${formatDateTime(res.periodEnd)} 后取消`);
        tableRef.current?.reload();
      }
    });
  };

  const openRefund = (record: AdminSubscriptionListItem) => {
    refundForm.resetFields();
    refundForm.setFieldsValue({ amount: record.amount, reason: '', externalRefundId: '' });
    setRefundOpen(record);
  };

  const onRefundSubmit = async () => {
    if (!refundOpen) return;
    const values = await refundForm.validateFields();
    const res = await refundSubscription(refundOpen.id, {
      amount: values.amount as number,
      reason: values.reason as string,
      externalRefundId: values.externalRefundId || undefined,
    });
    message.success(`退款成功:已退 ${formatCurrency(res.refundedAmount)}`);
    setRefundOpen(null);
    tableRef.current?.reload();
  };

  const columns: ProColumns<AdminSubscriptionListItem>[] = [
    {
      title: '租户',
      dataIndex: 'tenantName',
      width: 180,
      fixed: 'left',
      hideInSearch: true,
      render: (_, r) => (
        <a onClick={() => history.push(`/subscription/detail/${r.id}`)}>{r.tenantName}</a>
      ),
    },
    {
      title: '租户 ID',
      dataIndex: 'tenantId',
      hideInTable: true,
      fieldProps: { placeholder: '按租户 ID 精确筛选' },
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
      width: 100,
      valueType: 'select',
      fieldProps: { options: SUBSCRIPTION_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => (
        <span>
          <span
            className="dq-status-dot"
            style={{
              background:
                r.status === 'active'
                  ? '#3e7d5a'
                  : r.status === 'past_due'
                    ? '#c9a961'
                    : r.status === 'canceled'
                      ? '#bfb8a8'
                      : '#c8392e',
            }}
          />
          <Tag color={SUBSCRIPTION_STATUS_COLOR[r.status]} style={{ margin: 0 }}>
            {SUBSCRIPTION_STATUS_LABEL[r.status]}
          </Tag>
          {r.cancelAtPeriodEnd && r.status === 'active' && (
            <Tag color="warning" style={{ marginLeft: 4 }}>
              待取消
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 110,
      hideInSearch: true,
      sorter: true,
      render: (_, r) => <b style={{ color: '#c9a961' }}>{formatCurrency(r.amount, r.currency)}</b>,
    },
    {
      title: '席位数',
      dataIndex: 'seats',
      width: 80,
      hideInSearch: true,
    },
    {
      title: '周期开始',
      dataIndex: 'periodStart',
      width: 160,
      hideInSearch: true,
      render: (_, r) => formatDateTime(r.periodStart),
    },
    {
      title: '周期结束',
      dataIndex: 'periodEnd',
      width: 160,
      hideInSearch: true,
      sorter: true,
      render: (_, r) => formatDateTime(r.periodEnd),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      render: (_, r) => [
        <a key="detail" onClick={() => history.push(`/subscription/detail/${r.id}`)}>
          <EyeOutlined /> 详情
        </a>,
        !readonly && (
          <Access key="cancel" permission={PERM.subscriptionWrite}>
            <a
              onClick={() => onCancel(r)}
              style={{ color: '#c9a961' }}
              className={r.status !== 'active' || r.cancelAtPeriodEnd ? 'dq-link-disabled' : ''}
            >
              <StopOutlined /> 取消
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="refund" permission={PERM.subscriptionWrite}>
            <a
              onClick={() => openRefund(r)}
              style={{ color: '#c8392e' }}
              className={r.status !== 'active' && r.status !== 'past_due' ? 'dq-link-disabled' : ''}
            >
              <RollbackOutlined /> 退款
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '订阅列表', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<AdminSubscriptionListItem>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1300 }}
        size="small"
        search={{ labelWidth: 70, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100], showSizeChanger: true }}
        request={async (params) => {
          const { current, pageSize, createdAt, ...rest } = params;
          const res = await listSubscriptions({
            page: current,
            pageSize,
            tenantId: (rest.tenantId as string | undefined) || undefined,
            plan: rest.plan as TenantPlan | undefined,
            status: rest.status as SubscriptionStatus | undefined,
            startDate: createdAt?.[0],
            endDate: createdAt?.[1],
          });
          return { data: res.items, total: res.total, success: true };
        }}
      />

      <Modal
        title="退款处理"
        open={!!refundOpen}
        onOk={onRefundSubmit}
        onCancel={() => setRefundOpen(null)}
        width={480}
        destroyOnClose
      >
        {refundOpen && (
          <div>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`将对租户「${refundOpen.tenantName}」的订阅发起退款`}
              description={`订单金额:${formatCurrency(refundOpen.amount, refundOpen.currency)} · 此操作将记录到审计日志`}
            />
            <Form form={refundForm} layout="vertical">
              <Form.Item
                label="退款金额"
                name="amount"
                rules={[
                  { required: true, message: '请输入退款金额' },
                  {
                    validator: (_, value) => {
                      if (value <= 0) return Promise.reject(new Error('退款金额必须大于 0'));
                      if (refundOpen && value > refundOpen.amount) {
                        return Promise.reject(new Error(`退款金额不能超过订单金额 ${refundOpen.amount}`));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <InputNumber
                  min={0.01}
                  max={refundOpen?.amount}
                  step={0.01}
                  style={{ width: '100%' }}
                  addonAfter={refundOpen.currency}
                />
              </Form.Item>
              <Form.Item
                label="退款原因"
                name="reason"
                rules={[
                  { required: true, message: '请输入退款原因' },
                  { max: 200, message: '原因不超过 200 字' },
                ]}
              >
                <Input.TextArea rows={3} maxLength={200} showCount placeholder="将记录到审计日志" />
              </Form.Item>
              <Form.Item label="外部退款单号(可选)" name="externalRefundId">
                <Input placeholder="如支付平台退款流水号" />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
