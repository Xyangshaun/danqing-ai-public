// ============================================================
// 开发者视图 Repository(平台级诊断只读查询)
// 对应 API:
//   GET /api/admin/dev/accounts     账号清单(含在线状态)
//   GET /api/admin/dev/deployments  部署历史
//
// 设计说明:
//   - 平台级跨租户视图:accounts 面向全部用户(开发者诊断用途),
//     权限由路由层 requirePermission 限定 ADMIN/OWNER
//   - deployment_logs 为系统级日志(不含 tenant_id,见 schema 注释),天然跨租户
//   - 所有查询走 Prisma 参数化,杜绝 SQL 注入
// ============================================================

import { prisma } from '../config/prisma.js';

export class DevViewRepository {
  /**
   * 查询全部用户(含所属租户名称)
   * 仅 select 诊断所需字段,不取 passwordHash 等敏感列
   */
  async listAllUsersWithTenant() {
    return prisma().user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        authType: true,
        status: true,
        tenantId: true,
        tenant: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 按用户统计在线会话数
   * 在线判定:存在 expiresAt > now 且 revokedAt 为 null 的会话
   */
  async countActiveSessionsByUser(now: Date) {
    return prisma().session.groupBy({
      by: ['userId'],
      where: { expiresAt: { gt: now }, revokedAt: null },
      _count: { _all: true },
    });
  }

  /**
   * 按用户取最新会话创建时间(全部会话,不限在线状态)
   * 无会话的用户不会出现在结果中(由 service 补 null)
   */
  async latestSessionAtByUser() {
    return prisma().session.groupBy({
      by: ['userId'],
      _max: { createdAt: true },
    });
  }

  /**
   * 查询部署日志(按 timestamp 倒序,最新在前)
   * @param limit 返回条数(调用方已校验 1-100)
   */
  async listDeploymentLogs(limit: number) {
    return prisma().deploymentLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}

export const devViewRepository = new DevViewRepository();
