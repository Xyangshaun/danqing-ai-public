// ============================================================
// 内容管理 - 作品库
// - 缩略图 + 标题 + 作者 + 审核状态
// - 审核(通过/拒绝/标记)+ 删除(物理删除,二次确认)
// - 批量删除、标记违规
// ============================================================

import { useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable, PageContainer } from '@ant-design/pro-components';
import { Image, Tag, Button, Space, App, Modal, Input } from 'antd';
import { CheckOutlined, CloseOutlined, FlagOutlined, DeleteOutlined } from '@ant-design/icons';
import type { AdminArtworkListItem, ArtType, AnalysisStatus, ReviewStatus } from '@/types/api';
import { listArtworks, reviewArtwork, deleteArtwork } from '@/services/content';
import { useConfirmAction } from '@/components/ConfirmAction';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { PERM, ART_TYPE_LABEL, ANALYSIS_STATUS_LABEL, ANALYSIS_STATUS_COLOR, REVIEW_STATUS_LABEL, REVIEW_STATUS_COLOR, REVIEW_ACTION_LABEL, ART_TYPE_OPTIONS, ANALYSIS_STATUS_OPTIONS, REVIEW_STATUS_OPTIONS, BATCH_LIMIT } from '@/constants';
import { formatDateTime } from '@/utils/format';

export default function ArtworksPage() {
  const tableRef = useRef<ActionType>();
  const { message } = App.useApp();
  const { confirm } = useConfirmAction();
  // 二级只读管理员:隐藏审核/删除写操作入口
  const readonly = useReadonlyAdmin();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState<{ id: string; action: 'approve' | 'reject' | 'flag' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const onReview = (id: string, action: 'approve' | 'reject' | 'flag') => {
    setReviewNote('');
    setReviewOpen({ id, action });
  };

  const submitReview = async () => {
    if (!reviewOpen) return;
    await reviewArtwork(reviewOpen.id, { action: reviewOpen.action, note: reviewNote || undefined });
    message.success(`已${REVIEW_ACTION_LABEL[reviewOpen.action]}`);
    setReviewOpen(null);
    tableRef.current?.reload();
  };

  const onDelete = (record: AdminArtworkListItem) => {
    confirm(
      {
        title: '删除作品',
        content: `确认物理删除作品「${record.title ?? '无标题'}」?此操作不可恢复。`,
        okText: '删除',
        danger: true,
        requireText: '删除',
      },
      () => deleteArtwork(record.id),
    ).then(() => tableRef.current?.reload());
  };

  const columns: ProColumns<AdminArtworkListItem>[] = [
    {
      title: '作品',
      dataIndex: 'imageUrl',
      width: 90,
      hideInSearch: true,
      render: (_, r) => (
        <Image
          src={r.imageUrl}
          width={56}
          height={56}
          style={{ objectFit: 'cover', borderRadius: 4 }}
          preview={{ mask: '预览' }}
        />
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 180,
      ellipsis: true,
      fieldProps: { placeholder: '搜索标题' },
      render: (_, r) => r.title ?? <span style={{ color: '#bfb8a8' }}>无标题</span>,
    },
    {
      title: '作者',
      dataIndex: 'userName',
      width: 100,
      hideInSearch: true,
    },
    {
      title: '类型',
      dataIndex: 'workType',
      width: 90,
      valueType: 'select',
      fieldProps: { options: ART_TYPE_OPTIONS, allowClear: true },
      render: (_, r) => <Tag>{ART_TYPE_LABEL[r.workType]}</Tag>,
    },
    {
      title: '分析状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      fieldProps: { options: ANALYSIS_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => <Tag color={ANALYSIS_STATUS_COLOR[r.status]}>{ANALYSIS_STATUS_LABEL[r.status]}</Tag>,
    },
    {
      title: '审核状态',
      dataIndex: 'reviewStatus',
      width: 100,
      valueType: 'select',
      fieldProps: { options: REVIEW_STATUS_OPTIONS, allowClear: true },
      render: (_, r) => (
        <span>
          <span className="dq-status-dot" style={{ background: REVIEW_STATUS_COLOR[r.reviewStatus] === 'success' ? '#3e7d5a' : REVIEW_STATUS_COLOR[r.reviewStatus] === 'error' ? '#c8392e' : REVIEW_STATUS_COLOR[r.reviewStatus] === 'warning' ? '#c9a961' : '#bfb8a8' }} />
          <Tag color={REVIEW_STATUS_COLOR[r.reviewStatus]}>{REVIEW_STATUS_LABEL[r.reviewStatus]}</Tag>
        </span>
      ),
    },
    {
      title: '评分',
      dataIndex: 'overallScore',
      width: 80,
      hideInSearch: true,
      sorter: true,
      render: (_, r) => (r.overallScore != null ? <b style={{ color: '#c9a961' }}>{r.overallScore}</b> : '-'),
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
      width: 220,
      fixed: 'right',
      render: (_, r) => [
        !readonly && (
          <Access key="approve" permission={PERM.artworkWrite}>
            <a onClick={() => onReview(r.id, 'approve')} style={{ color: '#3e7d5a' }}>
              <CheckOutlined /> 通过
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="reject" permission={PERM.artworkWrite}>
            <a onClick={() => onReview(r.id, 'reject')} style={{ color: '#c8392e' }}>
              <CloseOutlined /> 拒绝
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="flag" permission={PERM.artworkWrite}>
            <a onClick={() => onReview(r.id, 'flag')} style={{ color: '#c9a961' }}>
              <FlagOutlined /> 标记
            </a>
          </Access>
        ),
        !readonly && (
          <Access key="delete" permission={PERM.artworkWrite}>
            <a onClick={() => onDelete(r)} style={{ color: '#c8392e' }}>
              <DeleteOutlined /> 删除
            </a>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '作品库', ghost: true }}>
      <ReadonlyAlert />
      <ProTable<AdminArtworkListItem>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1300 }}
        size="small"
        search={{ labelWidth: 70, defaultCollapsed: false }}
        options={{ density: true, fullScreen: true, reload: true, setting: true }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          const { current, pageSize, createdAt, ...rest } = params;
          const res = await listArtworks({
            page: current,
            pageSize,
            search: rest.title as string | undefined,
            workType: rest.workType as ArtType | undefined,
            status: rest.status as AnalysisStatus | undefined,
            reviewStatus: rest.reviewStatus as ReviewStatus | undefined,
            startDate: createdAt?.[0],
            endDate: createdAt?.[1],
          });
          return { data: res.items, total: res.total, success: true };
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as string[]),
        }}
        tableAlertOptionRender={() => (
          <Space size={12}>
            <span>已选 {selectedKeys.length} 项</span>
            {!readonly && (
              <Access permission={PERM.artworkWrite}>
                <Button
                  size="small"
                  danger
                  disabled={selectedKeys.length === 0 || selectedKeys.length > BATCH_LIMIT}
                  onClick={() => {
                    confirm(
                      {
                        title: '批量删除作品',
                        content: `将删除 ${selectedKeys.length} 个作品,不可恢复。`,
                        okText: '删除',
                        danger: true,
                        requireText: '删除',
                      },
                      async () => {
                        // 逐条删除(后端无批量删除接口)
                        let ok = 0;
                        for (const id of selectedKeys) {
                          try {
                            await deleteArtwork(id);
                            ok++;
                          } catch {
                            /* 继续下一条 */
                          }
                        }
                        message.success(`已删除 ${ok}/${selectedKeys.length}`);
                        setSelectedKeys([]);
                        tableRef.current?.reload();
                        return { ok };
                      },
                    );
                  }}
                >
                  批量删除
                </Button>
              </Access>
            )}
          </Space>
        )}
      />

      <Modal
        title={reviewOpen ? `${REVIEW_ACTION_LABEL[reviewOpen.action]}作品` : ''}
        open={!!reviewOpen}
        onOk={submitReview}
        onCancel={() => setReviewOpen(null)}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, color: '#6b6b6b', fontSize: 13 }}>
          审核{reviewOpen && REVIEW_ACTION_LABEL[reviewOpen.action]}备注(可选):
        </div>
        <Input.TextArea
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          rows={3}
          placeholder="填写审核备注,将记录到审计日志"
          maxLength={200}
          showCount
        />
      </Modal>
    </PageContainer>
  );
}
