// ============================================================
// 内容管理 - 创意预设模板管理 CRUD
// 8 种嫁接风格、6 种融合方法、4 种强度、6 个预设
// ============================================================

import { useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Tag, Switch, Image, Button, Space, App, Modal, Form, Input, InputNumber, Select } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { CreativeTemplateInfo, ArtType } from '@/types/api';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/services/content';
import { useConfirmAction } from '@/components/ConfirmAction';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { PERM, ART_TYPE_LABEL, ART_TYPE_OPTIONS } from '@/constants';
import { formatDateTime } from '@/utils/format';

export default function TemplatesPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏新建/编辑/删除写操作入口
  const readonly = useReadonlyAdmin();
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditId(null);
    form.resetFields();
    form.setFieldsValue({ artType: 'painting', enabled: true, sortOrder: 0, tags: [], content: {} });
    setEditOpen(true);
  };

  const openEdit = (record: CreativeTemplateInfo) => {
    setEditId(record.id);
    form.setFieldsValue({
      name: record.name,
      description: record.description ?? '',
      artType: record.artType,
      thumbnailUrl: record.thumbnailUrl ?? '',
      enabled: record.enabled,
      sortOrder: record.sortOrder,
      tags: record.tags,
      contentText: JSON.stringify(record.content, null, 2),
    });
    setEditOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    let content: Record<string, unknown> = {};
    if (values.contentText) {
      try {
        content = JSON.parse(values.contentText as string);
      } catch {
        message.error('内容 JSON 格式错误');
        return;
      }
    }
    const payload = {
      name: values.name,
      description: values.description,
      artType: values.artType as ArtType,
      thumbnailUrl: values.thumbnailUrl,
      enabled: values.enabled,
      sortOrder: values.sortOrder,
      tags: values.tags,
      content,
    };
    if (editId) {
      await updateTemplate(editId, payload);
      message.success('模板已更新');
    } else {
      await createTemplate(payload);
      message.success('模板已创建');
    }
    setEditOpen(false);
    tableRef.current?.reload();
  };

  const onDelete = (record: CreativeTemplateInfo) => {
    confirm(
      {
        title: '删除模板',
        content: `确认删除模板「${record.name}」?`,
        okText: '删除',
        danger: true,
      },
      () => deleteTemplate(record.id),
    ).then(() => tableRef.current?.reload());
  };

  const columns: ProColumns<CreativeTemplateInfo>[] = [
    {
      title: '缩略图',
      dataIndex: 'thumbnailUrl',
      width: 80,
      hideInSearch: true,
      render: (_, r) =>
        r.thumbnailUrl ? (
          <Image src={r.thumbnailUrl} width={48} height={48} style={{ borderRadius: 4, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 48, height: 48, background: '#f5f0e3', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bfb8a8', fontSize: 11 }}>无</div>
        ),
    },
    { title: '名称', dataIndex: 'name', width: 160, fieldProps: { placeholder: '搜索名称' } },
    { title: '描述', dataIndex: 'description', width: 200, ellipsis: true, hideInSearch: true },
    {
      title: '类型',
      dataIndex: 'artType',
      width: 90,
      valueType: 'select',
      fieldProps: { options: ART_TYPE_OPTIONS, allowClear: true },
      render: (_, r) => <Tag>{ART_TYPE_LABEL[r.artType]}</Tag>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 160,
      hideInSearch: true,
      render: (_, r) => (r.tags ?? []).map((t) => <Tag key={t}>{t}</Tag>),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      valueType: 'select',
      fieldProps: { options: [{ label: '启用', value: true }, { label: '禁用', value: false }], allowClear: true },
      render: (_, r) => <Tag color={r.enabled ? 'success' : 'default'}>{r.enabled ? '启用' : '禁用'}</Tag>,
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70, hideInSearch: true },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160, hideInSearch: true, render: (_, r) => formatDateTime(r.updatedAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      fixed: 'right',
      render: (_, r) => [
        !readonly && (
          <Access key="edit" permission={PERM.templateWrite}>
            <a onClick={() => openEdit(r)}>
              <EditOutlined /> 编辑
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="delete" permission={PERM.templateWrite}>
            <a onClick={() => onDelete(r)} style={{ color: '#c8392e' }}>
              <DeleteOutlined /> 删除
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '模板管理', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<CreativeTemplateInfo>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        size="small"
        search={{ labelWidth: 60 }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await listTemplates({
            page: current,
            pageSize,
            search: rest.name as string | undefined,
            artType: rest.artType as ArtType | undefined,
            enabled: rest.enabled as boolean | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          !readonly && (
            <Access key="create" permission={PERM.templateWrite}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建模板
              </Button>
            </Access>
          ),
        ]}
      />

      <Modal
        title={editId ? '编辑模板' : '新建模板'}
        open={editOpen}
        onOk={onSubmit}
        onCancel={() => setEditOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item label="作品类型" name="artType" rules={[{ required: true }]} style={{ width: 200 }}>
              <Select options={ART_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item label="排序" name="sortOrder" style={{ width: 120 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked" style={{ width: 100 }}>
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item label="缩略图 URL" name="thumbnailUrl">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} maxLength={200} showCount />
          </Form.Item>
          <Form.Item label="标签" name="tags">
            <Select mode="tags" placeholder="输入后回车添加" />
          </Form.Item>
          <Form.Item
            label="模板内容(JSON)"
            name="contentText"
            extra="预设配置:嫁接风格/融合方法/强度等"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error('JSON 格式错误'));
                  }
                },
              },
            ]}
          >
            <Input.TextArea rows={6} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder='{"style":"...","method":"...","intensity":"..."}' />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
