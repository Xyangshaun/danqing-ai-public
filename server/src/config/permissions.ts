// ============================================================
// 丹青有AI - RBAC 权限矩阵定义
// 对应文档:
//   - .trae/documents/auth-design.md §2.4(多租户 JWT 处理)
//   - .trae/documents/data-model-v1.md(User/Tenant/TenantMember 表结构)
//   - .trae/documents/api-contract-v1.md(接口规范 + 错误码)
//
// 设计原则:
//   1. 角色(UserRole):admin / teacher / student / owner
//      - admin:租户管理员(学校/学院级),拥有全部权限
//      - owner:个人租户所有者,等同 admin(见 schema.prisma UserRole 注释)
//      - teacher:教师(学院/班级级),可管理租户内分析 + 邀请成员
//      - student:学生(班级/个人),仅可操作自己的资源
//   2. 权限(Permission):细粒度操作标识,格式 `资源:动作:范围`
//      - :own  表示仅操作自己创建的资源
//      - :tenant 表示可操作租户内所有资源
//   3. 数据范围过滤:在 service 层根据角色动态构建查询条件
//      - student 强制 WHERE user_id = ?(只能看自己的)
//      - teacher/admin 不加 user_id 过滤(可见租户全量)
// ============================================================

import type { UserRole } from '../types/api-contract.js';

// ============================================================
// 权限定义(细粒度操作标识)
// ============================================================

/**
 * 系统所有权限的联合类型
 * 命名规范:`资源:动作[:范围]`
 *  - 范围 `own` = 仅自己的资源
 *  - 范围 `tenant` = 租户内任意资源
 */
export type Permission =
  | 'analysis:create' // 提交分析任务
  | 'analysis:read:own' // 查看自己的分析
  | 'analysis:read:tenant' // 查看租户内所有分析
  | 'analysis:delete:own' // 删除自己的分析
  | 'analysis:delete:tenant' // 删除租户内任何分析
  | 'user:read' // 查看租户内用户信息(成员列表)
  | 'user:update:own' // 更新自己的资料
  | 'user:update:tenant' // 更新租户内用户资料(改角色等)
  | 'user:invite' // 邀请用户加入租户
  | 'user:remove' // 移除租户成员
  | 'tenant:read' // 查看租户信息
  | 'tenant:update' // 更新租户设置(名称/配额等)
  | 'tenant:switch' // 切换当前激活租户
  | 'artwork:read' // 查看艺术品知识库
  | 'stats:read' // 查看个人统计数据
  | 'stats:read:tenant' // 查看租户统计数据
  | 'subscription:read' // 查看当前租户订阅信息与发票
  | 'subscription:update' // 升级/取消订阅(仅 admin/owner)
  // 管理后台权限(Phase 4,仅 admin/owner 拥有)
  | 'admin:user:read' // 查看用户列表/详情
  | 'admin:user:write' // 更新/删除/锁定/批量操作用户
  | 'admin:user:export' // 导出用户 CSV
  | 'admin:role:read' // 查看角色权限矩阵
  | 'admin:role:write' // 更新角色权限
  | 'admin:artwork:read' // 查看作品列表/详情
  | 'admin:artwork:write' // 审核/删除作品
  | 'admin:template:read' // 查看创意模板
  | 'admin:template:write' // 创建/更新/删除模板
  | 'admin:subscription:read' // 查看订阅/发票列表
  | 'admin:subscription:write' // 取消订阅/退款
  | 'admin:plan:read' // 查看套餐列表
  | 'admin:plan:write' // 创建/更新套餐
  | 'admin:stats:read' // 查看数据看板
  | 'admin:tenant:read' // 查看租户列表
  | 'admin:tenant:write' // 创建/更新租户
  | 'admin:audit:read' // 查看审计日志
  | 'admin:apikey:read' // 查看 API 密钥列表
  | 'admin:apikey:write' // 生成/吊销 API 密钥
  | 'admin:system:health' // 系统健康检查
  // Phase 5 预留接口权限(知识库/模块/UI 配置/功能参数)
  | 'knowledge:read' // 知识库检索(所有角色)
  | 'knowledge:write' // 知识条目 CRUD(ADMIN/OWNER)
  | 'knowledge:index:manage' // 重建索引(ADMIN)
  | 'modules:read' // 查看已安装/可用模块(所有角色)
  | 'modules:manage' // 安装/卸载/启用/禁用/配置模块(ADMIN/OWNER)
  | 'ui:config:read' // 查看主题/布局/组件配置(所有角色)
  | 'ui:config:write' // 更新主题/布局/组件配置(ADMIN/OWNER)
  | 'config:features:read' // 查看功能开关(所有角色)
  | 'config:features:write' // 更新功能开关(ADMIN/OWNER)
  | 'config:workflows:manage' // 工作流定义与执行(ADMIN/OWNER)
  // Phase 5 新功能权限(评分预设/评委评审/争议仲裁)
  | 'preset:read' // 查看可用预设(所有角色)
  | 'preset:write' // 创建/fork/更新/删除预设(TEACHER/ADMIN/OWNER)
  | 'review:read' // 查看评审记录(租户内所有角色)
  | 'review:write' // 提交评审(TEACHER/ADMIN/OWNER)
  | 'dispute:read' // 查看争议案件(租户内所有角色)
  | 'dispute:request' // 申请人工复核(STUDENT 为自己的作品发起;ADMIN/OWNER 全权)
  | 'dispute:resolve' // 裁定争议(TEACHER/ADMIN/OWNER)
  | 'admin:invitation:write' // 创建邀请码/批量导入学生(ADMIN/OWNER)
  | 'admin:preset:read' // 管理后台查看所有预设(ADMIN/OWNER)
  | 'admin:preset:write' // 管理后台派生覆盖预设(ADMIN/OWNER)
  // 实时图片搜索权限(P0,详见 docs/realtime-image-search-solution.md)
  | 'image:read' // 图片搜索与详情查看(所有角色)
  | 'image:create' // 创建图片条目(ADMIN/OWNER)
  | 'image:update' // 更新图片条目(ADMIN/OWNER)
  | 'image:delete' // 删除图片条目(ADMIN/OWNER)
  // 组织内分享权限(报告导出+组织分享特性)
  | 'share:create' // 分享/取消分享自己的作品 + 发表评论(所有角色)
  | 'share:manage' // 置顶/取消置顶 + 删除他人分享/评论(TEACHER/ADMIN/OWNER)
  // 投诉举报权限(公安备案合规)
  | 'admin:report:read' // 查看举报分页列表(ADMIN/OWNER,本期仅只读)
  // 双阶段反馈框架 Phase 2 评分档案(详见 docs/visual-annotation-feedback-upgrade-spec-2026-09.md §4)
  | 'grading-profile:read' // 查看评分档案(TEACHER/ADMIN/OWNER;学生端不消费档案)
  | 'grading-profile:write' // 创建/fork/更新/删除/设默认档案(TEACHER/ADMIN/OWNER)
  // 参考图混合方案 Phase 3 知识点卡片(spec §5;学生经分析结果间接消费,不开放直查)
  | 'knowledge-card:read'; // 卡片列表/详情(TEACHER/ADMIN/OWNER)

/**
 * 权限全集(用于 ADMIN/OWNER 全权角色)
 * 维护时新增权限需同步追加到此数组
 */
export const ALL_PERMISSIONS: readonly Permission[] = [
  'analysis:create',
  'analysis:read:own',
  'analysis:read:tenant',
  'analysis:delete:own',
  'analysis:delete:tenant',
  'user:read',
  'user:update:own',
  'user:update:tenant',
  'user:invite',
  'user:remove',
  'tenant:read',
  'tenant:update',
  'tenant:switch',
  'artwork:read',
  'stats:read',
  'stats:read:tenant',
  'subscription:read',
  'subscription:update',
  // 管理后台权限(Phase 4)
  'admin:user:read',
  'admin:user:write',
  'admin:user:export',
  'admin:role:read',
  'admin:role:write',
  'admin:artwork:read',
  'admin:artwork:write',
  'admin:template:read',
  'admin:template:write',
  'admin:subscription:read',
  'admin:subscription:write',
  'admin:plan:read',
  'admin:plan:write',
  'admin:stats:read',
  'admin:tenant:read',
  'admin:tenant:write',
  'admin:audit:read',
  'admin:apikey:read',
  'admin:apikey:write',
  'admin:system:health',
  // Phase 5 预留接口权限
  'knowledge:read',
  'knowledge:write',
  'knowledge:index:manage',
  'modules:read',
  'modules:manage',
  'ui:config:read',
  'ui:config:write',
  'config:features:read',
  'config:features:write',
  'config:workflows:manage',
  // Phase 5 新功能权限
  'preset:read',
  'preset:write',
  'review:read',
  'review:write',
  'dispute:read',
  'dispute:request',
  'dispute:resolve',
  'admin:invitation:write',
  'admin:preset:read',
  'admin:preset:write',
  // 实时图片搜索权限(P0)
  'image:read',
  'image:create',
  'image:update',
  'image:delete',
  // 组织内分享权限
  'share:create',
  'share:manage',
  // 投诉举报权限(公安备案合规,ADMIN/OWNER)
  'admin:report:read',
  // 双阶段反馈框架 Phase 2 评分档案
  'grading-profile:read',
  'grading-profile:write',
  // 参考图混合方案 Phase 3 知识点卡片
  'knowledge-card:read',
];

// ============================================================
// 角色 → 权限映射矩阵
// ============================================================

/**
 * RBAC 权限矩阵(角色 → 权限列表)
 *
 * 权限矩阵表:
 * | 权限                       | ADMIN | OWNER | TEACHER | STUDENT |
 * |----------------------------|:-----:|:-----:|:-------:|:-------:|
 * | analysis:create            |  Y    |  Y    |   Y     |   Y     |
 * | analysis:read:own          |  Y    |  Y    |   Y     |   Y     |
 * | analysis:read:tenant       |  Y    |  Y    |   Y     |   N     |
 * | analysis:delete:own        |  Y    |  Y    |   Y     |   Y     |
 * | analysis:delete:tenant     |  Y    |  Y    |   N     |   N     |
 * | user:read                  |  Y    |  Y    |   Y     |   N     |
 * | user:update:own            |  Y    |  Y    |   Y     |   Y     |
 * | user:update:tenant         |  Y    |  Y    |   N     |   N     |
 * | user:invite                |  Y    |  Y    |   Y     |   N     |
 * | user:remove                |  Y    |  Y    |   N     |   N     |
 * | tenant:read                |  Y    |  Y    |   Y     |   Y     |
 * | tenant:update              |  Y    |  Y    |   N     |   N     |
 * | tenant:switch              |  Y    |  Y    |   Y     |   Y     |
 * | artwork:read               |  Y    |  Y    |   Y     |   Y     |
 * | stats:read                 |  Y    |  Y    |   Y     |   Y     |
 * | stats:read:tenant          |  Y    |  Y    |   Y     |   N     |
 * | subscription:read          |  Y    |  Y    |   Y     |   Y     |
 * | subscription:update        |  Y    |  Y    |   N     |   N     |
 * | knowledge:read             |  Y    |  Y    |   Y     |   Y     | (Phase 5 预留)
 * | knowledge:write            |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 * | knowledge:index:manage     |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 * | modules:read               |  Y    |  Y    |   Y     |   Y     | (Phase 5 预留)
 * | modules:manage             |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 * | ui:config:read             |  Y    |  Y    |   Y     |   Y     | (Phase 5 预留)
 * | ui:config:write            |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 * | config:features:read       |  Y    |  Y    |   Y     |   Y     | (Phase 5 预留)
 * | config:features:write      |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 * | config:workflows:manage    |  Y    |  Y    |   N     |   N     | (Phase 5 预留)
 *
 * 说明:
 *  - ADMIN/OWNER:全权限(OWNER 等同 ADMIN,见 schema.prisma UserRole.owner 注释)
 *  - TEACHER:可管理租户内分析(读全量/删自己)、邀请成员、查看租户统计,
 *            但不可移除成员、不可改租户设置、不可删他人分析
 *  - STUDENT:仅可操作自己的资源 + 查看艺术品库 + 个人统计
 *  - Phase 5 预留接口:读类权限(knowledge:read / modules:read / ui:config:read /
 *            config:features:read)对所有角色开放;写/管理类仅 ADMIN/OWNER
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = Object.freeze({
  // 管理员:全部权限
  admin: ALL_PERMISSIONS,
  // 所有者:等同 admin(个人租户场景)
  owner: ALL_PERMISSIONS,
  // 教师:租户内分析只读 + 自删 + 邀请 + 租户统计 + 订阅只读 + Phase 5 预留读类权限
  teacher: Object.freeze<Permission[]>([
    'analysis:create',
    'analysis:read:own',
    'analysis:read:tenant',
    'analysis:delete:own',
    'user:read',
    'user:update:own',
    'user:invite',
    'tenant:read',
    'tenant:switch',
    'artwork:read',
    'stats:read',
    'stats:read:tenant',
    'subscription:read',
    // Phase 5 预留接口读类权限
    'knowledge:read',
    'modules:read',
    'ui:config:read',
    'config:features:read',
    // Phase 5 新功能权限:教师可读写预设/评审/争议
    'preset:read',
    'preset:write',
    'review:read',
    'review:write',
    'dispute:read',
    'dispute:resolve',
    // 实时图片搜索:教师可读
    'image:read',
    // 组织内分享:教师可分享 + 管理(置顶/删他人)
    'share:create',
    'share:manage',
    // 双阶段反馈框架 Phase 2:教师可读写评分档案
    'grading-profile:read',
    'grading-profile:write',
    // 参考图混合方案 Phase 3:教师可查知识点卡片(学生经分析结果间接消费)
    'knowledge-card:read',
  ]),
  // 学生:仅自己的资源 + 个人统计 + 订阅只读 + Phase 5 预留读类权限
  student: Object.freeze<Permission[]>([
    'analysis:create',
    'analysis:read:own',
    'analysis:delete:own',
    'user:update:own',
    'tenant:read',
    'tenant:switch',
    'artwork:read',
    'stats:read',
    'subscription:read',
    // Phase 5 预留接口读类权限
    'knowledge:read',
    'modules:read',
    'ui:config:read',
    'config:features:read',
    // Phase 5 新功能权限:学生可读预设/评审/争议,并可为自己的作品申请人工复核
    'preset:read',
    'review:read',
    'dispute:read',
    'dispute:request',
    // 实时图片搜索:学生可读(服务端强制 status=published)
    'image:read',
    // 组织内分享:学生可分享自己的作品 + 发表评论
    'share:create',
  ]),
});

// ============================================================
// 权限查询工具函数
// ============================================================

/**
 * 判断某角色是否拥有指定权限
 * @param role 用户角色
 * @param permission 权限标识
 * @returns true 拥有;false 不拥有
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

/**
 * 判断某角色是否拥有给定权限中的任意一个(OR 语义)
 * @param role 用户角色
 * @param permissions 权限列表
 * @returns true 拥有任意一个;false 全不拥有
 */
export function hasAnyPermission(role: UserRole, permissions: readonly Permission[]): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms || permissions.length === 0) return false;
  return permissions.some((p) => perms.includes(p));
}

/**
 * 判断某角色是否拥有给定权限中的全部(AND 语义)
 * @param role 用户角色
 * @param permissions 权限列表
 * @returns true 全部拥有;false 至少缺一个
 */
export function hasAllPermissions(role: UserRole, permissions: readonly Permission[]): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms || permissions.length === 0) return false;
  return permissions.every((p) => perms.includes(p));
}

/**
 * 获取某角色的全部权限列表(只读副本)
 */
export function getPermissionsByRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * 判断角色是否为"租户全量可见"(teacher / admin / owner)
 * 用于 analysis.service 数据范围过滤
 * @param role 用户角色
 * @returns true 表示可看租户全量;false 表示仅可看自己
 */
export function canReadTenantWide(role: UserRole): boolean {
  return role === 'admin' || role === 'owner' || role === 'teacher';
}

/**
 * 判断角色是否可删除租户内任意分析(仅 admin / owner)
 */
export function canDeleteTenantWide(role: UserRole): boolean {
  return role === 'admin' || role === 'owner';
}

/**
 * 判断角色是否为管理后台管理员(仅 admin / owner)
 * 用于 /api/admin/* 路由的入口校验
 */
export function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'owner';
}

/**
 * 管理后台权限分组(便于按模块快速校验)
 * 用于 requireAdminPermission 中间件
 */
export const ADMIN_PERMISSION_GROUPS = {
  user: ['admin:user:read', 'admin:user:write', 'admin:user:export'] as const,
  role: ['admin:role:read', 'admin:role:write'] as const,
  artwork: ['admin:artwork:read', 'admin:artwork:write'] as const,
  template: ['admin:template:read', 'admin:template:write'] as const,
  subscription: ['admin:subscription:read', 'admin:subscription:write'] as const,
  plan: ['admin:plan:read', 'admin:plan:write'] as const,
  stats: ['admin:stats:read'] as const,
  tenant: ['admin:tenant:read', 'admin:tenant:write'] as const,
  audit: ['admin:audit:read'] as const,
  apikey: ['admin:apikey:read', 'admin:apikey:write'] as const,
  system: ['admin:system:health'] as const,
} as const;
