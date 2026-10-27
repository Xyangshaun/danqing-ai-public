// ============================================================
// 用户管理 - 角色权限矩阵
// 4 角色(ADMIN/OWNER/TEACHER/STUDENT)权限矩阵可视化
// 权限矩阵从后端 /api/admin/roles 动态加载(非前端硬编码)
// 超管可编辑(PATCH /api/admin/roles/:role)
// ============================================================

import { useMemo } from 'react';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Table, Tag, Switch, App as AntdApp, Tooltip, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listRoles, updateRole } from '@/services/user';
import { usePermission } from '@/hooks/usePermission';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { PERM, ROLE_LABEL, ROLE_COLOR } from '@/constants';
import type { AdminRoleInfo, UserRole } from '@/types/api';

/** 权限模块分组(用于展示,模块名为中文) */
const PERM_GROUPS: { module: string; codes: { code: string; name: string }[] }[] = [
  { module: '用户管理', codes: [
    { code: PERM.userRead, name: '查看用户' },
    { code: PERM.userWrite, name: '编辑用户' },
    { code: PERM.userExport, name: '导出用户' },
    { code: PERM.roleRead, name: '查看角色' },
    { code: PERM.roleWrite, name: '编辑角色' },
  ]},
  { module: '内容管理', codes: [
    { code: PERM.artworkRead, name: '查看作品' },
    { code: PERM.artworkWrite, name: '审核/删除作品' },
    { code: PERM.templateRead, name: '查看模板' },
    { code: PERM.templateWrite, name: '管理模板' },
    { code: PERM.presetRead, name: '查看预设' },
    { code: PERM.presetWrite, name: '管理预设' },
  ]},
  { module: '订阅管理', codes: [
    { code: PERM.subscriptionRead, name: '查看订阅' },
    { code: PERM.subscriptionWrite, name: '取消/退款' },
    { code: PERM.planRead, name: '查看套餐' },
    { code: PERM.planWrite, name: '管理套餐' },
  ]},
  { module: '数据看板', codes: [
    { code: PERM.statsRead, name: '查看数据' },
  ]},
  { module: '系统管理', codes: [
    { code: PERM.tenantRead, name: '查看租户' },
    { code: PERM.tenantWrite, name: '管理租户' },
    { code: PERM.auditRead, name: '查看审计' },
    { code: PERM.apiKeyRead, name: '查看密钥' },
    { code: PERM.apiKeyWrite, name: '管理密钥' },
    { code: PERM.systemHealth, name: '系统健康' },
    { code: PERM.invitationWrite, name: '邀请码/批量导入' },
  ]},
];

export default function RolesPage() {
  const { message } = AntdApp.useApp();
  const { can } = usePermission();
  // 二级只读管理员:权限编辑开关降级为只读标签
  const readonly = useReadonlyAdmin();
  const queryClient = useQueryClient();

  const rolesQ = useQuery<AdminRoleInfo[]>({
    queryKey: ['roles'],
    queryFn: listRoles,
    staleTime: 5 * 60_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ role, permissions }: { role: UserRole; permissions: string[] }) =>
      updateRole(role, { permissions }),
    onSuccess: () => {
      message.success('角色权限已更新');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '更新失败'),
  });

  const roles = rolesQ.data ?? [];

  /** 拍平权限码列表(去重,保留分组顺序) */
  const allPermRows = useMemo(() => {
    const rows: { module: string; code: string; name: string }[] = [];
    PERM_GROUPS.forEach((g) => g.codes.forEach((c) => rows.push({ module: g.module, ...c })));
    return rows;
  }, []);

  /** 切换某角色某权限 */
  const togglePermission = (role: UserRole, code: string, checked: boolean) => {
    const roleInfo = roles.find((r) => r.role === role);
    if (!roleInfo) return;
    const next = checked
      ? [...roleInfo.permissions, code]
      : roleInfo.permissions.filter((p) => p !== code);
    updateMut.mutate({ role, permissions: next });
  };

  const columns: ColumnsType<{ module: string; code: string; name: string }> = [
    {
      title: '模块',
      dataIndex: 'module',
      width: 100,
      onCell: (_, index) => {
        // 合并同模块单元格
        const row = allPermRows[index!];
        const prev = index! > 0 ? allPermRows[index! - 1] : null;
        return { rowSpan: prev && prev.module === row.module ? 0 : PERM_GROUPS.find((g) => g.module === row.module)!.codes.length };
      },
      render: (m) => <span style={{ fontWeight: 500 }}>{m}</span>,
    },
    { title: '权限', dataIndex: 'name', width: 120 },
    { title: '权限码', dataIndex: 'code', width: 200, render: (c) => <code style={{ fontSize: 12 }}>{c}</code> },
    ...roles.map<ColumnsType<{ module: string; code: string; name: string }>[number]>((role) => ({
      title: (
        <Tag color={ROLE_COLOR[role.role]}>{ROLE_LABEL[role.role]}</Tag>
      ),
      dataIndex: role.role,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record) => {
        const has = role.permissions.includes(record.code);
        return can.roleWrite && !readonly ? (
          <Switch
            size="small"
            checked={has}
            loading={updateMut.isPending}
            onChange={(checked) => togglePermission(role.role, record.code, checked)}
          />
        ) : (
          <Tag color={has ? 'success' : 'default'}>{has ? '有' : '无'}</Tag>
        );
      },
    })),
  ];

  return (
    <PageContainer header={{ title: '角色权限矩阵', ghost: true }}>
      <ReadonlyAlert />
      <ProCard
        bodyStyle={{ padding: 0 }}
        extra={
          <Tooltip title="权限矩阵由后端 /api/admin/roles 动态返回,前端仅展示与编辑">
            <Tag>动态加载</Tag>
          </Tooltip>
        }
      >
        {rolesQ.isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>加载中...</div>
        ) : roles.length === 0 ? (
          <Empty description="暂无角色数据" />
        ) : (
          <Table
            size="small"
            rowKey="code"
            columns={columns}
            dataSource={allPermRows}
            pagination={false}
            bordered
            scroll={{ x: 800 }}
          />
        )}
      </ProCard>

      <ProCard title="角色说明" style={{ marginTop: 12 }}>
        <Table
          size="small"
          rowKey="role"
          pagination={false}
          dataSource={roles}
          columns={[
            { title: '角色', dataIndex: 'role', width: 100, render: (r: UserRole) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Tag> },
            { title: '角色码', dataIndex: 'role', width: 100, render: (r: string) => <code>{r}</code> },
            { title: '说明', dataIndex: 'description' },
            { title: '权限数', dataIndex: 'permissions', width: 80, render: (p: string[]) => p.length },
          ]}
        />
      </ProCard>
    </PageContainer>
  );
}
