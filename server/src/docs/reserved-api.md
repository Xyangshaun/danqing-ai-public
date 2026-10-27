# 丹青有AI - 预留接口文档(Phase 5)

> **文档版本**:v1.0(2026-07-29)
> **状态标注**:`planned` = 已规划待实现 / `in-design` = 设计中 / `future` = 未来版本
> **当前实现**:所有预留接口统一返回 HTTP 501 + `code: 9901 (NOT_IMPLEMENTED)`
> **目标版本**:v2.0

---

## 目录

1. [设计原则](#1-设计原则)
2. [统一响应规范](#2-统一响应规范)
3. [知识库实时检索(预留)](#3-知识库实时检索预留)
4. [模块化功能扩展(预留)](#4-模块化功能扩展预留)
5. [UI 配置与组件数据(预留)](#5-ui-配置与组件数据预留)
6. [功能参数与流程控制(预留)](#6-功能参数与流程控制预留)
7. [错误码新增](#7-错误码新增)
8. [权限矩阵扩展](#8-权限矩阵扩展)
9. [版本控制计划](#9-版本控制计划)

---

## 1. 设计原则

### 1.1 预留目的

- 为后续系统功能扩展预留接口骨架,确保前端可提前对接契约
- 鉴权与权限校验链路已就位,只需后续填充业务逻辑
- 类型定义完整,请求参数与响应格式严格定义
- 不破坏现有 v1 接口的向后兼容性

### 1.2 预留接口规范

所有预留接口的 controller 统一返回:

```typescript
return error(
  res,
  ErrorCode.NOT_IMPLEMENTED, // 9901
  '该接口为预留接口,尚未实现。请参考API文档了解未来扩展方向。',
  501, // HTTP Not Implemented
);
```

响应体示例:

```json
{
  "code": 9901,
  "message": "该接口为预留接口,尚未实现。请参考API文档了解未来扩展方向。",
  "data": null,
  "traceId": "a3f4b2c1-d5e6-7890-abcd-ef1234567890"
}
```

### 1.3 中间件链路

所有预留接口均经过完整鉴权链路:

```
authMiddleware → tenantMiddleware → apiRateLimiter → requirePermission → handler
```

调用预留接口需携带有效 JWT,且必须满足对应权限要求,否则会先返回 401/403 而非 501。

---

## 2. 统一响应规范

### 2.1 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": { /* 业务数据 */ },
  "traceId": "uuid"
}
```

### 2.2 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "pageSize": 20,
    "hasMore": false
  },
  "traceId": "uuid"
}
```

---

## 3. 知识库实时检索(预留)

> **状态**:`planned` | **目标版本**:v2.0
> **未来方向**:支持 ES/向量检索,提供艺术知识库智能问答
> **权限基线**:`knowledge:read`(所有角色)/ `knowledge:write`(ADMIN/OWNER)/ `knowledge:index:manage`(ADMIN)

### 3.1 GET /api/v1/knowledge/search

**描述**:知识库搜索(关键词/标签/分类)

**查询参数**(`KnowledgeSearchQuery`):

| 参数       | 类型                | 必填 | 默认值     | 说明                          |
| ---------- | ------------------- | :--: | ---------- | ----------------------------- |
| q          | string              |  否  | -          | 关键词(全文检索)            |
| tags       | string              |  否  | -          | 标签筛选(逗号分隔,AND 语义) |
| category   | string              |  否  | -          | 分类筛选                      |
| artType    | ArtType             |  否  | -          | 作品类型筛选                  |
| status     | KnowledgeStatus     |  否  | published  | 状态筛选(见下方角色策略)    |
| semantic   | boolean             |  否  | false      | 是否启用语义检索              |
| page       | number              |  否  | 1          | 页码                          |
| pageSize   | number              |  否  | 20         | 每页数量(≤100)              |

> **角色策略(服务端强制执行)**:非 teacher/admin/owner 角色传入 `status=draft/archived` 时,
> 服务端强制回退为 `published`,不会返回草稿/归档内容。前端无需依赖 `search/validate` 预校验结果自行过滤。

**响应**:`KnowledgeSearchResponse`(分页 `KnowledgeEntry`)

**错误码**:
- `8102 KNOWLEDGE_INDEX_ERROR` - 索引服务异常(HTTP 503)
- `8103 KNOWLEDGE_PERMISSION_DENIED` - 无权访问该知识条目(HTTP 403)

### 3.2 GET /api/v1/knowledge/:id

**描述**:知识条目详情
**权限**:`knowledge:read`
**响应**:`GetKnowledgeResponse`(`KnowledgeEntry`)
**错误码**:`8101 KNOWLEDGE_NOT_FOUND` - 知识条目不存在(HTTP 404)

### 3.3 POST /api/v1/knowledge

**描述**:创建知识条目
**权限**:`knowledge:write`(仅 ADMIN/OWNER)
**请求体**:`CreateKnowledgeRequest`
**响应**:`CreateKnowledgeResponse`(`KnowledgeEntry`)
**审计**:写操作记录 audit log

### 3.4 PATCH /api/v1/knowledge/:id

**描述**:更新知识条目
**权限**:`knowledge:write`
**请求体**:`UpdateKnowledgeRequest`
**响应**:`UpdateKnowledgeResponse`
**错误码**:`8101 KNOWLEDGE_NOT_FOUND`

### 3.5 DELETE /api/v1/knowledge/:id

**描述**:删除知识条目
**权限**:`knowledge:write`
**响应**:`DeleteKnowledgeResponse`

### 3.6 POST /api/v1/knowledge/index/rebuild

**描述**:重建索引(异步任务)
**权限**:`knowledge:index:manage`(仅 ADMIN)
**响应**:`KnowledgeIndexRebuildResponse`(含 taskId)
**未来实现**:通过 WebSocket 推送重建进度

### 3.7 GET /api/v1/knowledge/index/status

**描述**:索引状态查询
**权限**:`knowledge:read`
**响应**:`KnowledgeIndexStatus`

### 3.8 POST /api/v1/knowledge/search/validate

**描述**:搜索权限验证(前端预校验)
**权限**:`knowledge:read`
**请求体**:`KnowledgeSearchValidateRequest`
**响应**:`KnowledgeSearchValidateResponse`

---

## 4. 模块化功能扩展(预留)

> **状态**:`planned` | **目标版本**:v2.0
> **未来方向**:支持插件式模块加载,允许第三方扩展功能
> **权限基线**:`modules:read`(所有角色)/ `modules:manage`(ADMIN/OWNER)

### 4.1 GET /api/v1/modules

**描述**:已安装模块列表
**权限**:`modules:read`
**响应**:`ListModulesResponse`(`ModuleInfo[]`)

### 4.2 GET /api/v1/modules/registry

**描述**:可用模块注册表(市场)
**权限**:`modules:read`
**查询参数**:`ListModuleRegistryQuery`
**响应**:`ListModuleRegistryResponse`(分页 `ModuleRegistryEntry`)
**注**:必须在 `/:moduleId` 路由前注册

### 4.3 POST /api/v1/modules/:moduleId/install

**描述**:安装模块
**权限**:`modules:manage`
**请求体**:`InstallModuleRequest`
**响应**:`InstallModuleResponse`
**错误码**:`8202 MODULE_ALREADY_INSTALLED`(HTTP 409)

### 4.4 DELETE /api/v1/modules/:moduleId

**描述**:卸载模块
**权限**:`modules:manage`
**响应**:`UninstallModuleResponse`
**错误码**:`8201 MODULE_NOT_FOUND`(HTTP 404)

### 4.5 GET /api/v1/modules/:moduleId/config

**描述**:模块配置
**权限**:`modules:read`
**响应**:`GetModuleConfigResponse`(`ModuleConfig`)

### 4.6 PATCH /api/v1/modules/:moduleId/config

**描述**:更新模块配置
**权限**:`modules:manage`
**请求体**:`UpdateModuleConfigRequest`
**响应**:`UpdateModuleConfigResponse`
**错误码**:`8203 MODULE_CONFIG_INVALID`(HTTP 400)

### 4.7 POST /api/v1/modules/:moduleId/enable

**描述**:启用模块
**权限**:`modules:manage`
**响应**:`EnableModuleResponse`

### 4.8 POST /api/v1/modules/:moduleId/disable

**描述**:禁用模块
**权限**:`modules:manage`
**响应**:`DisableModuleResponse`

---

## 5. UI 配置与组件数据(预留)

> **状态**:`planned` | **目标版本**:v2.0
> **未来方向**:支持主题切换、布局自定义、看板组件化配置
> **权限基线**:`ui:config:read`(所有角色)/ `ui:config:write`(ADMIN/OWNER)

### 5.1 GET /api/v1/ui/theme

**描述**:当前主题配置
**权限**:`ui:config:read`
**响应**:`GetCurrentThemeResponse`(`ThemeConfig`)

### 5.2 PATCH /api/v1/ui/theme

**描述**:更新主题
**权限**:`ui:config:write`
**请求体**:`UpdateThemeRequest`
**响应**:`UpdateThemeResponse`
**错误码**:`8302 UI_THEME_INVALID`(HTTP 400)

### 5.3 GET /api/v1/ui/themes

**描述**:可用主题列表
**权限**:`ui:config:read`
**响应**:`ListThemesResponse`(`ThemeListItem[]`)

### 5.4 GET /api/v1/ui/components/:componentId

**描述**:组件数据
**权限**:`ui:config:read`
**响应**:`GetComponentDataResponse`(`ComponentData`)
**错误码**:`8303 UI_COMPONENT_NOT_FOUND`(HTTP 404)

### 5.5 PUT /api/v1/ui/components/:componentId

**描述**:更新组件配置
**权限**:`ui:config:write`
**请求体**:`UpdateComponentDataRequest`
**响应**:`UpdateComponentDataResponse`

### 5.6 GET /api/v1/ui/layout

**描述**:布局配置
**权限**:`ui:config:read`
**响应**:`GetLayoutResponse`(`LayoutConfig`)

### 5.7 PATCH /api/v1/ui/layout

**描述**:更新布局配置
**权限**:`ui:config:write`
**请求体**:`UpdateLayoutRequest`
**响应**:`UpdateLayoutResponse`

### 5.8 GET /api/v1/ui/dashboard/:userId

**描述**:用户个性化看板
**权限**:`ui:config:read`(数据范围:学生仅自己,教师/管理员可查租户内任意用户)
**响应**:`GetDashboardResponse`(`DashboardConfig`)

### 5.9 PATCH /api/v1/ui/dashboard/:userId

**描述**:更新用户看板配置
**权限**:`ui:config:write`(ADMIN/OWNER 或自己更新自己)
**请求体**:`UpdateDashboardRequest`
**响应**:`UpdateDashboardResponse`

---

## 6. 功能参数与流程控制(预留)

> **状态**:`planned` | **目标版本**:v2.0
> **未来方向**:支持 feature flag 灰度发布、系统参数热更新、工作流编排
> **权限基线**:`config:features:read`(所有角色)/ `config:features:write`(ADMIN/OWNER)/ `config:workflows:manage`(ADMIN/OWNER)

### 6.1 GET /api/v1/config/features

**描述**:功能开关列表
**权限**:`config:features:read`
**查询参数**:`ListFeatureFlagsQuery`
**响应**:`ListFeatureFlagsResponse`(`FeatureFlag[]`)

### 6.2 PATCH /api/v1/config/features/:featureId

**描述**:更新功能开关
**权限**:`config:features:write`
**请求体**:`UpdateFeatureFlagRequest`
**响应**:`UpdateFeatureFlagResponse`
**错误码**:`8401 FEATURE_NOT_FOUND`(HTTP 404)

### 6.3 GET /api/v1/config/params

**描述**:系统参数列表
**权限**:`config:features:read`(敏感参数默认不返回)
**查询参数**:`ListSystemParamsQuery`
**响应**:`ListSystemParamsResponse`(`SystemParam[]`)

### 6.4 PATCH /api/v1/config/params/:paramKey

**描述**:更新系统参数
**权限**:`config:features:write`
**请求体**:`UpdateSystemParamRequest`
**响应**:`UpdateSystemParamResponse`
**错误码**:`8402 PARAM_KEY_INVALID`(HTTP 400)

### 6.5 GET /api/v1/config/workflows

**描述**:工作流定义列表
**权限**:`config:workflows:manage`
**查询参数**:`ListWorkflowsQuery`
**响应**:`ListWorkflowsResponse`(分页 `WorkflowDefinition`)

### 6.6 POST /api/v1/config/workflows

**描述**:创建工作流
**权限**:`config:workflows:manage`
**请求体**:`CreateWorkflowRequest`
**响应**:`CreateWorkflowResponse`

### 6.7 PATCH /api/v1/config/workflows/:id

**描述**:更新工作流
**权限**:`config:workflows:manage`
**请求体**:`UpdateWorkflowRequest`
**响应**:`UpdateWorkflowResponse`
**错误码**:`8403 WORKFLOW_NOT_FOUND`(HTTP 404)

### 6.8 GET /api/v1/config/workflows/:id/executions

**描述**:工作流执行历史
**权限**:`config:workflows:manage`
**查询参数**:`ListWorkflowExecutionsQuery`
**响应**:`ListWorkflowExecutionsResponse`(分页 `WorkflowExecution`)

### 6.9 POST /api/v1/config/workflows/:id/execute

**描述**:执行工作流
**权限**:`config:workflows:manage`
**请求体**:`ExecuteWorkflowRequest`
**响应**:`ExecuteWorkflowResponse`
**SLA 约束**:同步模式 3 秒内返回;超过 2.5s 自动切换为异步模式
**错误码**:`8404 WORKFLOW_EXECUTION_FAILED`(HTTP 500)

---

## 7. 错误码新增

### 7.1 预留接口统一错误码

| 错误码 | 名称                      | HTTP | 说明                          |
| ------ | ------------------------- | :--: | ----------------------------- |
| 9901   | `NOT_IMPLEMENTED`         | 501  | 预留接口未实现                |

### 7.2 知识库相关错误码

| 错误码 | 名称                          | HTTP | 说明                |
| ------ | ----------------------------- | :--: | ------------------- |
| 8101   | `KNOWLEDGE_NOT_FOUND`         | 404  | 知识条目不存在      |
| 8102   | `KNOWLEDGE_INDEX_ERROR`       | 503  | 索引服务异常        |
| 8103   | `KNOWLEDGE_PERMISSION_DENIED` | 403  | 知识库访问权限不足  |

### 7.3 模块化相关错误码

| 错误码 | 名称                          | HTTP | 说明             |
| ------ | ----------------------------- | :--: | ---------------- |
| 8201   | `MODULE_NOT_FOUND`            | 404  | 模块不存在       |
| 8202   | `MODULE_ALREADY_INSTALLED`    | 409  | 模块已安装       |
| 8203   | `MODULE_CONFIG_INVALID`       | 400  | 模块配置无效     |

### 7.4 UI 配置相关错误码

| 错误码 | 名称                          | HTTP | 说明             |
| ------ | ----------------------------- | :--: | ---------------- |
| 8301   | `UI_CONFIG_NOT_FOUND`         | 404  | UI 配置不存在    |
| 8302   | `UI_THEME_INVALID`            | 400  | 主题配置无效     |
| 8303   | `UI_COMPONENT_NOT_FOUND`      | 404  | 组件不存在       |

### 7.5 功能参数与流程控制相关错误码

| 错误码 | 名称                                | HTTP | 说明                  |
| ------ | ----------------------------------- | :--: | --------------------- |
| 8401   | `FEATURE_NOT_FOUND`                 | 404  | 功能开关不存在        |
| 8402   | `PARAM_KEY_INVALID`                 | 400  | 系统参数键无效        |
| 8403   | `WORKFLOW_NOT_FOUND`                | 404  | 工作流不存在          |
| 8404   | `WORKFLOW_EXECUTION_FAILED`         | 500  | 工作流执行失败        |

---

## 8. 权限矩阵扩展

### 8.1 新增权限码

| 权限标识                    | 说明                          | ADMIN | OWNER | TEACHER | STUDENT |
| --------------------------- | ----------------------------- | :---: | :---: | :-----: | :-----: |
| `knowledge:read`            | 知识库检索                    |  Y    |  Y    |   Y     |   Y     |
| `knowledge:write`           | 知识条目 CRUD                 |  Y    |  Y    |   N     |   N     |
| `knowledge:index:manage`    | 重建索引                      |  Y    |  Y    |   N     |   N     |
| `modules:read`              | 查看已安装/可用模块           |  Y    |  Y    |   Y     |   Y     |
| `modules:manage`            | 安装/卸载/启用/禁用/配置模块  |  Y    |  Y    |   N     |   N     |
| `ui:config:read`            | 查看主题/布局/组件配置        |  Y    |  Y    |   Y     |   Y     |
| `ui:config:write`           | 更新主题/布局/组件配置        |  Y    |  Y    |   N     |   N     |
| `config:features:read`      | 查看功能开关与系统参数        |  Y    |  Y    |   Y     |   Y     |
| `config:features:write`     | 更新功能开关与系统参数        |  Y    |  Y    |   N     |   N     |
| `config:workflows:manage`   | 工作流定义与执行              |  Y    |  Y    |   N     |   N     |

### 8.2 设计说明

- 读类权限(`*:read`)对所有角色开放,确保学生/教师可查看配置
- 写/管理类权限(`*:write` / `*:manage`)仅 ADMIN/OWNER 拥有
- `knowledge:index:manage` 虽任务描述标注 ADMIN,但 ALL_PERMISSIONS 自动覆盖 OWNER
  (与既有架构 `OWNER 等同 ADMIN` 设计原则一致,见 [permissions.ts](../config/permissions.ts))

---

## 9. 版本控制计划

### 9.1 当前版本(v1)

- 接口骨架已挂载,鉴权 + 权限校验完整
- 类型定义完整,可作为前端契约
- controller 统一返回 501 NOT_IMPLEMENTED
- 测试不要求新增,但不可破坏现有 515+ 测试

### 9.2 目标版本(v2.0)

实现顺序建议:

1. **优先级 P0**:知识库实时检索(支撑教学场景的核心检索能力)
2. **优先级 P1**:功能参数与流程控制(支撑灰度发布与运营)
3. **优先级 P2**:UI 配置与组件数据(支撑前端个性化)
4. **优先级 P3**:模块化功能扩展(支撑第三方插件生态)

### 9.3 兼容性保证

- v2 实现时**不修改** v1 已声明的接口路径与请求/响应类型
- 仅将 controller 内的 501 占位实现替换为真实业务逻辑
- 新增字段必须为可选(`?:`),保证向后兼容
- 数据库 schema 变更必须通过 `prisma migrate` 流程

---

## 10. 文件清单

### 10.1 新增文件

- [knowledge.controller.ts](../controllers/knowledge.controller.ts) - 知识库 controller(预留)
- [modules.controller.ts](../controllers/modules.controller.ts) - 模块 controller(预留)
- [ui-config.controller.ts](../controllers/ui-config.controller.ts) - UI 配置 controller(预留)
- [config.controller.ts](../controllers/config.controller.ts) - 配置 controller(预留)
- [knowledge.routes.ts](../routes/knowledge.routes.ts) - 知识库路由
- [modules.routes.ts](../routes/modules.routes.ts) - 模块路由
- [ui-config.routes.ts](../routes/ui-config.routes.ts) - UI 配置路由
- [config.routes.ts](../routes/config.routes.ts) - 配置路由
- [reserved-api.md](./reserved-api.md) - 本文档

### 10.2 修改文件

- [api-contract.ts](../types/api-contract.ts) - 新增 14 个错误码 + 4 类预留接口类型定义
- [permissions.ts](../config/permissions.ts) - 新增 10 个权限码 + 更新矩阵
- [app.ts](../app.ts) - 挂载 4 个新路由到 `/api/v1`

---

**文档维护**:新增预留接口或修改契约时,需同步更新本文档与 `api-contract.ts`。
