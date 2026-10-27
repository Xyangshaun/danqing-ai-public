// ============================================================
// 开发者视图 - 账号在线
// - 顶部统计卡片:总账号数 / 当前在线 / 各角色数量(来自 summary)
// - 实时状态汇总条:在线 / 挂起 / 离线 三态人数(来自 /api/admin/presence/online)
// - 表格:邮箱(脱敏)/ 姓名 / 角色 / 租户 / 认证方式 / 实时状态(三态)+会话数 / 最近活跃 / 测试账号
// - 默认按 isOnline 降序;角色/实时状态列支持客户端筛选
// - 每 30s 轮询(keepPreviousData 保留上次数据,刷新不闪屏)
// ============================================================

import { useMemo } from 'react';
import { PageContainer, ProCard, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Row, Col, Tag, Badge, Alert, Statistic, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getDevAccounts, getPresenceOnline } from '@/services/dev';
import type { DevAccountItem } from '@/services/dev';
import MaskedText from '@/components/MaskedText';
import {
  ROLE_LABEL,
  ROLE_COLOR,
  ROLE_OPTIONS,
  PRESENCE_POLL_INTERVAL,
  PRESENCE_STATE_LABEL,
  PRESENCE_STATE_BADGE,
  PRESENCE_STATE_OPTIONS,
} from '@/constants';
import type { PresenceState, UserRole } from '@/types/api';
import { formatDateTime, formatRelativeTime } from '@/utils/format';

/** 汇总卡片角色展示顺序(其余角色兜底追加) */
const ROLE_ORDER: UserRole[] = ['admin', 'owner', 'teacher', 'student'];

/**
 * 解析账号三态状态。
 * 优先取后端 dev/accounts 返回的 presenceState;若字段缺失/异常(旧缓存、旧版本后端),
 * 回退用 isOnline 推导:isOnline → 'idle'(会话有效但不活跃),否则 'offline',保证页面不崩。
 */
function resolvePresenceState(item: DevAccountItem): PresenceState {
  const state = item.presenceState;
  if (state === 'online' || state === 'idle' || state === 'offline') {
    return state;
  }
  return item.isOnline ? 'idle' : 'offline';
}

export default function DevAccountsPage() {
  const accountsQ = useQuery({
    queryKey: ['dev', 'accounts'],
    queryFn: getDevAccounts,
    refetchInterval: PRESENCE_POLL_INTERVAL,
    placeholderData: keepPreviousData,
  });

  /** 实时在线三态汇总(与账号列表并行加载,同频 30s 轮询) */
  const presenceQ = useQuery({
    queryKey: ['presence', 'online'],
    queryFn: getPresenceOnline,
    refetchInterval: PRESENCE_POLL_INTERVAL,
    placeholderData: keepPreviousData,
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const summary = accountsQ.data?.summary;
  const presenceSummary = presenceQ.data?.summary;
  const presenceAsOf = presenceQ.data?.asOf;

  /** 默认按在线状态降序(在线账号排在前面) */
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => Number(b.isOnline) - Number(a.isOnline)),
    [accounts],
  );

  /** 角色汇总(按固定顺序 + 未知角色兜底) */
  const roleEntries = useMemo(() => {
    const byRole = summary?.byRole ?? {};
    const known = ROLE_ORDER.map((role) => ({ role, count: byRole[role] ?? 0 }));
    const extras = Object.keys(byRole)
      .filter((r) => !ROLE_ORDER.includes(r as UserRole))
      .map((r) => ({ role: r as UserRole, count: byRole[r] }));
    return [...known, ...extras];
  }, [summary]);

  const columns: ProColumns<DevAccountItem>[] = [
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      ellipsis: true,
      render: (_, r) => <MaskedText value={r.email} type="email" />,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      width: 120,
      render: (_, r) => <b>{r.name}</b>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 170,
      filters: ROLE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => record.role === value,
      render: (_, r) => (
        <Space size={4}>
          <Tag color={ROLE_COLOR[r.role] ?? 'default'}>{ROLE_LABEL[r.role] ?? r.role}</Tag>
          {(r.role === 'admin' || r.role === 'owner') && <Tag color="red">更高权限</Tag>}
        </Space>
      ),
    },
    {
      title: '租户',
      dataIndex: 'tenantName',
      width: 160,
      ellipsis: true,
      render: (_, r) => r.tenantName ?? <span style={{ color: '#bfb8a8' }}>-</span>,
    },
    {
      title: '认证方式',
      dataIndex: 'authType',
      width: 110,
      render: (_, r) => <Tag>{r.authType}</Tag>,
    },
    {
      title: '实时状态',
      dataIndex: 'presenceState',
      width: 150,
      filters: PRESENCE_STATE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => resolvePresenceState(record) === value,
      render: (_, r) => {
        const state = resolvePresenceState(r);
        return (
          <Space size={8}>
            <Badge
              status={PRESENCE_STATE_BADGE[state]}
              text={PRESENCE_STATE_LABEL[state]}
            />
            <span style={{ color: '#6b6b6b', fontSize: 12 }}>{r.activeSessions} 会话</span>
          </Space>
        );
      },
    },
    {
      title: '最近活跃',
      dataIndex: 'lastActiveAt',
      width: 140,
      render: (_, r) =>
        r.lastActiveAt ? (
          formatRelativeTime(r.lastActiveAt)
        ) : (
          <span style={{ color: '#bfb8a8' }}>-</span>
        ),
    },
    {
      title: '测试账号',
      dataIndex: 'isTestAccount',
      width: 100,
      filters: [{ text: '仅测试账号', value: 'test' }],
      onFilter: (value, record) => (value === 'test' ? record.isTestAccount : true),
      render: (_, r) =>
        r.isTestAccount ? (
          <Tag color="orange">测试</Tag>
        ) : (
          <span style={{ color: '#bfb8a8' }}>-</span>
        ),
    },
  ];

  return (
    <PageContainer header={{ title: '账号在线', ghost: true }}>
      {accountsQ.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="账号在线数据获取失败"
          description="请稍后重试,或检查后端 /api/admin/dev/accounts 服务是否可用。"
        />
      ) : null}
      {presenceQ.isError ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="实时状态汇总获取失败"
          description="三态汇总暂不可用(接口需 admin:stats:read 权限),下方账号列表不受影响。"
        />
      ) : null}

      {/* 汇总卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={4}>
          <ProCard>
            <Statistic title="总账号数" value={summary?.total ?? '-'} loading={accountsQ.isLoading} />
          </ProCard>
        </Col>
        <Col xs={12} md={4}>
          <ProCard>
            <Statistic
              title="当前在线"
              value={summary?.online ?? '-'}
              loading={accountsQ.isLoading}
              valueStyle={{ color: '#3e7d5a' }}
            />
          </ProCard>
        </Col>
        {roleEntries.map(({ role, count }) => (
          <Col xs={12} md={4} key={role}>
            <ProCard>
              <Statistic
                title={ROLE_LABEL[role] ?? role}
                value={count}
                loading={accountsQ.isLoading}
              />
            </ProCard>
          </Col>
        ))}
      </Row>

      {/* 实时状态汇总条(三态人数,30s 自动刷新) */}
      <ProCard style={{ marginBottom: 16 }} bodyStyle={{ paddingTop: 12, paddingBottom: 12 }}>
        <Space size={40} wrap align="center">
          <Statistic
            title="实时在线"
            value={presenceSummary?.online ?? '-'}
            loading={presenceQ.isLoading}
            valueStyle={{ color: '#3e7d5a' }}
          />
          <Statistic
            title="挂起"
            value={presenceSummary?.idle ?? '-'}
            loading={presenceQ.isLoading}
            valueStyle={{ color: '#b58900' }}
          />
          <Statistic
            title="离线"
            value={presenceSummary?.offline ?? '-'}
            loading={presenceQ.isLoading}
            valueStyle={{ color: '#8c8c8c' }}
          />
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>
            数据截至 {presenceAsOf ? formatDateTime(presenceAsOf) : '-'} · 每 30s 自动刷新
          </span>
        </Space>
      </ProCard>

      {/* 账号表格(默认在线优先,角色/实时状态/测试支持筛选) */}
      <ProTable<DevAccountItem>
        rowKey="id"
        columns={columns}
        dataSource={sortedAccounts}
        loading={accountsQ.isLoading}
        search={false}
        headerTitle="账号列表(默认在线优先)"
        size="small"
        scroll={{ x: 1250 }}
        options={{ density: true, fullScreen: true, reload: false, setting: true }}
        pagination={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100], showSizeChanger: true }}
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            loading={accountsQ.isFetching || presenceQ.isFetching}
            onClick={() => {
              accountsQ.refetch();
              presenceQ.refetch();
            }}
          >
            刷新
          </Button>,
        ]}
      />
    </PageContainer>
  );
}
