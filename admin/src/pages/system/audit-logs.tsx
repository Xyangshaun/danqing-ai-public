// ============================================================
// 系统管理 - 审计日志查询
// - 只读列表(筛选:操作人/动作/资源/租户/日期)
// - 展开行查看 before/after 数据快照
// - 导出 CSV 快照(前端拼接)
// ============================================================

import { useRef } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Tag, Button, App } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import type { AuditLogInfo, AuditAction } from '@/types/api';
import { listAuditLogs } from '@/services/system';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ACTION_COLOR,
  AUDIT_ACTION_OPTIONS,
} from '@/constants';
import { formatDateTime, formatRelativeTime } from '@/utils/format';
import { toCsv, downloadText, timestampedFilename } from '@/utils/download';

export default function AuditLogsPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();

  const onExport = async () => {
    const res = await listAuditLogs({ page: 1, pageSize: 10000 });
    const rows = res.items.map((log) => ({
      id: log.id,
      operatorId: log.operatorId,
      operatorRole: log.operatorRole,
      action: AUDIT_ACTION_LABEL[log.action],
      resource: log.resource,
      resourceId: log.resourceId ?? '',
      targetTenantId: log.targetTenantId ?? '',
      ip: log.ip,
      userAgent: log.userAgent,
      traceId: log.traceId ?? '',
      note: log.note ?? '',
      createdAt: formatDateTime(log.createdAt),
    }));
    const csv = toCsv(
      rows,
      ['id', 'operatorId', 'operatorRole', 'action', 'resource', 'resourceId', 'targetTenantId', 'ip', 'userAgent', 'traceId', 'note', 'createdAt'],
      ['日志ID', '操作人ID', '操作人角色', '动作', '资源', '资源ID', '目标租户ID', 'IP', 'UA', 'TraceId', '备注', '时间'],
    );
    downloadText(csv, timestampedFilename('audit-logs', 'csv'));
    message.success(`已导出 ${rows.length} 条审计日志`);
  };

  const columns: ProColumns<AuditLogInfo>[] = [
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      valueType: 'select',
      fieldProps: { options: AUDIT_ACTION_OPTIONS, allowClear: true },
      render: (_, r) => (
        <Tag color={AUDIT_ACTION_COLOR[r.action]}>{AUDIT_ACTION_LABEL[r.action]}</Tag>
      ),
    },
    {
      title: '操作人',
      dataIndex: 'operatorId',
      width: 140,
      ellipsis: true,
      fieldProps: { placeholder: '操作人 ID' },
      render: (_, r) => (
        <div>
          <div style={{ fontSize: 12 }}>{r.operatorId.slice(0, 12)}</div>
          <div style={{ fontSize: 11, color: '#6b6b6b' }}>{r.operatorRole}</div>
        </div>
      ),
    },
    {
      title: '资源',
      dataIndex: 'resource',
      width: 120,
      fieldProps: { placeholder: '资源类型' },
      render: (_, r) => <b>{r.resource}</b>,
    },
    {
      title: '资源 ID',
      dataIndex: 'resourceId',
      width: 120,
      hideInSearch: true,
      ellipsis: true,
      render: (_, r) => r.resourceId?.slice(0, 12) ?? '-',
    },
    {
      title: '目标租户',
      dataIndex: 'targetTenantId',
      width: 120,
      ellipsis: true,
      fieldProps: { placeholder: '目标租户 ID' },
      render: (_, r) => r.targetTenantId?.slice(0, 12) ?? <span style={{ color: '#bfb8a8' }}>-</span>,
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 130,
      hideInSearch: true,
      render: (_, r) => <span style={{ fontSize: 12 }}>{r.ip}</span>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      width: 200,
      hideInSearch: true,
      ellipsis: true,
      render: (_, r) => r.note ?? <span style={{ color: '#bfb8a8' }}>-</span>,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      valueType: 'dateRange',
      sorter: true,
      defaultSortOrder: 'descend',
      render: (_, r) => (
        <div>
          <div>{formatDateTime(r.createdAt)}</div>
          <div style={{ fontSize: 11, color: '#6b6b6b' }}>{formatRelativeTime(r.createdAt)}</div>
        </div>
      ),
    },
  ];

  return (
    <PageContainer header={{ title: '审计日志', ghost: true }}>
      <ProTable<AuditLogInfo>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        size="small"
        search={{ labelWidth: 80, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{
          pageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
        }}
        request={async (params) => {
          const { current, pageSize, createdAt, ...rest } = params;
          const res = await listAuditLogs({
            page: current,
            pageSize,
            operatorId: (rest.operatorId as string | undefined) || undefined,
            action: rest.action as AuditAction | undefined,
            resource: (rest.resource as string | undefined) || undefined,
            targetTenantId: (rest.targetTenantId as string | undefined) || undefined,
            startDate: createdAt?.[0],
            endDate: createdAt?.[1],
          });
          return { data: res.items, total: res.total, success: true };
        }}
        expandable={{
          expandedRowRender: (record) => <AuditLogDetail record={record} />,
          rowExpandable: (record) => !!record.beforeData || !!record.afterData,
        }}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />} onClick={onExport}>
            导出 CSV
          </Button>,
        ]}
      />
    </PageContainer>
  );
}

// ============ 审计日志详情(展开行) ============
function AuditLogDetail({ record }: { record: AuditLogInfo }) {
  return (
    <div style={{ padding: '8px 0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 6 }}>变更前数据:</div>
        <pre
          style={{
            background: '#f5f0e3',
            padding: 10,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 240,
            overflow: 'auto',
            margin: 0,
          }}
        >
          {record.beforeData ? JSON.stringify(record.beforeData, null, 2) : '无'}
        </pre>
      </div>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 6 }}>变更后数据:</div>
        <pre
          style={{
            background: '#f5f0e3',
            padding: 10,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 240,
            overflow: 'auto',
            margin: 0,
          }}
        >
          {record.afterData ? JSON.stringify(record.afterData, null, 2) : '无'}
        </pre>
      </div>
      <div style={{ flex: '1 1 200px' }}>
        <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 6 }}>请求信息:</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>Trace ID: {record.traceId ?? '-'}</div>
          <div>User-Agent: {record.userAgent}</div>
          <div>日志 ID: {record.id}</div>
        </div>
      </div>
    </div>
  );
}
