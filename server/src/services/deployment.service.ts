// ============================================================
// 部署日志 Service(任务包 C:部署日志同步机制)
// 对应 API:
//   POST /deployments/log   接收部署完成/失败详情并落库
//   GET  /deployments/latest 查询最新部署状态(供下游任务)
//
// 职责:
//   1. 校验入参(controller 已做 Zod 校验,此处做类型落地)
//   2. 将部署详情写入 deployment_logs 表(共享数据库,格式一致)
//   3. 提供最新部署状态查询(clear success/failure indicator)
//
// 设计要点:
//   - 系统级日志,不含 tenant_id(类比 AuditLog,跨租户)
//   - 失败时仍返回成功响应(记录已落库),但通过 status/errorMessage 反映部署失败
//   - 落库失败(数据库不可用)才抛错,由 controller 转为显式同步失败
//   - 唯一约束:不强制唯一,允许同一版本多次部署(便于追溯)
// ============================================================

import { prisma } from '../config/prisma.js';
import type {
  CreateDeploymentLogRequest,
  DeploymentLogEntry,
  DeploymentStatus,
  LatestDeploymentStatusResponse,
} from '../types/api-contract.js';

/** DB 记录 → 对外契约条目 的映射器,保证字段命名/格式一致 */
function toEntry(record: {
  id: string;
  timestamp: Date;
  version: string;
  serverId: string;
  status: string;
  deployer: string | null;
  branch: string | null;
  commitSha: string | null;
  details: unknown;
  errorMessage: string | null;
  sourceIp: string | null;
  createdAt: Date;
}): DeploymentLogEntry {
  return {
    id: record.id,
    timestamp: record.timestamp.toISOString(),
    version: record.version,
    serverId: record.serverId,
    // 仅接受 success/failed,DB 层已由 controller Zod 校验保证
    status: record.status as DeploymentStatus,
    deployer: record.deployer,
    branch: record.branch,
    commitSha: record.commitSha,
    details: (record.details as Record<string, unknown> | null) ?? null,
    errorMessage: record.errorMessage,
    sourceIp: record.sourceIp,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * 记录一次部署结果(成功/失败均落库)
 * @param input 部署详情(controller 已校验)
 * @param sourceIp 上报来源 IP(审计)
 * @returns 落库后的日志条目
 */
async function recordDeployment(
  input: CreateDeploymentLogRequest,
  sourceIp: string,
): Promise<DeploymentLogEntry> {
  const record = await prisma().deploymentLog.create({
    data: {
      // timestamp:入参可选,缺省由数据库 now() 兜底
      timestamp: input.timestamp ? new Date(input.timestamp) : undefined,
      version: input.version,
      serverId: input.serverId,
      status: input.status,
      deployer: input.deployer ?? null,
      branch: input.branch ?? null,
      commitSha: input.commitSha ?? null,
      details: input.details ? (input.details as object) : undefined,
      errorMessage: input.errorMessage ?? null,
      sourceIp,
    },
  });
  return toEntry(record);
}

/**
 * 查询最新一次部署状态(下游任务可靠获取 success/failure 指示)
 * @param serverId 可选,按服务器过滤;缺省返回全局最新
 * @returns 最新部署状态;无记录时返回 null
 */
async function getLatestDeployment(
  serverId?: string,
): Promise<LatestDeploymentStatusResponse | null> {
  const record = await prisma().deploymentLog.findFirst({
    where: serverId ? { serverId } : undefined,
    orderBy: { timestamp: 'desc' },
  });
  if (!record) return null;
  const entry = toEntry(record);
  return {
    status: entry.status,
    version: entry.version,
    serverId: entry.serverId,
    timestamp: entry.timestamp,
    errorMessage: entry.errorMessage,
    log: entry,
  };
}

/** 部署日志服务单例(与 notificationService 等保持一致的导出约定) */
export const deploymentService = {
  recordDeployment,
  getLatestDeployment,
};