# RBAC 多租户权限体系验收报告

> 生成时间:2026-07-28
> 对应任务:实现 RBAC 权限矩阵 + 完善 /tenants/switch + 权限测试
> 验收状态:**通过**(typecheck 0 错误 / 428 测试全部通过)

---

## 一、交付物清单

| # | 文件 | 职责 | 状态 |
|---|------|------|------|
| 1 | [permissions.ts](src/config/permissions.ts) | RBAC 权限矩阵定义 + 工具函数 | 新增 |
| 2 | [permission.ts](src/middlewares/permission.ts) | 权限检查中间件(3 个工厂函数) | 新增 |
| 3 | [tenant.service.ts](src/services/tenant.service.ts) | 租户服务(switch/listMembers/inviteMember/removeMember) | 修改 |
| 4 | [tenant.controller.ts](src/controllers/tenant.controller.ts) | 租户控制器(成员管理 3 个接口) | 修改 |
| 5 | [tenant.repository.ts](src/repositories/tenant.repository.ts) | 租户仓储(createMembership/deleteMembership/listMembers) | 修改 |
| 6 | [tenant.routes.ts](src/routes/tenant.routes.ts) | 租户路由(6 个端点全部挂载权限中间件) | 修改 |
| 7 | [analysis.service.ts](src/services/analysis.service.ts) | 分析服务(数据范围过滤 + deleteAnalysis) | 修改 |
| 8 | [analysis.controller.ts](src/controllers/analysis.controller.ts) | 分析控制器(deleteAnalysis + getAnalysis 越权校验) | 修改 |
| 9 | [analysis.repository.ts](src/repositories/analysis.repository.ts) | 分析仓储(delete 方法 + tenant_id 强制过滤) | 修改 |
| 10 | [analysis.routes.ts](src/routes/analysis.routes.ts) | 分析路由(5 个端点全部挂载权限中间件) | 修改 |
| 11 | [api-contract.ts](src/types/api-contract.ts) | API 契约(DeleteAnalysisResponse / SwitchTenantResponse.role) | 修改 |
| 12 | [permission.test.ts](tests/permission.test.ts) | RBAC 权限测试(70 个用例) | 新增 |
| 13 | [prisma.mock.ts](tests/mocks/prisma.mock.ts) | Prisma Mock(支持 delete/include 关系解析) | 修改 |

---

## 二、权限矩阵

### 2.1 角色定义(UserRole)

| 角色 | 场景 | 权限范围 |
|------|------|----------|
| `admin` | 租户管理员(学校/学院级) | 全权限 |
| `owner` | 个人租户所有者 | 等同 admin |
| `teacher` | 教师(学院/班级级) | 租户内分析只读 + 自删 + 邀请成员 + 租户统计 |
| `student` | 学生(班级/个人) | 仅操作自己的资源 + 个人统计 |

### 2.2 权限矩阵表(16 项权限 × 4 角色)

| 权限 | ADMIN | OWNER | TEACHER | STUDENT |
|------|:-----:|:-----:|:-------:|:-------:|
| analysis:create | Y | Y | Y | Y |
| analysis:read:own | Y | Y | Y | Y |
| analysis:read:tenant | Y | Y | Y | N |
| analysis:delete:own | Y | Y | Y | Y |
| analysis:delete:tenant | Y | Y | N | N |
| user:read | Y | Y | Y | N |
| user:update:own | Y | Y | Y | Y |
| user:update:tenant | Y | Y | N | N |
| user:invite | Y | Y | Y | N |
| user:remove | Y | Y | N | N |
| tenant:read | Y | Y | Y | Y |
| tenant:update | Y | Y | N | N |
| tenant:switch | Y | Y | Y | Y |
| artwork:read | Y | Y | Y | Y |
| stats:read | Y | Y | Y | Y |
| stats:read:tenant | Y | Y | Y | N |

---

## 三、API 端点权限映射

### 3.1 分析资源(/analyses)

| 方法 | 路径 | 所需权限 | 数据范围过滤 |
|------|------|----------|--------------|
| POST | /analyses | `analysis:create` | 无(创建自己的) |
| POST | /analyses/upload | `analysis:create` | 无(创建自己的) |
| GET | /analyses | `analysis:read:own` \| `analysis:read:tenant` | student 强制 WHERE user_id=self |
| GET | /analyses/:id | `analysis:read:own` \| `analysis:read:tenant` | student 越权访问他人 → 404 |
| DELETE | /analyses/:id | `analysis:delete:own` \| `analysis:delete:tenant` | teacher/student 仅删自己;admin/owner 删任意 |

### 3.2 租户管理(/tenants)

| 方法 | 路径 | 所需权限 | 说明 |
|------|------|----------|------|
| GET | /tenants/current | `tenant:read` | 所有角色可访问 |
| POST | /tenants/switch | `tenant:switch` | 切换激活租户,重签 access_token |
| GET | /tenants | `tenant:read` | 列出用户所有租户成员关系 |
| GET | /tenants/:id/members | `user:read` | 仅 admin/teacher/owner |
| POST | /tenants/:id/members | `user:invite` | 仅 admin/teacher/owner |
| DELETE | /tenants/:id/members/:userId | `user:remove` | 仅 admin/owner |

---

## 四、数据范围过滤策略

### 4.1 分析记录(Analysis)

| 角色 | listAnalyses | getAnalysis | deleteAnalysis |
|------|--------------|-------------|----------------|
| student | WHERE user_id=self(强制) | 仅自己(越权→404) | 仅自己(越权→404) |
| teacher | 租户全量(可按 userId 筛选) | 租户全量 | 仅自己(越权→404) |
| admin | 租户全量 | 租户全量 | 租户全量 |
| owner | 租户全量 | 租户全量 | 租户全量 |

实现位置:
- [canReadTenantWide()](src/config/permissions.ts#L194-L196):判断角色是否可读租户全量
- [canDeleteTenantWide()](src/config/permissions.ts#L201-L203):判断角色是否可删租户全量
- [listAnalyses()](src/services/analysis.service.ts#L124-L167):effectiveUserId 过滤
- [getAnalysis()](src/services/analysis.service.ts#L180-L214):ownership 校验
- [deleteAnalysis()](src/services/analysis.service.ts#L232-L279):ownership 校验 + 审计日志

### 4.2 安全策略

1. **越权不泄露存在性**:student/teacher 越权访问他人记录统一返回 404(非 403),避免泄露资源存在
2. **tenant_id 强制过滤**:所有 repository 查询均带 tenantId 条件,防跨租户访问
3. **tenant_id 来自 JWT**:不信任客户端传入的 tenantId,强制从 `req.tenantId`(JWT payload)注入
4. **审计日志**:所有写操作(deleteAnalysis/inviteMember/removeMember)记录 operator + target + role

---

## 五、/tenants/switch 实现详情

### 5.1 流程(对应 auth-design.md §2.4)

```
POST /tenants/switch
  ├─ 1. 校验目标租户存在且 active(抛 3001/3002)
  ├─ 2. 校验用户属于该租户(查 TenantMember,抛 2004)
  ├─ 3. 获取用户在目标租户的 role(从 TenantMember.role)
  ├─ 4. 更新 User.tenantId + User.role(冗余字段同步)
  ├─ 5. 签发新 access_token(payload 含新 tenant_id + role)
  ├─ 6. refresh_token 不变(保持登录态)
  └─ 7. 返回 {accessToken, accessTokenExpiresAt, tenant, role}
```

### 5.2 响应结构(SwitchTenantResponse)

```typescript
interface SwitchTenantResponse {
  accessToken: string;
  accessTokenExpiresAt: string;  // ISO 8601
  tenant: TenantInfo;
  role: UserRole;                 // 新增:用户在新租户中的角色
}
```

### 5.3 安全保障

- 目标租户不存在 → 404 TENANT_NOT_FOUND(3001)
- 目标租户已禁用 → 403 TENANT_DISABLED(3002)
- 用户不属于目标租户 → 403 FORBIDDEN(2004)
- tenant_id 从 JWT 注入,不信任请求体

---

## 六、测试覆盖

### 6.1 测试统计

| 测试文件 | 用例数 | 状态 |
|----------|--------|------|
| permission.test.ts | 70 | 通过 |
| tenant-isolation.test.ts | 31 | 通过 |
| auth.controller.test.ts | 49 | 通过 |
| middlewares.test.ts | 22 | 通过 |
| 其他测试文件 | 256 | 通过 |
| **合计** | **428** | **全部通过** |

### 6.2 permission.test.ts 测试维度

| 维度 | 用例编号 | 覆盖内容 | 用例数 |
|------|----------|----------|--------|
| 权限矩阵单元 | P1-P6 | hasPermission/hasAnyPermission/hasAllPermissions × 4 角色 | 18 |
| 中间件单元 | P7-P11 | requirePermission/requireAnyPermission/requireAllPermissions(含默认拒绝/无角色) | 12 |
| Analysis API 集成 | P12-P17 | 创建/读/删 × 4 角色 + 跨租户隔离 | 15 |
| Tenant 成员管理集成 | P18-P22 | 列表/邀请/移除 × 4 角色权限边界 | 13 |
| 数据范围过滤 | P23-P25 | student/teacher/admin 视图差异 | 6 |
| 边界与安全 | P26-P28 | 默认拒绝/无角色/越权不泄露存在性 | 6 |

### 6.3 关键测试用例

- **P15**:student 删除他人记录 → 404(验证不泄露存在性)
- **P17**:admin 跨租户删除 → 404(验证 tenant_id 隔离)
- **P18**:student 列出成员 → 403(验证 user:read 权限)
- **P19**:student 邀请成员 → 403(验证 user:invite 权限)
- **P20**:teacher 移除成员 → 403(验证 user:remove 仅 admin/owner)
- **P25**:student listAnalyses 越权 query.userId 被强制覆盖(验证数据范围过滤)

---

## 七、构建验证

### 7.1 TypeScript 类型检查

```bash
npm run typecheck
```

结果:**0 错误,0 警告**(strict mode)

### 7.2 单元/集成测试

```bash
npm test
```

结果:**10 个测试文件,428 个用例全部通过**(耗时 2.06s)

### 7.3 修复记录

测试过程中发现并修复 2 个缺陷:

1. **P18 失败(空成员列表)**:`seedTestData()` 未插入 TenantMember 记录,导致 `listMembers` 返回空。
   - 修复:在 seedTestData 中显式插入 5 条 tenant_member 记录(student×2/teacher/admin/owner)。

2. **P19 失败(500 内部错误)**:Prisma Mock 的 `create` 不应用 schema 级 `@default(now())`,导致 `createMembership` 创建的记录 `joinedAt` 为 undefined,`membership.joinedAt.toISOString()` 抛 TypeError。
   - 修复:[tenant.repository.ts](src/repositories/tenant.repository.ts#L82-L96) `createMembership` 显式传入 `joinedAt: new Date()`,保证 mock 与真实 Prisma 行为一致。

---

## 八、技术约束符合性检查

| 约束 | 符合性 | 证据 |
|------|--------|------|
| TypeScript strict mode | 通过 | typecheck 0 错误 |
| 所有 API 需鉴权 | 通过 | analysis/tenant 路由全局挂载 authMiddleware |
| 外部输入 Zod 校验 | 通过 | switchTenantBodySchema/inviteMemberBodySchema/tenantIdParamSchema |
| 多租户 tenant_id 强制过滤 | 通过 | repository 层所有查询带 tenantId 条件 |
| 不暴露内部堆栈 | 通过 | 统一 error-handler,错误响应仅 {code,message,traceId} |
| 审计日志(写操作) | 通过 | deleteAnalysis/inviteMember/removeMember 均记录 logger.info |
| 越权不泄露存在性 | 通过 | 越权访问统一返回 404(非 403) |
| JWT access_token 15min | 通过 | jwtService.issueAccessToken(现有实现) |
| 错误码统一规范 | 通过 | FORBIDDEN=2004/TENANT_NOT_FOUND=3001/ANALYSIS_NOT_FOUND=4004 |
| 不记录敏感信息 | 通过 | 审计日志仅记录 userId/analysisId/role,不含 imageUrl/title |

---

## 九、已知限制与后续建议

### 9.1 当前限制

1. **权限矩阵为静态定义**:角色权限在 [permissions.ts](src/config/permissions.ts) 中硬编码,不支持运行时动态配置。如需自定义角色权限,需修改代码并重新部署。
2. **TenantMember.role 与 User.role 双写**:切换租户时同步更新两个字段,存在短暂不一致窗口(非事务)。当前由 switchTenant 顺序保证,生产环境建议用事务包装。
3. **Mock 环境与真实 Prisma 差异**:Prisma Mock 不应用 schema 级 `@default()` 默认值,repository 层已显式传入关键字段(joinedAt)规避。

### 9.2 后续建议

1. **Phase 2 补充**:为 user.routes.ts / artwork.routes.ts 补充权限中间件(当前仅 analysis/tenant 已挂载)
2. **动态权限**:如需支持自定义角色,可将 ROLE_PERMISSIONS 迁移到 DB 表(RolePermission),通过缓存加载
3. **权限缓存**:高频接口的权限检查可加 Redis 缓存(以 userId+role 为 key,TTL 5min),降低 CPU 开销
4. **审计日志持久化**:当前审计日志仅写 winston logger,建议后续落库 AuditLog 表,支持审计查询

---

## 十、验收结论

**通过**。

- RBAC 权限矩阵覆盖 4 角色 × 16 权限,矩阵清晰且与文档一致
- 权限中间件 3 个工厂函数(requirePermission/requireAnyPermission/requireAllPermissions)实现完整,默认拒绝策略到位
- /tenants/switch 实现完整,包含租户校验 + 成员校验 + role 同步 + JWT 重签
- 11 个 API 端点全部挂载权限中间件,数据范围过滤在 service 层强制执行
- 70 个权限测试用例覆盖单元 + 集成维度,428 个测试全部通过
- TypeScript strict mode 类型检查 0 错误
- 所有技术约束(鉴权/Zod 校验/tenant_id 过滤/审计日志/越权不泄露)均满足
