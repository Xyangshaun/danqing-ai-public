// ============================================================
// 用户管理 - 用户列表
// - 搜索(姓名/邮箱/手机)+ 筛选(角色/状态/租户)+ 分页 + 排序
// - 在线状态列(M4-ADM-1):三态 Badge,30s 轮询,当前页前端筛选
// - 批量操作(角色变更/删除,上限 100)
// - 导出 CSV(走后端 /api/admin/users/export,已脱敏)
// - 编辑角色、锁定/解锁
// - 敏感数据脱敏显示(手机/邮箱)
// ============================================================

import { useCallback, useMemo, useRef, useState } from 'react';
import { history } from '@umijs/max';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import {
  ExportOutlined,
  LockOutlined,
  UnlockOutlined,
  EditOutlined,
  EyeOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { Modal, Form, Select, Input, Tag as AntdTag, App as AntdApp, Avatar, Badge, Button, Space, Tooltip } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AdminUserListItem, PresenceState, UserPresenceEntry, UserRole, UserStatus } from '@/types/api';
import { listUsers, updateUser, lockUser, batchUsers, exportUsersCsv } from '@/services/user';
import { getUsersPresence } from '@/services/presence';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { useConfirmAction } from '@/components/ConfirmAction';
import MaskedText from '@/components/MaskedText';
import { PERM, ROLE_LABEL, ROLE_COLOR, ROLE_OPTIONS, USER_STATUS_LABEL, USER_STATUS_COLOR, USER_STATUS_OPTIONS, BATCH_LIMIT, PRESENCE_POLL_INTERVAL, PRESENCE_STATE_BADGE, PRESENCE_STATE_LABEL, PRESENCE_STATE_OPTIONS } from '@/constants';
import { formatDateTime, formatRelativeTime } from '@/utils/format';
import { downloadBlob, timestampedFilename } from '@/utils/download';

export default function UserListPage() {
  const { message } = AntdApp.useApp();
  const tableRef = useRef<ActionType>();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏所有写操作入口
  const readonly = useReadonlyAdmin();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserListItem | null>(null);
  const [editForm] = Form.useForm();
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm] = Form.useForm();
  // 当前页 userId 集合(presence 实时状态查询入参;单页 pageSize ≤ 100,满足接口上限)
  const [pageIds, setPageIds] = useState<string[]>([]);
  // 在线状态筛选(前端侧过滤当前页;presence 为独立接口,不做服务端筛选)
  const [presenceFilter, setPresenceFilter] = useState<PresenceState | undefined>(undefined);

  // 当前页用户实时状态:30s 轮询,placeholderData 保留上一次数据防闪屏
  const pageIdsKey = pageIds.join(',');
  const presenceQ = useQuery({
    queryKey: ['presence', 'users', pageIdsKey],
    queryFn: () => getUsersPresence(pageIds),
    enabled: pageIds.length > 0,
    refetchInterval: PRESENCE_POLL_INTERVAL,
    placeholderData: keepPreviousData,
  });

  // userId → 实时状态条目(列渲染与筛选共用)
  const presenceMap = useMemo(() => {
    const map = new Map<string, UserPresenceEntry>();
    presenceQ.data?.items.forEach((entry) => map.set(entry.userId, entry));
    return map;
  }, [presenceQ.data]);

  // 在线状态筛选:仅作用于当前页 presence 数据
  const postData = useCallback(
    (rows: AdminUserListItem[]): AdminUserListItem[] =>
      presenceFilter ? rows.filter((r) => presenceMap.get(r.id)?.state === presenceFilter) : rows,
    [presenceFilter, presenceMap],
  );

  const onEdit = (user: AdminUserListItem) => {
    setEditUser(user);
    editForm.setFieldsValue({ role: user.role, status: user.status, name: user.name });
    setEditOpen(true);
  };

  const onEditSubmit = async () => {
    const values = await editForm.validateFields();
    await updateUser(editUser!.id, values);
    message.success('用户已更新');
    setEditOpen(false);
    tableRef.current?.reload();
  };

  const onLock = (user: AdminUserListItem, locked: boolean) => {
    confirm(
      {
        title: locked ? '锁定用户' : '解锁用户',
        content: `确认${locked ? '锁定' : '解锁'}用户「${user.name}」?`,
        okText: locked ? '锁定' : '解锁',
        danger: locked,
      },
      () => lockUser(user.id, { locked }),
    ).then(() => tableRef.current?.reload());
  };

  const onExport = async () => {
    const blob = await exportUsersCsv({});
    downloadBlob(blob, timestampedFilename('users', 'csv'));
    message.success('导出成功(已脱敏)');
  };

  const onBatch = async () => {
    const values = await batchForm.validateFields();
    if (selectedKeys.length > BATCH_LIMIT) {
      message.warning(`单次最多 ${BATCH_LIMIT} 条,已选 ${selectedKeys.length} 条`);
      return;
    }
    const action = values.action as 'updateRole' | 'delete';
    confirm(
      {
        title: '批量操作确认',
        content: (
          <div>
            将对 <b>{selectedKeys.length}</b> 个用户执行
            <b style={{ color: '#c8392e' }}>
              {action === 'updateRole' ? `角色变更为 ${ROLE_LABEL[values.role as UserRole]}` : '删除'}
            </b>
            ,此操作不可撤销。
          </div>
        ),
        okText: '执行',
        danger: action === 'delete',
        requireText: action === 'delete' ? '删除' : undefined,
      },
      () =>
        batchUsers({
          userIds: selectedKeys,
          action,
          role: action === 'updateRole' ? (values.role as UserRole) : undefined,
        }),
    ).then((res) => {
      if (res) {
        message.success(`批量操作完成:成功 ${res.succeeded} 失败 ${res.failed}`);
        setBatchOpen(false);
        setSelectedKeys([]);
        tableRef.current?.reload();
      }
    });
  };

  const columns: ProColumns<AdminUserListItem>[] = [
    {
      title: '用户',
      dataIndex: 'name',
      width: 180,
      fixed: 'left',
      render: (_, r) => (
        <Space size={8}>
          <Avatar size={26} src={r.avatar} style={{ backgroundColor: '#2e5c6e' }}>
            {r.name?.charAt(0)}
          </Avatar>
          <a onClick={() => history.push(`/user/detail/${r.id}`)}>{r.name}</a>
        </Space>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 180,
      hideInSearch: true,
      render: (_, r) => <MaskedText value={r.email} type="email" />,
    },
    {
      title: '手机',
      dataIndex: 'phone',
      width: 140,
      hideInSearch: true,
      render: (_, r) => <MaskedText value={r.phone} type="phone" />,
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      valueType: 'select',
      fieldProps: { options: ROLE_OPTIONS, allowClear: true },
      render: (_, r) => <AntdTag color={ROLE_COLOR[r.role]}>{ROLE_LABEL[r.role]}</AntdTag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      fieldProps: { options: USER_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => (
        <span>
          <span
            className="dq-status-dot"
            style={{
              background:
                r.status === 'active' ? '#3e7d5a' : r.status === 'locked' ? '#c8392e' : '#bfb8a8',
            }}
          />
          <AntdTag color={USER_STATUS_COLOR[r.status]} style={{ margin: 0 }}>
            {USER_STATUS_LABEL[r.status]}
          </AntdTag>
        </span>
      ),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      sorter: true,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      width: 160,
      hideInSearch: true,
      sorter: true,
      render: (_, r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : '-'),
    },
    {
      // M4-ADM-1:实时在线状态(三态,30s 轮询;数据来自 /api/admin/presence/users)
      title: '在线状态',
      dataIndex: 'presence',
      width: 110,
      hideInSearch: true,
      render: (_, r) => {
        const entry = presenceMap.get(r.id);
        // presence 数据尚未返回时占位,不虚构状态
        if (!entry) return <span style={{ color: '#bfb8a8' }}>-</span>;
        return (
          <Tooltip
            title={
              entry.lastSeenAt ? `最近活跃:${formatRelativeTime(entry.lastSeenAt)}` : '暂无活跃记录'
            }
          >
            <Badge
              status={PRESENCE_STATE_BADGE[entry.state]}
              text={PRESENCE_STATE_LABEL[entry.state]}
            />
          </Tooltip>
        );
      },
    },
    {
      title: '排序',
      dataIndex: 'sortBy',
      valueType: 'select',
      hideInTable: true,
      fieldProps: {
        options: [
          { label: '注册时间', value: 'createdAt' },
          { label: '最后登录', value: 'lastLoginAt' },
          { label: '姓名', value: 'name' },
        ],
      },
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      fixed: 'right',
      render: (_, r) => [
        <a key="detail" onClick={() => history.push(`/user/detail/${r.id}`)}>
          <EyeOutlined /> 详情
        </a>,
        !readonly && (
          <Access key="edit" permission={PERM.userWrite}>
            <a onClick={() => onEdit(r)}>
              <EditOutlined /> 编辑
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="lock" permission={PERM.userWrite}>
            <a
              onClick={() => onLock(r, r.status !== 'locked')}
              style={{ color: r.status === 'locked' ? '#3e7d5a' : '#c8392e' }}
            >
              {r.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />}
              {r.status === 'locked' ? '解锁' : '锁定'}
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '用户列表', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<AdminUserListItem>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        size="small"
        search={{ labelWidth: 70, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: { listsHeight: 400 } }}
        pagination={{
          pageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
        }}
        request={async (params) => {
          const { current, pageSize, createdAt, ...rest } = params;
          const res = await listUsers({
            page: current,
            pageSize,
            ...rest,
            search: rest.name as string | undefined,
            sortBy: rest.sortBy as 'createdAt' | 'lastLoginAt' | 'name' | undefined,
            sortOrder: rest.sortBy ? 'desc' : undefined,
            startDate: createdAt?.[0],
            endDate: createdAt?.[1],
            role: rest.role as UserRole | undefined,
            status: rest.status as UserStatus | undefined,
          });
          // 列表加载完成后取当前页全部 userId,驱动 presence 实时状态查询(≤100)
          setPageIds(res.items.map((item) => item.id));
          return {
            data: res.items,
            total: res.total,
            success: true,
          };
        }}
        postData={postData}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as string[]),
          preserveSelectedRowKeys: true,
        }}
        tableAlertOptionRender={() => (
          <Space size={12}>
            <span>已选 {selectedKeys.length} 项(上限 {BATCH_LIMIT})</span>
            {!readonly && (
              <Access permission={PERM.userWrite}>
                <Button size="small" onClick={() => setBatchOpen(true)}>
                  批量操作
                </Button>
              </Access>
            )}
            <Button size="small" onClick={() => setSelectedKeys([])}>
              取消选择
            </Button>
          </Space>
        )}
        toolBarRender={() => [
          <Space key="presence-filter" size={4}>
            <Select<PresenceState>
              allowClear
              placeholder="在线状态"
              style={{ width: 120 }}
              options={PRESENCE_STATE_OPTIONS}
              value={presenceFilter}
              onChange={(value) => setPresenceFilter(value)}
            />
            <Tooltip title="在线状态来自实时接口(30s 自动刷新),筛选仅作用于当前页数据">
              <QuestionCircleOutlined style={{ color: '#a8a39a' }} />
            </Tooltip>
          </Space>,
          <Access key="export" permission={PERM.userExport}>
            <Button icon={<ExportOutlined />} onClick={onExport}>
              导出 CSV
            </Button>
          </Access>,
        ]}
      />

      {/* 编辑用户 */}
      <Modal
        title="编辑用户"
        open={editOpen}
        onOk={onEditSubmit}
        onCancel={() => setEditOpen(false)}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true }]}>
            <Select options={USER_STATUS_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量操作 */}
      <Modal
        title="批量操作"
        open={batchOpen}
        onOk={onBatch}
        onCancel={() => setBatchOpen(false)}
        destroyOnClose
      >
        <Form form={batchForm} layout="vertical" initialValues={{ action: 'updateRole' }}>
          <Form.Item label="已选用户" name="count">
            <Input value={`${selectedKeys.length} 个`} disabled />
          </Form.Item>
          <Form.Item label="操作类型" name="action" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '批量变更角色', value: 'updateRole' },
                { label: '批量删除(软删除)', value: 'delete' },
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.action !== cur.action}
          >
            {({ getFieldValue }) =>
              getFieldValue('action') === 'updateRole' ? (
                <Form.Item label="目标角色" name="role" rules={[{ required: true }]}>
                  <Select options={ROLE_OPTIONS} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
