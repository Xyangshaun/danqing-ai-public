// ============================================================
// 订阅管理 - 订阅详情
// - 基本信息(套餐/状态/周期/金额/支付渠道)
// - 关联发票列表(按租户查询)
// - 操作:取消订阅 / 退款
// ============================================================

import { useState } from 'react';
import { useParams, history } from '@umijs/max';
import { PageContainer, ProDescriptions, ProCard } from '@ant-design/pro-components';
import {
  Tag as AntdTag,
  Button,
  Spin,
  Empty,
  Tabs,
  App,
  Modal,
  Form,
  Input,
  InputNumber,
  Alert,
  Table,
} from 'antd';
import { ArrowLeftOutlined, StopOutlined, RollbackOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { getSubscription, listInvoices, cancelSubscription, refundSubscription } from '@/services/subscription';
import { useConfirmAction } from '@/components/ConfirmAction';
import Access from '@/components/Access';
import {
  PERM,
  PLAN_LABEL,
  PLAN_COLOR,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_COLOR,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_COLOR,
  PAYMENT_PROVIDER_LABEL,
} from '@/constants';
import { formatDateTime, formatCurrency } from '@/utils/format';
import type { AdminInvoiceListItem } from '@/types/api';

export default function SubscriptionDetailPage() {
  const params = useParams();
  const subscriptionId = params.id as string;
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm] = Form.useForm();

  const subQ = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => getSubscription(subscriptionId),
    enabled: !!subscriptionId,
  });

  const invoicesQ = useQuery({
    queryKey: ['invoices', 'subscription', subscriptionId],
    queryFn: () => listInvoices({ tenantId: subQ.data?.tenantId, page: 1, pageSize: 50 }),
    enabled: !!subQ.data?.tenantId,
  });

  const s = subQ.data;

  const onCancel = () => {
    if (!s) return;
    confirm(
      {
        title: '取消订阅',
        content: (
          <div>
            确认取消租户「<b>{s.tenantName}</b>」的订阅?
            <br />
            将在当前周期结束(<b>{formatDateTime(s.periodEnd)}</b>)生效。
          </div>
        ),
        okText: '取消订阅',
        danger: true,
        requireText: '取消',
      },
      () => cancelSubscription(s.id),
    ).then((res) => {
      if (res) {
        message.success(`订阅将在 ${formatDateTime(res.periodEnd)} 后取消`);
        subQ.refetch();
      }
    });
  };

  const openRefund = () => {
    if (!s) return;
    refundForm.resetFields();
    refundForm.setFieldsValue({ amount: s.amount, reason: '', externalRefundId: '' });
    setRefundOpen(true);
  };

  const onRefundSubmit = async () => {
    if (!s) return;
    const values = await refundForm.validateFields();
    const res = await refundSubscription(s.id, {
      amount: values.amount as number,
      reason: values.reason as string,
      externalRefundId: values.externalRefundId || undefined,
    });
    message.success(`退款成功:已退 ${formatCurrency(res.refundedAmount)}`);
    setRefundOpen(false);
    subQ.refetch();
    invoicesQ.refetch();
  };

  if (subQ.isLoading) {
    return (
      <PageContainer>
        <Spin />
      </PageContainer>
    );
  }
  if (!s) {
    return (
      <PageContainer>
        <Empty description="订阅不存在" />
      </PageContainer>
    );
  }

  const canCancel = s.status === 'active' && !s.cancelAtPeriodEnd;
  const canRefund = s.status === 'active' || s.status === 'past_due';

  const invoiceColumns: ColumnsType<AdminInvoiceListItem> = [
    {
      title: '发票 ID',
      dataIndex: 'id',
      width: 140,
      ellipsis: true,
    },
    { title: '金额', dataIndex: 'amount', width: 110, render: (_, r) => formatCurrency(r.amount, r.currency) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => (
        <AntdTag color={INVOICE_STATUS_COLOR[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</AntdTag>
      ),
    },
    { title: '周期', width: 220, render: (_, r) => `${formatDateTime(r.periodStart)} ~ ${formatDateTime(r.periodEnd)}` },
    { title: '支付时间', dataIndex: 'paidAt', width: 160, render: (_, r) => formatDateTime(r.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (_, r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageContainer
      header={{
        title: '订阅详情',
        ghost: true,
        onBack: () => history.back(),
        backIcon: <ArrowLeftOutlined />,
      }}
      extra={[
        <Access key="cancel" permission={PERM.subscriptionWrite}>
          <Button
            icon={<StopOutlined />}
            onClick={onCancel}
            danger
            disabled={!canCancel}
          >
            取消订阅
          </Button>
        </Access>,
        <Access key="refund" permission={PERM.subscriptionWrite}>
          <Button
            icon={<RollbackOutlined />}
            onClick={openRefund}
            disabled={!canRefund}
            style={{ color: canRefund ? '#c8392e' : undefined }}
          >
            退款
          </Button>
        </Access>,
      ]}
    >
      <ProCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {s.tenantName}
              <AntdTag color={PLAN_COLOR[s.plan]} style={{ marginLeft: 8 }}>
                {PLAN_LABEL[s.plan]}
              </AntdTag>
              <AntdTag color={SUBSCRIPTION_STATUS_COLOR[s.status]} style={{ marginLeft: 4 }}>
                {SUBSCRIPTION_STATUS_LABEL[s.status]}
              </AntdTag>
              {s.cancelAtPeriodEnd && s.status === 'active' && (
                <AntdTag color="warning" style={{ marginLeft: 4 }}>
                  待取消
                </AntdTag>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6b6b6b', marginTop: 4 }}>订阅 ID: {s.id}</div>
          </div>
        </div>

        <ProDescriptions column={2} size="small" bordered>
          <ProDescriptions.Item label="租户 ID">{s.tenantId}</ProDescriptions.Item>
          <ProDescriptions.Item label="套餐">{PLAN_LABEL[s.plan]}</ProDescriptions.Item>
          <ProDescriptions.Item label="状态">
            {SUBSCRIPTION_STATUS_LABEL[s.status]}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="席位数">{s.seats}</ProDescriptions.Item>
          <ProDescriptions.Item label="金额">
            <b style={{ color: '#c9a961' }}>{formatCurrency(s.amount, s.currency)}</b>
          </ProDescriptions.Item>
          <ProDescriptions.Item label="周期结束取消">
            {s.cancelAtPeriodEnd ? '是' : '否'}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="周期开始">{formatDateTime(s.periodStart)}</ProDescriptions.Item>
          <ProDescriptions.Item label="周期结束">{formatDateTime(s.periodEnd)}</ProDescriptions.Item>
          <ProDescriptions.Item label="创建时间">{formatDateTime(s.createdAt)}</ProDescriptions.Item>
          <ProDescriptions.Item label="更新时间">{formatDateTime(s.updatedAt)}</ProDescriptions.Item>
          <ProDescriptions.Item label="支付渠道">
            {s.paymentProvider ? PAYMENT_PROVIDER_LABEL[s.paymentProvider] : '-'}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="外部订阅 ID">
            {s.externalSubId ?? '-'}
          </ProDescriptions.Item>
        </ProDescriptions>
      </ProCard>

      <ProCard style={{ marginTop: 12 }}>
        <Tabs
          items={[
            {
              key: 'invoices',
              label: `关联发票(${invoicesQ.data?.total ?? 0})`,
              children: (
                <Spin spinning={invoicesQ.isLoading}>
                  {(invoicesQ.data?.items ?? []).length === 0 ? (
                    <Empty description="暂无发票记录" />
                  ) : (
                    <Table<AdminInvoiceListItem>
                      rowKey="id"
                      size="small"
                      columns={invoiceColumns}
                      dataSource={invoicesQ.data?.items ?? []}
                      pagination={{ pageSize: 10, showSizeChanger: true }}
                      scroll={{ x: 900 }}
                    />
                  )}
                </Spin>
              ),
            },
          ]}
        />
      </ProCard>

      <Modal
        title="退款处理"
        open={refundOpen}
        onOk={onRefundSubmit}
        onCancel={() => setRefundOpen(false)}
        width={480}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`将对租户「${s.tenantName}」的订阅发起退款`}
          description={`订单金额:${formatCurrency(s.amount, s.currency)} · 此操作将记录到审计日志`}
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
                  if (value > s.amount) {
                    return Promise.reject(new Error(`退款金额不能超过订单金额 ${s.amount}`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber min={0.01} max={s.amount} step={0.01} style={{ width: '100%' }} addonAfter={s.currency} />
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
      </Modal>
    </PageContainer>
  );
}
