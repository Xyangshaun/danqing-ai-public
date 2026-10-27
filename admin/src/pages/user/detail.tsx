// ============================================================
// 用户管理 - 用户详情
// 基本信息 + 角色 + 操作日志(审计)+ 关联作品
// ============================================================

import { useParams, history } from '@umijs/max';
import { PageContainer, ProDescriptions, ProCard } from '@ant-design/pro-components';
import { Avatar, Tag as AntdTag, Button, Spin, Tabs, Empty } from 'antd';
import { ArrowLeftOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getUser } from '@/services/user';
import { listAuditLogs } from '@/services/system';
import { listArtworks } from '@/services/content';
import { lockUser } from '@/services/user';
import { useConfirmAction } from '@/components/ConfirmAction';
import MaskedText from '@/components/MaskedText';
import {
  ROLE_LABEL,
  ROLE_COLOR,
  USER_STATUS_LABEL,
  USER_STATUS_COLOR,
  ART_TYPE_LABEL,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_COLOR,
  AUDIT_ACTION_LABEL,
  AUDIT_ACTION_COLOR,
} from '@/constants';
import { formatDateTime, formatRelativeTime } from '@/utils/format';
import type { AuditLogInfo } from '@/types/api';

export default function UserDetailPage() {
  const params = useParams();
  const userId = params.id as string;
  const { confirm } = useConfirmAction();

  const userQ = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId),
    enabled: !!userId,
  });
  const auditQ = useQuery({
    queryKey: ['audit-logs', 'user', userId],
    queryFn: () => listAuditLogs({ operatorId: userId, page: 1, pageSize: 20 }),
    enabled: !!userId,
  });
  const artworksQ = useQuery({
    queryKey: ['artworks', 'user', userId],
    queryFn: () => listArtworks({ userId, page: 1, pageSize: 20 }),
    enabled: !!userId,
  });

  const u = userQ.data;

  const onLock = (locked: boolean) => {
    confirm(
      {
        title: locked ? '锁定用户' : '解锁用户',
        content: `确认${locked ? '锁定' : '解锁'}用户「${u?.name}」?`,
        okText: locked ? '锁定' : '解锁',
        danger: locked,
      },
      () => lockUser(userId, { locked }),
    ).then(() => userQ.refetch());
  };

  if (userQ.isLoading) {
    return (
      <PageContainer>
        <Spin />
      </PageContainer>
    );
  }
  if (!u) {
    return (
      <PageContainer>
        <Empty description="用户不存在或已被删除" />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      header={{
        title: '用户详情',
        ghost: true,
        onBack: () => history.back(),
        backIcon: <ArrowLeftOutlined />,
      }}
      extra={[
        <Button
          key="lock"
          icon={u.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />}
          onClick={() => onLock(u.status !== 'locked')}
          danger={u.status !== 'locked'}
        >
          {u.status === 'locked' ? '解锁' : '锁定'}
        </Button>,
      ]}
    >
      <ProCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Avatar size={64} src={u.avatar} style={{ backgroundColor: '#2e5c6e' }}>
            {u.name?.charAt(0)}
          </Avatar>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {u.name}
              <AntdTag color={ROLE_COLOR[u.role]} style={{ marginLeft: 8 }}>
                {ROLE_LABEL[u.role]}
              </AntdTag>
              <AntdTag color={USER_STATUS_COLOR[u.status]} style={{ marginLeft: 4 }}>
                {USER_STATUS_LABEL[u.status]}
              </AntdTag>
            </div>
            <div style={{ fontSize: 12, color: '#6b6b6b', marginTop: 4 }}>ID: {u.id}</div>
          </div>
        </div>

        <ProDescriptions column={2} size="small" bordered>
          <ProDescriptions.Item label="邮箱">
            <MaskedText value={u.email} type="email" />
          </ProDescriptions.Item>
          <ProDescriptions.Item label="手机">
            <MaskedText value={u.phone} type="phone" />
          </ProDescriptions.Item>
          <ProDescriptions.Item label="租户 ID">{u.tenantId}</ProDescriptions.Item>
          <ProDescriptions.Item label="飞书 OpenID">{u.feishuOpenId}</ProDescriptions.Item>
          <ProDescriptions.Item label="注册时间">{formatDateTime(u.createdAt)}</ProDescriptions.Item>
          <ProDescriptions.Item label="最后登录">
            {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '-'}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="更新时间">{formatDateTime(u.updatedAt)}</ProDescriptions.Item>
          <ProDescriptions.Item label="锁定时间">
            {u.lockedAt ? formatDateTime(u.lockedAt) : '-'}
          </ProDescriptions.Item>
        </ProDescriptions>
      </ProCard>

      <ProCard style={{ marginTop: 12 }}>
        <Tabs
          items={[
            {
              key: 'audit',
              label: `操作日志(${auditQ.data?.total ?? 0})`,
              children: (
                <Spin spinning={auditQ.isLoading}>
                  {(auditQ.data?.items ?? []).length === 0 ? (
                    <Empty description="暂无操作日志" />
                  ) : (
                    <div>
                      {(auditQ.data?.items ?? []).map((log: AuditLogInfo) => (
                        <div
                          key={log.id}
                          style={{
                            padding: '10px 0',
                            borderBottom: '1px solid #ece6d8',
                            display: 'flex',
                            gap: 12,
                            alignItems: 'flex-start',
                          }}
                        >
                          <AntdTag color={AUDIT_ACTION_COLOR[log.action]}>
                            {AUDIT_ACTION_LABEL[log.action]}
                          </AntdTag>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13 }}>
                              资源:<b>{log.resource}</b>
                              {log.resourceId && (
                                <span style={{ color: '#6b6b6b', marginLeft: 8 }}>
                                  #{log.resourceId.slice(0, 8)}
                                </span>
                              )}
                            </div>
                            {log.note && (
                              <div style={{ fontSize: 12, color: '#6b6b6b', marginTop: 2 }}>
                                {log.note}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                              {formatRelativeTime(log.createdAt)} · IP {log.ip}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Spin>
              ),
            },
            {
              key: 'artworks',
              label: `关联作品(${artworksQ.data?.total ?? 0})`,
              children: (
                <Spin spinning={artworksQ.isLoading}>
                  {(artworksQ.data?.items ?? []).length === 0 ? (
                    <Empty description="暂无作品" />
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 120px)', gap: 12 }}>
                      {(artworksQ.data?.items ?? []).map((a) => (
                        <div key={a.id} style={{ textAlign: 'center' }}>
                          <img
                            src={a.imageUrl}
                            alt={a.title ?? ''}
                            className="dq-thumb"
                            style={{ width: 100, height: 100 }}
                          />
                          <div style={{ fontSize: 11, marginTop: 4, color: '#6b6b6b' }}>
                            {ART_TYPE_LABEL[a.workType]}
                          </div>
                          <AntdTag
                            color={REVIEW_STATUS_COLOR[a.reviewStatus]}
                            style={{ margin: 0 }}
                          >
                            {REVIEW_STATUS_LABEL[a.reviewStatus]}
                          </AntdTag>
                        </div>
                      ))}
                    </div>
                  )}
                </Spin>
              ),
            },
          ]}
        />
      </ProCard>
    </PageContainer>
  );
}
