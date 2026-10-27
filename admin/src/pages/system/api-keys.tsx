// ============================================================
// 系统管理 - API 密钥管理
// - 列表(筛选:状态/租户)+ 分页
// - 创建密钥(Modal,创建后完整密钥 plainKey 仅显示一次)
// - 吊销密钥(二次确认,输入"吊销"文本)
// ============================================================

import { useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Tag, Button, App, Modal, Form, Input, InputNumber, Select, Alert, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import type { ApiKeyInfo, ApiKeyStatus, CreateApiKeyResponse } from '@/types/api';
import { listApiKeys, createApiKey, revokeApiKey } from '@/services/system';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { useConfirmAction } from '@/components/ConfirmAction';
import { PERM, API_KEY_STATUS_LABEL } from '@/constants';
import { formatDateTime, formatRelativeTime } from '@/utils/format';

const { Paragraph, Text } = Typography;

const SCOPE_OPTIONS = [
  { label: '读取 (read)', value: 'read' },
  { label: '写入 (write)', value: 'write' },
  { label: '管理 (admin)', value: 'admin' },
  { label: '分析 (analyze)', value: 'analyze' },
  { label: '导出 (export)', value: 'export' },
];

export default function ApiKeysPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏新建/吊销写操作入口
  const readonly = useReadonlyAdmin();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ name: '', scopes: ['read'], expiresAfterDays: 90 });
    setCreateOpen(true);
  };

  const onCreateSubmit = async () => {
    const values = await form.validateFields();
    const res = await createApiKey({
      name: values.name as string,
      scopes: values.scopes as string[],
      tenantId: values.tenantId || undefined,
      expiresAfterDays: values.expiresAfterDays ?? null,
    });
    message.success('密钥已创建');
    setCreateOpen(false);
    setCreatedKey(res);
    tableRef.current?.reload();
  };

  const onRevoke = (record: ApiKeyInfo) => {
    confirm(
      {
        title: '吊销 API 密钥',
        content: (
          <div>
            确认吊销密钥「<b>{record.name}</b>」?
            <br />
            吊销后使用该密钥的所有请求将立即失败,此操作<b style={{ color: '#c8392e' }}>不可恢复</b>。
          </div>
        ),
        okText: '吊销',
        danger: true,
        requireText: '吊销',
      },
      () => revokeApiKey(record.id),
    ).then(() => tableRef.current?.reload());
  };

  const columns: ProColumns<ApiKeyInfo>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
      fixed: 'left',
      render: (_, r) => <b>{r.name}</b>,
    },
    {
      title: '密钥前缀',
      dataIndex: 'keyPrefix',
      width: 140,
      hideInSearch: true,
      render: (_, r) => (
        <code style={{ background: '#f5f0e3', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>
          {r.keyPrefix}••••
        </code>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      valueType: 'select',
      fieldProps: {
        options: [
          { label: '生效中', value: 'active' },
          { label: '已吊销', value: 'revoked' },
        ],
        allowClear: true,
      },
      render: (_, r) => (
        <span>
          <span
            className="dq-status-dot"
            style={{ background: r.status === 'active' ? '#3e7d5a' : '#c8392e' }}
          />
          <Tag color={r.status === 'active' ? 'success' : 'error'} style={{ margin: 0 }}>
            {API_KEY_STATUS_LABEL[r.status]}
          </Tag>
        </span>
      ),
    },
    {
      title: '权限范围',
      dataIndex: 'scopes',
      width: 180,
      hideInSearch: true,
      render: (_, r) => r.scopes.map((s) => <Tag key={s}>{s}</Tag>),
    },
    {
      title: '租户',
      dataIndex: 'tenantId',
      width: 120,
      ellipsis: true,
      fieldProps: { placeholder: '租户 ID' },
      render: (_, r) => r.tenantId?.slice(0, 12) ?? <span style={{ color: '#bfb8a8' }}>全局</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      hideInSearch: true,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '最后使用',
      dataIndex: 'lastUsedAt',
      width: 140,
      hideInSearch: true,
      render: (_, r) => (r.lastUsedAt ? formatRelativeTime(r.lastUsedAt) : <span style={{ color: '#bfb8a8' }}>从未</span>),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      width: 140,
      hideInSearch: true,
      render: (_, r) => (r.expiresAt ? formatDateTime(r.expiresAt) : <span style={{ color: '#bfb8a8' }}>永不过期</span>),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 80,
      fixed: 'right',
      render: (_, r) => [
        !readonly && (
          <Access key="revoke" permission={PERM.apiKeyWrite}>
            <a
              onClick={() => onRevoke(r)}
              style={{ color: '#c8392e' }}
              className={r.status !== 'active' ? 'dq-link-disabled' : ''}
            >
              <DeleteOutlined /> 吊销
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: 'API 密钥', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<ApiKeyInfo>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1300 }}
        size="small"
        search={{ labelWidth: 70, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100], showSizeChanger: true }}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await listApiKeys({
            page: current,
            pageSize,
            status: rest.status as ApiKeyStatus | undefined,
            tenantId: (rest.tenantId as string | undefined) || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          !readonly && (
            <Access key="create" permission={PERM.apiKeyWrite}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建密钥
              </Button>
            </Access>
          ),
        ]}
      />

      {/* 创建密钥 */}
      <Modal
        title="新建 API 密钥"
        open={createOpen}
        onOk={onCreateSubmit}
        onCancel={() => setCreateOpen(false)}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="密钥名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={50} placeholder="如:生产环境调用密钥" />
          </Form.Item>
          <Form.Item label="权限范围" name="scopes" rules={[{ required: true, message: '请选择权限' }]}>
            <Select mode="multiple" options={SCOPE_OPTIONS} placeholder="选择权限范围" />
          </Form.Item>
          <Form.Item label="绑定租户(可选)" name="tenantId">
            <Input placeholder="留空则全局可用" />
          </Form.Item>
          <Form.Item label="有效期(天)" name="expiresAfterDays" extra="留空或 0 表示永不过期">
            <InputNumber min={0} max={3650} style={{ width: '100%' }} placeholder="如 90" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 密钥创建成功 - 仅显示一次 */}
      <Modal
        title="密钥已创建"
        open={!!createdKey}
        onCancel={() => setCreatedKey(null)}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => {
              if (createdKey) {
                navigator.clipboard.writeText(createdKey.plainKey);
                message.success('已复制到剪贴板');
              }
            }}
          >
            复制密钥
          </Button>,
          <Button key="ok" type="primary" danger onClick={() => setCreatedKey(null)}>
            我已保存
          </Button>,
        ]}
        width={560}
        destroyOnClose
      >
        {createdKey && (
          <div>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="请立即保存完整密钥"
              description="完整密钥仅此一次显示,关闭后将无法再次查看。"
            />
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>密钥名称:</Text>
              <div><b>{createdKey.name}</b></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>密钥前缀:</Text>
              <div><code>{createdKey.keyPrefix}••••</code></div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>完整密钥:</Text>
              <Paragraph
                copyable={false}
                style={{
                  background: '#f5f0e3',
                  padding: 10,
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  wordBreak: 'break-all',
                  margin: '4px 0 0',
                }}
              >
                {createdKey.plainKey}
              </Paragraph>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
