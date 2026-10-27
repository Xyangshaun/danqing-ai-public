// ============================================================
// 订阅管理 - 发票管理
// - 列表(筛选:租户ID/状态/日期)+ 分页
// - 详情抽屉(Drawer)
// - 导出 CSV 快照(前端拼接,当前筛选条件下全量)
// ============================================================

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Tag, Button, Drawer, Descriptions, App, Spin } from 'antd';
import { ExportOutlined, EyeOutlined } from '@ant-design/icons';
import type { AdminInvoiceListItem, InvoiceStatus } from '@/types/api';
import { listInvoices, getInvoice } from '@/services/subscription';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_COLOR,
  INVOICE_STATUS_OPTIONS,
  PAYMENT_PROVIDER_LABEL,
} from '@/constants';
import { formatDateTime, formatCurrency } from '@/utils/format';
import { toCsv, downloadText, timestampedFilename } from '@/utils/download';

export default function InvoicesPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const openDetail = (id: string) => setDrawerId(id);

  const onExport = async () => {
    // 导出当前筛选条件下的全量数据(快照)
    const res = await listInvoices({ page: 1, pageSize: 10000 });
    const rows = res.items.map((item) => ({
      id: item.id,
      tenantName: item.tenantName,
      subscriptionId: item.subscriptionId,
      amount: item.amount,
      currency: item.currency,
      status: INVOICE_STATUS_LABEL[item.status],
      periodStart: formatDateTime(item.periodStart),
      periodEnd: formatDateTime(item.periodEnd),
      paidAt: formatDateTime(item.paidAt),
      createdAt: formatDateTime(item.createdAt),
    }));
    const csv = toCsv(
      rows,
      ['id', 'tenantName', 'subscriptionId', 'amount', 'currency', 'status', 'periodStart', 'periodEnd', 'paidAt', 'createdAt'],
      ['发票ID', '租户', '订阅ID', '金额', '币种', '状态', '周期开始', '周期结束', '支付时间', '创建时间'],
    );
    downloadText(csv, timestampedFilename('invoices', 'csv'));
    message.success(`已导出 ${rows.length} 条发票记录`);
  };

  const columns: ProColumns<AdminInvoiceListItem>[] = [
    {
      title: '发票 ID',
      dataIndex: 'id',
      width: 140,
      ellipsis: true,
      hideInSearch: true,
    },
    {
      title: '租户',
      dataIndex: 'tenantName',
      width: 160,
      hideInSearch: true,
    },
    {
      title: '租户 ID',
      dataIndex: 'tenantId',
      hideInTable: true,
      fieldProps: { placeholder: '按租户 ID 精确筛选' },
    },
    {
      title: '订阅 ID',
      dataIndex: 'subscriptionId',
      width: 140,
      ellipsis: true,
      hideInSearch: true,
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
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      fieldProps: { options: INVOICE_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => (
        <span>
          <span
            className="dq-status-dot"
            style={{
              background:
                r.status === 'paid'
                  ? '#3e7d5a'
                  : r.status === 'failed'
                    ? '#c8392e'
                    : r.status === 'refunded'
                      ? '#c9a961'
                      : '#bfb8a8',
            }}
          />
          <Tag color={INVOICE_STATUS_COLOR[r.status]} style={{ margin: 0 }}>
            {INVOICE_STATUS_LABEL[r.status]}
          </Tag>
        </span>
      ),
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
      render: (_, r) => formatDateTime(r.periodEnd),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      width: 160,
      hideInSearch: true,
      render: (_, r) => (r.paidAt ? formatDateTime(r.paidAt) : '-'),
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
      width: 80,
      fixed: 'right',
      render: (_, r) => [
        <a key="detail" onClick={() => openDetail(r.id)}>
          <EyeOutlined /> 详情
        </a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '发票管理', ghost: true }}>
      {/* 本页无写操作,仅向二级只读管理员展示提示条 */}
      <ReadonlyAlert />
      <ProTable<AdminInvoiceListItem>
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
          const res = await listInvoices({
            page: current,
            pageSize,
            tenantId: (rest.tenantId as string | undefined) || undefined,
            status: rest.status as InvoiceStatus | undefined,
            startDate: createdAt?.[0],
            endDate: createdAt?.[1],
          });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />} onClick={onExport}>
            导出 CSV
          </Button>,
        ]}
      />

      <InvoiceDetailDrawer invoiceId={drawerId} onClose={() => setDrawerId(null)} />
    </PageContainer>
  );
}

// ============ 发票详情抽屉 ============
function InvoiceDetailDrawer({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useInvoiceDetail(invoiceId);

  return (
    <Drawer
      title="发票详情"
      open={!!invoiceId}
      onClose={onClose}
      width={560}
      destroyOnClose
    >
      <Spin spinning={isLoading}>
        {data && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="发票 ID">{data.id}</Descriptions.Item>
            <Descriptions.Item label="租户">{data.tenantName}</Descriptions.Item>
            <Descriptions.Item label="租户 ID">{data.tenantId}</Descriptions.Item>
            <Descriptions.Item label="订阅 ID">{data.subscriptionId}</Descriptions.Item>
            <Descriptions.Item label="金额">
              <b style={{ color: '#c9a961' }}>{formatCurrency(data.amount, data.currency)}</b>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={INVOICE_STATUS_COLOR[data.status]}>{INVOICE_STATUS_LABEL[data.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="周期">
              {formatDateTime(data.periodStart)} ~ {formatDateTime(data.periodEnd)}
            </Descriptions.Item>
            <Descriptions.Item label="支付时间">
              {data.paidAt ? formatDateTime(data.paidAt) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(data.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="支付渠道">
              {data.paymentProvider ? PAYMENT_PROVIDER_LABEL[data.paymentProvider] : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="外部发票 ID">
              {data.externalInvoiceId ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="描述">{data.description ?? '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Spin>
    </Drawer>
  );
}

// ============ 发票详情查询 Hook ============
function useInvoiceDetail(id: string | null) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoice(id as string),
    enabled: !!id,
  });
}
