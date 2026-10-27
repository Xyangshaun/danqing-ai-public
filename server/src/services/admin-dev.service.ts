// ============================================================
// 开发者视图 Service(平台级诊断只读聚合)
// 对应 API:
//   GET /api/admin/dev/accounts     账号清单(含在线状态 / 测试账号标记,条目含 presenceState 三态 M-4)
//   GET /api/admin/dev/deployments  部署历史(按时间倒序)
//
// 职责:
//   1. 组合 user / tenant / session 数据,计算在线状态与最后活跃时间
//   2. 按规则判定测试账号(isTestAccount)
//   3. 汇总 summary(total / online / byRole)
//
// 权限:admin:user:read / admin:stats:read(由路由层 requirePermission 强制)
// 注意:平台级跨租户只读视图,不做任何写操作,无需审计日志
// ============================================================

import type { AuthType, DeploymentLog, UserRole, UserStatus } from '@prisma/client';
import type { PresenceState } from '../types/api-contract.js';
import { devViewRepository } from '../repositories/dev-view.repository.js';
import { presenceService } from './presence.service.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 响应类型(与 API 契约对齐;字段与 Prisma 模型一一对应)
// ============================================================

/** 账号清单条目 */
export interface DevAccountEntry {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
  authType: AuthType;
  status: UserStatus;
  tenantId: string;
  tenantName: string;
  /** 是否存在未过期且未撤销的会话 */
  isOnline: boolean;
  /** 在线会话数(expiresAt > now 且 revokedAt 为 null) */
  activeSessions: number;
  /** 最新会话创建时间(无会话则为 null) */
  lastActiveAt: Date | null;
  /** 测试/预置账号标记(判定规则见 isTestAccountEmail) */
  isTestAccount: boolean;
  /** 三态实时状态(M-4 追加):online=近5min活跃 / idle=会话有效不活跃 / offline=无有效会话 */
  presenceState: PresenceState;
}

/** GET /dev/accounts 响应 */
export interface DevAccountsResponse {
  accounts: DevAccountEntry[];
  summary: {
    total: number;
    online: number;
    byRole: Record<UserRole, number>;
  };
}

/** GET /dev/deployments 响应 */
export interface DevDeploymentsResponse {
  deployments: DeploymentLog[];
  /** 最新一条部署记录(无记录时为 null) */
  latest: DeploymentLog | null;
}

// ============================================================
// 测试账号判定规则(email 匹配其一即为测试账号;无 email 视为 dev-user)
// ============================================================

/** 精确匹配的预置/种子账号邮箱 */
const TEST_EMAILS: ReadonlySet<string> = new Set([
  'admin@dq.edu',
  'teacher@dq.edu',
  'subadmin@dq.edu',
  'enterprise@dq.edu',
]);

/** 模式匹配的测试邮箱 */
const TEST_EMAIL_PATTERNS: readonly RegExp[] = [
  /^test\d+@dq\.edu$/, // test1-5@dq.edu 等学生种子账号
  /@mock\.local$/, // mock 域账号
  /^loading-test-/, // 加载测试账号
  /imgdebug/, // 图片调试账号
];

/**
 * 判定是否为测试账号
 * @param email 用户邮箱(null 表示无邮箱的开发注入账号,如 dev-user)
 */
export function isTestAccountEmail(email: string | null): boolean {
  if (!email) return true; // 无 email:开发模式注入账号(DEV_SKIP_AUTH)
  if (TEST_EMAILS.has(email)) return true;
  return TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
}

// ============================================================
// Service 实现
// ============================================================

class AdminDevService {
  /**
   * 账号清单:全部用户 + 租户名称 + 会话在线状态
   * 会话聚合经两次 groupBy(在线数 / 最新时间),避免 N+1 查询
   */
  async getDevAccounts(): Promise<DevAccountsResponse> {
    const now = new Date();
    const [users, activeGroups, latestGroups] = await Promise.all([
      devViewRepository.listAllUsersWithTenant(),
      devViewRepository.countActiveSessionsByUser(now),
      devViewRepository.latestSessionAtByUser(),
    ]);

    // userId → 在线会话数
    const activeCountMap = new Map<string, number>(
      activeGroups.map((g) => [g.userId, g._count._all]),
    );
    // userId → 最新会话创建时间
    const lastActiveMap = new Map<string, Date | null>(
      latestGroups.map((g) => [g.userId, g._max.createdAt]),
    );

    // M-4 追加:批量查询三态实时状态
    // getBatch 内部已做批量 MGET + 单次 SQL 聚合(无 N+1),且 Redis 故障自动降级 DB 派生
    // 此处 try/catch 兜底:presence 整体异常时 presenceMap 保持 null,降级为 isOnline 二态派生,
    // 保证端点不因 presence 异常而 5xx
    let presenceMap: Map<string, PresenceState> | null = null;
    try {
      const batch = await presenceService.getBatch(users.map((u) => u.id));
      presenceMap = new Map(batch.items.map((item) => [item.userId, item.state]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, '[admin-dev] presence getBatch failed, fallback to isOnline-derived state');
    }

    const summary = {
      total: users.length,
      online: 0,
      byRole: { admin: 0, teacher: 0, student: 0, owner: 0 } as Record<UserRole, number>,
    };

    const accounts: DevAccountEntry[] = users.map((u) => {
      const activeSessions = activeCountMap.get(u.id) ?? 0;
      const isOnline = activeSessions > 0;
      if (isOnline) summary.online += 1;
      summary.byRole[u.role] += 1;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        authType: u.authType,
        status: u.status,
        tenantId: u.tenantId,
        tenantName: u.tenant.name,
        isOnline,
        activeSessions,
        lastActiveAt: lastActiveMap.get(u.id) ?? null,
        isTestAccount: isTestAccountEmail(u.email),
        // 三态:正常路径取 presence 批量结果(查不到默认 offline);
        // presence 异常(presenceMap 为 null)降级为 isOnline 二态派生(isOnline→'idle',否则'offline')
        presenceState: presenceMap ? (presenceMap.get(u.id) ?? 'offline') : isOnline ? 'idle' : 'offline',
      };
    });

    return { accounts, summary };
  }

  /**
   * 部署历史:按 timestamp 倒序(最新在前)
   * @param limit 返回条数(controller 已校验 1-100,默认 20)
   */
  async getDevDeployments(limit: number): Promise<DevDeploymentsResponse> {
    const deployments = await devViewRepository.listDeploymentLogs(limit);
    return { deployments, latest: deployments[0] ?? null };
  }
}

export const adminDevService = new AdminDevService();
