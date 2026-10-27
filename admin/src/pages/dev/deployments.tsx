// ============================================================
// 开发者视图 - 版本部署
// - 顶部卡片:最近一次部署(版本号/状态/时间/部署人/分支/commit)
// - 下方表格:部署历史(失败原因红字,details JSON 展开)
// - 每 60s 轮询
// ============================================================

import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Tag, Alert, Table, Descriptions, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getDevDeployments } from '@/services/dev';
import type { DevDeploymentItem } from '@/services/dev';
import { formatDateTime } from '@/utils/format';

/** 轮询间隔(60s) */
const POLL_INTERVAL = 60_000;
/** 历史记录条数上限 */
const DEPLOY_LIMIT = 20;

/** 部署状态 → Tag 配色(success 绿 / failed 红 / 其他默认) */
function statusTag(status: string) {
  if (status === 'success') return <Tag color="success">成功</Tag>;
  if (status === 'failed') return <Tag color="error">失败</Tag>;
  return <Tag>{status}</Tag>;
}

/** commitSha 短 hash 展示 */
function shortSha(sha: string | null | undefined): string {
  if (!sha) return '-';
  return sha.slice(0, 7);
}

export default function DevDeploymentsPage() {
  const deploymentsQ = useQuery({
    queryKey: ['dev', 'deployments', DEPLOY_LIMIT],
    queryFn: () => getDevDeployments(DEPLOY_LIMIT),
    refetchInterval: POLL_INTERVAL,
  });

  const latest = deploymentsQ.data?.latest ?? null;
  const deployments = deploymentsQ.data?.deployments ?? [];

  return (
    <PageContainer header={{ title: '版本部署', ghost: true }}>
      {deploymentsQ.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="版本部署数据获取失败"
          description="请稍后重试,或检查后端 /api/admin/dev/deployments 服务是否可用。"
        />
      ) : null}

      {/* 当前线上版本(最近一次部署) */}
      <ProCard title="当前线上版本" style={{ marginBottom: 16 }} bodyStyle={{ paddingTop: 12 }}>
        {!latest ? (
          <Empty description={deploymentsQ.isLoading ? '加载中...' : '暂无部署记录'} />
        ) : (
          <Descriptions column={{ xs: 1, md: 3 }} size="small">
            <Descriptions.Item label="版本号">
              <b style={{ fontSize: 18 }}>{latest.version}</b>
            </Descriptions.Item>
            <Descriptions.Item label="状态">{statusTag(latest.status)}</Descriptions.Item>
            <Descriptions.Item label="部署时间">
              {formatDateTime(latest.timestamp)}
            </Descriptions.Item>
            <Descriptions.Item label="部署人">{latest.deployer || '-'}</Descriptions.Item>
            <Descriptions.Item label="分支">
              <Tag color="blue">{latest.branch || '-'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Commit">
              <code style={{ background: '#f5f0e3', padding: '2px 6px', borderRadius: 3 }}>
                {shortSha(latest.commitSha)}
              </code>
            </Descriptions.Item>
          </Descriptions>
        )}
      </ProCard>

      {/* 部署历史 */}
      <ProCard
        title="部署历史"
        extra={
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            每 {POLL_INTERVAL / 1000}s 自动刷新
          </span>
        }
      >
        <Table<DevDeploymentItem>
          rowKey="id"
          size="small"
          loading={deploymentsQ.isLoading}
          dataSource={deployments}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          expandable={{
            rowExpandable: (r) => !!r.details || !!r.errorMessage,
            expandedRowRender: (r) => (
              <div style={{ padding: '4px 0' }}>
                {r.errorMessage ? (
                  <div style={{ color: '#c8392e', marginBottom: 8, fontSize: 13 }}>
                    失败原因:{r.errorMessage}
                  </div>
                ) : null}
                <pre
                  style={{
                    background: '#f5f0e3',
                    padding: 12,
                    borderRadius: 4,
                    fontSize: 12,
                    margin: 0,
                    maxHeight: 260,
                    overflow: 'auto',
                  }}
                >
                  {r.details ? JSON.stringify(r.details, null, 2) : '无详情'}
                </pre>
              </div>
            ),
          }}
          columns={[
            {
              title: '时间',
              dataIndex: 'timestamp',
              width: 170,
              render: (_, r) => formatDateTime(r.timestamp),
            },
            {
              title: '版本',
              dataIndex: 'version',
              width: 130,
              render: (_, r) => <b>{r.version}</b>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              filters: [
                { text: '成功', value: 'success' },
                { text: '失败', value: 'failed' },
              ],
              onFilter: (value, record) => record.status === value,
              render: (_, r) => statusTag(r.status),
            },
            { title: '部署人', dataIndex: 'deployer', width: 110 },
            {
              title: '分支',
              dataIndex: 'branch',
              width: 120,
              ellipsis: true,
              render: (_, r) => <Tag>{r.branch || '-'}</Tag>,
            },
            {
              title: 'Commit',
              dataIndex: 'commitSha',
              width: 100,
              render: (_, r) => <code style={{ fontSize: 12 }}>{shortSha(r.commitSha)}</code>,
            },
            {
              title: '来源 IP',
              dataIndex: 'sourceIp',
              width: 130,
              render: (_, r) => r.sourceIp ?? <span style={{ color: '#bfb8a8' }}>-</span>,
            },
            {
              title: '失败原因',
              dataIndex: 'errorMessage',
              ellipsis: true,
              render: (_, r) =>
                r.errorMessage ? (
                  <span style={{ color: '#c8392e' }}>{r.errorMessage}</span>
                ) : (
                  <span style={{ color: '#bfb8a8' }}>-</span>
                ),
            },
          ]}
        />
      </ProCard>
    </PageContainer>
  );
}
