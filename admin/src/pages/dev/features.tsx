// ============================================================
// 开发者视图 - 功能开关
// - ProTable 展示:名称 / featureId / 描述 / 类型 / 状态 / 当前值
// - 值编辑(按类型):boolean → Switch;percentage → InputNumber(0-100);名单 → Select tags
// - 更新走 PATCH /api/v1/config/features/:featureId(仅 ADMIN/OWNER,403 由请求层兜底提示)
// - 二级只读管理员:禁用编辑
// ============================================================

import { useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Tag,
  Alert,
  App,
  Modal,
  Switch,
  InputNumber,
  Select,
  Button,
  Space,
  Tooltip,
} from 'antd';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFeatures, updateFeature } from '@/services/dev';
import type { FeatureFlag, FeatureFlagStatus, FeatureFlagType } from '@/services/dev';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';

/** 功能开关类型 → 中文 */
const FEATURE_TYPE_LABEL: Record<FeatureFlagType, string> = {
  boolean: '布尔开关',
  percentage: '百分比灰度',
  'user-list': '用户名单',
  'tenant-list': '租户名单',
};

/** 功能开关状态 → 中文 */
const FEATURE_STATUS_LABEL: Record<FeatureFlagStatus, string> = {
  enabled: '已启用',
  disabled: '已禁用',
  gradual: '灰度中',
};

/** 功能开关状态 → Tag 颜色 */
const FEATURE_STATUS_COLOR: Record<FeatureFlagStatus, string> = {
  enabled: 'success',
  disabled: 'default',
  gradual: 'warning',
};

/** 当前值展示(按类型) */
function renderValue(f: FeatureFlag) {
  if (typeof f.value === 'boolean') {
    return <Tag color={f.value ? 'success' : 'default'}>{f.value ? '开启' : '关闭'}</Tag>;
  }
  if (typeof f.value === 'number') {
    return <b style={{ color: '#c9a961' }}>{f.value}%</b>;
  }
  const list = Array.isArray(f.value) ? f.value : [];
  if (list.length === 0) return <span style={{ color: '#bfb8a8' }}>空名单</span>;
  return (
    <Space size={4} wrap>
      {list.slice(0, 5).map((v) => (
        <Tag key={v}>{v}</Tag>
      ))}
      {list.length > 5 && <Tag>+{list.length - 5}</Tag>}
    </Space>
  );
}

export default function DevFeaturesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 二级只读管理员:禁用编辑入口
  const readonly = useReadonlyAdmin();

  const [editTarget, setEditTarget] = useState<FeatureFlag | null>(null);
  const [editValue, setEditValue] = useState<boolean | number | string[]>(false);

  const featuresQ = useQuery({
    queryKey: ['dev', 'features'],
    queryFn: getFeatures,
  });

  const updateMut = useMutation({
    mutationFn: ({ featureId, value }: { featureId: string; value: boolean | number | string[] }) =>
      updateFeature(featureId, value),
    onSuccess: () => {
      message.success('功能开关已更新,实时生效');
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ['dev', 'features'] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '更新失败'),
  });

  const openEdit = (record: FeatureFlag) => {
    setEditTarget(record);
    setEditValue(record.value);
  };

  const onSubmit = () => {
    if (!editTarget) return;
    updateMut.mutate({ featureId: editTarget.featureId, value: editValue });
  };

  const columns: ProColumns<FeatureFlag>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
      render: (_, r) => <b>{r.name}</b>,
    },
    {
      title: 'featureId',
      dataIndex: 'featureId',
      width: 180,
      render: (_, r) => (
        <code style={{ background: '#f5f0e3', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>
          {r.featureId}
        </code>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      filters: (Object.keys(FEATURE_TYPE_LABEL) as FeatureFlagType[]).map((t) => ({
        text: FEATURE_TYPE_LABEL[t],
        value: t,
      })),
      onFilter: (value, record) => record.type === value,
      render: (_, r) => <Tag>{FEATURE_TYPE_LABEL[r.type] ?? r.type}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      filters: (Object.keys(FEATURE_STATUS_LABEL) as FeatureFlagStatus[]).map((s) => ({
        text: FEATURE_STATUS_LABEL[s],
        value: s,
      })),
      onFilter: (value, record) => record.status === value,
      render: (_, r) => (
        <Tag color={FEATURE_STATUS_COLOR[r.status]}>{FEATURE_STATUS_LABEL[r.status] ?? r.status}</Tag>
      ),
    },
    {
      title: '当前值',
      dataIndex: 'value',
      width: 200,
      render: (_, r) => renderValue(r),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      fixed: 'right',
      render: (_, r) =>
        readonly ? (
          <Tooltip key="edit-disabled" title="二级管理员为只读视图,不可编辑">
            <Button size="small" icon={<EditOutlined />} disabled>
              编辑
            </Button>
          </Tooltip>
        ) : (
          <a key="edit" onClick={() => openEdit(r)}>
            <EditOutlined /> 编辑
          </a>
        ),
    },
  ];

  return (
    <PageContainer header={{ title: '功能开关', ghost: true }}>
      <ReadonlyAlert />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="功能开关实时生效,灰度需谨慎"
        description="修改后立即对所有在线实例生效;百分比灰度请逐步放量(如 10% → 50% → 100%),名单类型请确认目标 ID 准确。"
      />

      <ProTable<FeatureFlag>
        rowKey="featureId"
        columns={columns}
        dataSource={featuresQ.data ?? []}
        loading={featuresQ.isLoading}
        search={false}
        size="small"
        scroll={{ x: 1100 }}
        options={{ density: true, fullScreen: true, reload: false, setting: true }}
        pagination={false}
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            loading={featuresQ.isFetching}
            onClick={() => featuresQ.refetch()}
          >
            刷新
          </Button>,
        ]}
      />

      {/* 值编辑(控件按开关类型切换) */}
      <Modal
        title={editTarget ? `编辑开关 · ${editTarget.name}` : '编辑开关'}
        open={!!editTarget}
        onOk={onSubmit}
        onCancel={() => setEditTarget(null)}
        confirmLoading={updateMut.isPending}
        width={520}
        destroyOnClose
      >
        {editTarget && (
          <div>
            <div style={{ marginBottom: 12, color: '#6b6b6b', fontSize: 13 }}>
              <code>{editTarget.featureId}</code>
              <span style={{ marginLeft: 8 }}>{FEATURE_TYPE_LABEL[editTarget.type]}</span>
              <span style={{ marginLeft: 8 }}>
                当前状态:
                <Tag color={FEATURE_STATUS_COLOR[editTarget.status]} style={{ marginLeft: 4 }}>
                  {FEATURE_STATUS_LABEL[editTarget.status]}
                </Tag>
              </span>
            </div>
            <div style={{ marginBottom: 8, fontSize: 13 }}>当前值:</div>
            {editTarget.type === 'boolean' && (
              <Switch
                checked={Boolean(editValue)}
                checkedChildren="开启"
                unCheckedChildren="关闭"
                onChange={(v) => setEditValue(v)}
              />
            )}
            {editTarget.type === 'percentage' && (
              <InputNumber
                min={0}
                max={100}
                step={5}
                value={typeof editValue === 'number' ? editValue : 0}
                onChange={(v) => setEditValue(v ?? 0)}
                addonAfter="%"
                style={{ width: 200 }}
              />
            )}
            {(editTarget.type === 'user-list' || editTarget.type === 'tenant-list') && (
              <Select
                mode="tags"
                style={{ width: '100%' }}
                placeholder={
                  editTarget.type === 'user-list' ? '输入用户 ID 后回车添加' : '输入租户 ID 后回车添加'
                }
                value={Array.isArray(editValue) ? editValue : []}
                onChange={(v) => setEditValue(v)}
              />
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: '#8c8c8c' }}>
              默认值:{JSON.stringify(editTarget.defaultValue)}
              (开关关闭时回退到默认值)
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
