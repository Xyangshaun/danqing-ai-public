// ============================================================
// 系统管理 - 租户管理 CRUD
// - 搜索(名称)+ 筛选(类型/套餐/状态)+ 分页
// - 创建租户 / 编辑租户 / 启用-禁用
// - 多租户层级(parentId)
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import {
  Tag,
  Button,
  App,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Drawer,
  Tabs,
  Table,
  Alert,
  Space,
  Empty,
} from 'antd';
import { PlusOutlined, EditOutlined, TeamOutlined, CopyOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type {
  AdminTenantListItem,
  TenantType,
  TenantPlan,
  TenantStatus,
  AdminInvitationInfo,
  UserRole,
  BatchImportStudentsResponse,
} from '@/types/api';
import {
  listTenants,
  createTenant,
  updateTenant,
  listInvitations,
  createInvitation,
  batchImportStudents,
} from '@/services/system';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import TenantArbitrationConfig from '@/components/TenantArbitrationConfig';
import { useConfirmAction } from '@/components/ConfirmAction';
import {
  PERM,
  TENANT_TYPE_LABEL,
  TENANT_TYPE_OPTIONS,
  PLAN_LABEL,
  PLAN_COLOR,
  PLAN_OPTIONS,
  TENANT_STATUS_LABEL,
  TENANT_STATUS_COLOR,
  TENANT_STATUS_OPTIONS,
  ROLE_LABEL,
  ROLE_OPTIONS,
  ROLE_COLOR,
} from '@/constants';
import { formatDateTime } from '@/utils/format';

export default function TenantsPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏所有写操作入口
  const readonly = useReadonlyAdmin();
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form] = Form.useForm();

  // 仲裁配置抽屉
  const [arbTenant, setArbTenant] = useState<AdminTenantListItem | null>(null);

  const openCreate = () => {
    setEditId(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'school',
      plan: 'free',
      maxSeats: 50,
      status: 'active',
    });
    setEditOpen(true);
  };

  const openEdit = (record: AdminTenantListItem) => {
    setEditId(record.id);
    form.setFieldsValue({
      name: record.name,
      type: record.type,
      plan: record.plan,
      status: record.status,
      maxSeats: record.maxSeats,
      parentId: record.parentId,
      feishuTenantKey: record.feishuTenantKey,
    });
    setEditOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    if (editId) {
      const payload = {
        name: values.name as string,
        plan: values.plan as TenantPlan,
        status: values.status as TenantStatus,
        maxSeats: values.maxSeats as number,
      };
      await updateTenant(editId, payload);
      message.success('租户已更新');
    } else {
      const payload = {
        name: values.name as string,
        type: values.type as TenantType,
        plan: (values.plan as TenantPlan) ?? 'free',
        maxSeats: (values.maxSeats as number) ?? 50,
        parentId: values.parentId || undefined,
        feishuTenantKey: values.feishuTenantKey || undefined,
      };
      await createTenant(payload);
      message.success('租户已创建');
    }
    setEditOpen(false);
    tableRef.current?.reload();
  };

  const onToggleStatus = (record: AdminTenantListItem) => {
    const next: TenantStatus = record.status === 'active' ? 'disabled' : 'active';
    confirm(
      {
        title: next === 'disabled' ? '禁用租户' : '启用租户',
        content: `确认${next === 'disabled' ? '禁用' : '启用'}租户「${record.name}」?${
          next === 'disabled' ? '禁用后该租户下所有用户将无法登录。' : ''
        }`,
        okText: next === 'disabled' ? '禁用' : '启用',
        danger: next === 'disabled',
      },
      () => updateTenant(record.id, { status: next }),
    ).then(() => tableRef.current?.reload());
  };

  // ============ 成员/邀请 抽屉 ============
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [memberTenant, setMemberTenant] = useState<AdminTenantListItem | null>(null);
  const [invitations, setInvitations] = useState<AdminInvitationInfo[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [createInvOpen, setCreateInvOpen] = useState(false);
  const [createInvForm] = Form.useForm();
  const [batchForm] = Form.useForm();
  const [batchResult, setBatchResult] = useState<BatchImportStudentsResponse | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const loadInvitations = useCallback(async (tenantId: string) => {
    setInvitationsLoading(true);
    try {
      const res = await listInvitations(tenantId);
      setInvitations(res ?? []);
    } catch {
      setInvitations([]);
    } finally {
      setInvitationsLoading(false);
    }
  }, []);

  const openMemberDrawer = (record: AdminTenantListItem) => {
    setMemberTenant(record);
    setMemberDrawerOpen(true);
    setBatchResult(null);
    loadInvitations(record.id);
  };

  useEffect(() => {
    if (memberDrawerOpen && memberTenant) {
      loadInvitations(memberTenant.id);
    }
  }, [memberDrawerOpen, memberTenant, loadInvitations]);

  const openCreateInv = () => {
    createInvForm.resetFields();
    createInvForm.setFieldsValue({ role: 'student', maxUses: 1, expiresHours: 168 });
    setCreateInvOpen(true);
  };

  const onCreateInvSubmit = async () => {
    if (!memberTenant) return;
    const values = await createInvForm.validateFields();
    await createInvitation(memberTenant.id, {
      role: values.role as UserRole,
      maxUses: values.maxUses as number,
      expiresHours: values.expiresHours as number,
    });
    message.success('邀请码已创建');
    setCreateInvOpen(false);
    loadInvitations(memberTenant.id);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    message.success('已复制邀请码');
  };

  const onBatchImport = async () => {
    if (!memberTenant) return;
    const values = await batchForm.validateFields();
    const students = (values.students ?? []) as { name: string; phone?: string; email?: string }[];
    if (students.length === 0) {
      message.warning('请至少添加一名学生');
      return;
    }
    setBatchSubmitting(true);
    try {
      const res = await batchImportStudents(memberTenant.id, {
        students,
        role: (values.role as UserRole) ?? 'student',
      });
      setBatchResult(res);
      message.success(`导入完成:成功 ${res.imported} 人,失败 ${res.failed.length} 人`);
      tableRef.current?.reload();
    } finally {
      setBatchSubmitting(false);
    }
  };


  const columns: ProColumns<AdminTenantListItem>[] = [
    {
      title: '租户名称',
      dataIndex: 'name',
      width: 180,
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
      width: 90,
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
      render: (_, r) => (
        <span>
          <span
            className="dq-status-dot"
            style={{ background: r.status === 'active' ? '#3e7d5a' : '#c8392e' }}
          />
          <Tag color={TENANT_STATUS_COLOR[r.status]} style={{ margin: 0 }}>
            {TENANT_STATUS_LABEL[r.status]}
          </Tag>
        </span>
      ),
    },
    {
      title: '席位数',
      dataIndex: 'maxSeats',
      width: 80,
      hideInSearch: true,
    },
    {
      title: '成员数',
      dataIndex: 'memberCount',
      width: 80,
      hideInSearch: true,
      render: (_, r) => <span style={{ color: '#2e5c6e' }}>{r.memberCount}</span>,
    },
    {
      title: '飞书租户',
      dataIndex: 'feishuTenantKey',
      width: 140,
      hideInSearch: true,
      ellipsis: true,
      render: (_, r) => r.feishuTenantKey ?? <span style={{ color: '#bfb8a8' }}>-</span>,
    },
    {
      title: '父租户',
      dataIndex: 'parentId',
      width: 120,
      hideInSearch: true,
      ellipsis: true,
      render: (_, r) => r.parentId ?? <span style={{ color: '#bfb8a8' }}>-</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      hideInSearch: true,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      fixed: 'right',
      render: (_, r) => [
        !readonly && (
          <Access key="edit" permission={PERM.tenantWrite}>
            <a onClick={() => openEdit(r)}>
              <EditOutlined /> 编辑
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="members" permission={PERM.invitationWrite}>
            <a onClick={() => openMemberDrawer(r)}>
              <TeamOutlined /> 成员
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="arbitration" permission={PERM.tenantWrite}>
            <a onClick={() => setArbTenant(r)}>
              <EditOutlined /> 仲裁配置
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="toggle" permission={PERM.tenantWrite}>
            <a
              onClick={() => onToggleStatus(r)}
              style={{ color: r.status === 'active' ? '#c8392e' : '#3e7d5a' }}
            >
              {r.status === 'active' ? '禁用' : '启用'}
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '租户管理', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<AdminTenantListItem>
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
        toolBarRender={() => [
          !readonly && (
            <Access key="create" permission={PERM.tenantWrite}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建租户
              </Button>
            </Access>
          ),
        ]}
      />

      <Modal
        title={editId ? '编辑租户' : '新建租户'}
        open={editOpen}
        onOk={onSubmit}
        onCancel={() => setEditOpen(false)}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="租户名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="租户类型" name="type" rules={[{ required: true }]}>
            <Select options={TENANT_TYPE_OPTIONS} disabled={!!editId} />
          </Form.Item>
          <Form.Item label="套餐" name="plan" rules={[{ required: true }]}>
            <Select options={PLAN_OPTIONS} />
          </Form.Item>
          <Form.Item label="最大席位数" name="maxSeats" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          {editId && (
            <Form.Item label="状态" name="status" rules={[{ required: true }]}>
              <Select options={TENANT_STATUS_OPTIONS} />
            </Form.Item>
          )}
          {!editId && (
            <>
              <Form.Item label="父租户 ID(可选)" name="parentId">
                <Input placeholder="上级租户 ID,用于层级管理" />
              </Form.Item>
              <Form.Item label="飞书租户 Key(可选)" name="feishuTenantKey">
                <Input placeholder="飞书企业租户标识" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* 成员 / 邀请码 / 批量导入 抽屉 */}
      <Drawer
        title={memberTenant ? `成员管理 · ${memberTenant.name}` : '成员管理'}
        open={memberDrawerOpen}
        onClose={() => setMemberDrawerOpen(false)}
        width={720}
        destroyOnClose
      >
        {memberTenant && (
          <Tabs
            defaultActiveKey="invitations"
            items={[
              {
                key: 'invitations',
                label: `邀请码 (${invitations.length})`,
                children: (
                  <div>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#8c8c8c', fontSize: 13 }}>
                        席位 {memberTenant.memberCount}/{memberTenant.maxSeats}
                      </span>
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreateInv} size="small">
                        创建邀请码
                      </Button>
                    </div>
                    <Table<AdminInvitationInfo>
                      size="small"
                      rowKey="id"
                      loading={invitationsLoading}
                      dataSource={invitations}
                      pagination={false}
                      scroll={{ y: 420 }}
                      locale={{ emptyText: <Empty description="暂无邀请码" /> }}
                      columns={[
                        {
                          title: '邀请码',
                          dataIndex: 'code',
                          width: 180,
                          render: (_, r) => (
                            <Space>
                              <code style={{ background: '#f5f0e3', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>
                                {r.code}
                              </code>
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => copyCode(r.code)}
                              />
                            </Space>
                          ),
                        },
                        {
                          title: '角色',
                          dataIndex: 'role',
                          width: 80,
                          render: (r: UserRole) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Tag>,
                        },
                        {
                          title: '使用量',
                          dataIndex: 'usedCount',
                          width: 100,
                          render: (_, r) => (
                            <span>
                              {r.usedCount}/{r.maxUses}
                              {r.usedCount >= r.maxUses && <Tag color="default" style={{ marginLeft: 4 }}>已用尽</Tag>}
                            </span>
                          ),
                        },
                        {
                          title: '过期时间',
                          dataIndex: 'expiresAt',
                          width: 150,
                          render: (v: string) => {
                            const expired = new Date(v).getTime() < Date.now();
                            return (
                              <span style={{ color: expired ? '#c8392e' : undefined }}>
                                {formatDateTime(v)}
                                {expired && <Tag color="error" style={{ marginLeft: 4 }}>已过期</Tag>}
                              </span>
                            );
                          },
                        },
                        {
                          title: '创建时间',
                          dataIndex: 'createdAt',
                          width: 150,
                          render: (v: string) => formatDateTime(v),
                        },
                      ]}
                    />
                  </div>
                ),
              },
              {
                key: 'batch',
                label: '批量导入',
                children: (
                  <div>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="批量导入学生"
                      description="有手机号的学生将直接创建账号并加入租户;无手机号的学生将生成一次性邀请码供其自行注册。单次最多 500 人。"
                    />
                    <Form form={batchForm} layout="vertical" initialValues={{ role: 'student', students: [{ name: '' }] }}>
                      <Form.Item label="导入角色" name="role" rules={[{ required: true }]}>
                        <Select options={ROLE_OPTIONS} style={{ width: 200 }} />
                      </Form.Item>
                      <Form.List name="students">
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map((field) => (
                              <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'name']}
                                  rules={[{ required: true, message: '姓名' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="姓名" style={{ width: 120 }} />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'phone']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="手机号(可选)" style={{ width: 160 }} />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'email']}
                                  rules={[{ type: 'email', message: '邮箱格式错误' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="邮箱(可选)" style={{ width: 180 }} />
                                </Form.Item>
                                {fields.length > 1 && (
                                  <MinusCircleOutlined
                                    onClick={() => remove(field.name)}
                                    style={{ color: '#c8392e' }}
                                  />
                                )}
                              </Space>
                            ))}
                            <Button type="dashed" onClick={() => add({ name: '' })} icon={<PlusOutlined />} block>
                              添加学生
                            </Button>
                          </>
                        )}
                      </Form.List>
                      <Button
                        type="primary"
                        onClick={onBatchImport}
                        loading={batchSubmitting}
                        style={{ marginTop: 16 }}
                      >
                        开始导入
                      </Button>
                    </Form>
                    {batchResult && (
                      <Alert
                        type={batchResult.failed.length > 0 ? 'warning' : 'success'}
                        showIcon
                        style={{ marginTop: 16 }}
                        message={`导入完成:成功 ${batchResult.imported} 人,失败 ${batchResult.failed.length} 人`}
                        description={
                          <div>
                            {batchResult.failed.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <b>失败明细:</b>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                                  {batchResult.failed.map((f, i) => (
                                    <li key={i}>{f.name}:{f.reason}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {batchResult.invitationCodes.length > 0 && (
                              <div>
                                <b>生成的邀请码:</b>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                                  {batchResult.invitationCodes.map((c, i) => (
                                    <li key={i}>
                                      {c.name}:<code>{c.code}</code>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        }
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* 创建邀请码 Modal */}
      <Modal
        title="创建邀请码"
        open={createInvOpen}
        onOk={onCreateInvSubmit}
        onCancel={() => setCreateInvOpen(false)}
        width={460}
        destroyOnClose
      >
        <Form form={createInvForm} layout="vertical">
          <Form.Item label="邀请角色" name="role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="最大使用次数" name="maxUses" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="有效时长(小时)" name="expiresHours" rules={[{ required: true }]} extra="最长 720 小时(30 天)">
            <InputNumber min={1} max={720} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 租户仲裁配置抽屉 */}
      <TenantArbitrationConfig
        tenantId={arbTenant?.id}
        tenantName={arbTenant?.name}
        open={!!arbTenant}
        onClose={() => setArbTenant(null)}
      />
    </PageContainer>
  );
}
