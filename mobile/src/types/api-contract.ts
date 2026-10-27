// ============================================================
// 丹青有AI - API 契约 TypeScript 类型(跨端共享主副本)
// 对应文档:.trae/documents/api-contract-v1.md 第 3 节
// 严格 TypeScript,禁止 any;所有字段显式类型
// 跨端同步:Web/Mobile/Admin 通过 sync 脚本同步本文件
// ============================================================

// ============ 3.1 通用类型 ============

/** 统一 API 响应包装 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
  traceId: string;
}

/** 成功响应(data 非空) */
export interface ApiSuccess<T> extends ApiResponse<T> {
  code: 0;
  data: T;
}

/** 错误响应(data 为 null) */
export interface ApiError extends ApiResponse<null> {
  data: null;
}

/** 分页响应数据 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 分页查询参数 */
export interface PaginationQuery {
  page?: number;      // 默认 1
  pageSize?: number;  // 默认 20,最大 100
}

/** 客户端标识 */
export type ClientType = 'web' | 'admin' | 'mobile' | 'marketing';

/** ISO 8601 时间字符串 */
export type ISODateString = string;

// ============ 3.2 错误码枚举 ============

/** 业务错误码枚举(与错误码表保持一致) */
export enum ErrorCode {
  SUCCESS = 0,
  PARAM_INVALID = 1001,
  PARAM_MISSING = 1002,
  RESOURCE_NOT_FOUND = 1003,
  PARAM_TYPE_MISMATCH = 1004,
  DUPLICATE_RESOURCE = 1005,
  UNAUTHORIZED = 2001,
  TOKEN_EXPIRED = 2002,
  REFRESH_TOKEN_INVALID = 2003,
  FORBIDDEN = 2004,
  TOKEN_SIGNATURE_INVALID = 2005,
  TENANT_NOT_FOUND = 3001,
  TENANT_DISABLED = 3002,
  TENANT_SEATS_FULL = 3003,
  TENANT_MISMATCH = 3004,
  FEISHU_AUTH_FAILED = 4001,
  FEISHU_TOKEN_EXCHANGE_FAILED = 4002,
  FEISHU_USER_INFO_FAILED = 4003,
  FEISHU_APP_CONFIG_ERROR = 4004,
  FILE_UPLOAD_FAILED = 5001,
  FILE_TYPE_UNSUPPORTED = 5002,
  FILE_TOO_LARGE = 5003,
  FILE_EMPTY = 5004,
  ANALYSIS_QUOTA_EXCEEDED = 6001,
  ANALYSIS_TIMEOUT = 6002,
  ANALYSIS_RESULT_FAILED = 6003,
  ANALYSIS_NOT_FOUND = 6004,
  ANALYSIS_IMAGE_INVALID = 6005,
  // 订阅相关错误码(7xxx)
  SUBSCRIPTION_NOT_FOUND = 7001,
  SUBSCRIPTION_PLAN_INVALID = 7002,
  SUBSCRIPTION_PAYMENT_FAILED = 7003,
  SUBSCRIPTION_ALREADY_CANCELED = 7004,
  SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED = 7005,
  INVOICE_NOT_FOUND = 7006,
  // 管理后台相关错误码(8xxx,Phase 4 追加)
  ADMIN_USER_NOT_FOUND = 8001,
  ADMIN_USER_ALREADY_LOCKED = 8002,
  ADMIN_USER_ALREADY_DELETED = 8003,
  ADMIN_BATCH_LIMIT_EXCEEDED = 8004,
  ADMIN_ARTWORK_NOT_FOUND = 8005,
  ADMIN_TEMPLATE_NOT_FOUND = 8006,
  ADMIN_API_KEY_NOT_FOUND = 8007,
  ADMIN_API_KEY_ALREADY_REVOKED = 8008,
  ADMIN_AUDIT_LOG_NOT_FOUND = 8009,
  ADMIN_ROLE_INVALID = 8010,
  ADMIN_REVIEW_ACTION_INVALID = 8011,
  ADMIN_REFUND_FAILED = 8012,
  ADMIN_PERMISSION_INSUFFICIENT = 8013,
  ADMIN_RESOURCE_CONFLICT = 8014,
  // 知识库实时检索相关错误码(8101-8103,Phase 5 预留)
  KNOWLEDGE_NOT_FOUND = 8101,
  KNOWLEDGE_INDEX_ERROR = 8102,
  KNOWLEDGE_PERMISSION_DENIED = 8103,
  // 模块化功能扩展相关错误码(8201-8203,Phase 5 预留)
  MODULE_NOT_FOUND = 8201,
  MODULE_ALREADY_INSTALLED = 8202,
  MODULE_CONFIG_INVALID = 8203,
  // UI 配置与组件数据相关错误码(8301-8303,Phase 5 预留)
  UI_CONFIG_NOT_FOUND = 8301,
  UI_THEME_INVALID = 8302,
  UI_COMPONENT_NOT_FOUND = 8303,
  // 功能参数与流程控制相关错误码(8401-8404,Phase 5 预留)
  FEATURE_NOT_FOUND = 8401,
  PARAM_KEY_INVALID = 8402,
  WORKFLOW_NOT_FOUND = 8403,
  WORKFLOW_EXECUTION_FAILED = 8404,
  INTERNAL_ERROR = 9001,
  DATABASE_ERROR = 9002,
  CACHE_ERROR = 9003,
  UPSTREAM_UNAVAILABLE = 9004,
  RATE_LIMITED = 9005,
  // Phase 5 新增错误码(91xx 段,避免与 9001-9005 冲突)
  PHASE5_PRESET_NOT_FOUND = 9101,
  PHASE5_PRESET_BUILTIN_IMMUTABLE = 9102,
  PHASE5_PRESET_DIMENSION_MISMATCH = 9103,
  PHASE5_REVIEW_NOT_FOUND = 9104,
  PHASE5_DISPUTE_NOT_FOUND = 9105,
  PHASE5_DISPUTE_ALREADY_RESOLVED = 9106,
  PHASE5_PHONE_VERIFICATION_FAILED = 9107,
  PHASE5_INVITATION_INVALID = 9108,
  PHASE5_ADMIN_AUTH_FAILED = 9109,
  // 预留接口相关错误码(99xx)
  NOT_IMPLEMENTED = 9901, // 预留接口未实现
}

/**
 * 错误码 → HTTP 状态码映射
 * 后端 utils/response.ts 中 error() 函数据此选择默认 HTTP 状态
 */
export const ERROR_HTTP_STATUS: Readonly<Record<number, number>> = Object.freeze({
  [ErrorCode.SUCCESS]: 200,
  [ErrorCode.PARAM_INVALID]: 400,
  [ErrorCode.PARAM_MISSING]: 400,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.PARAM_TYPE_MISMATCH]: 400,
  [ErrorCode.DUPLICATE_RESOURCE]: 409,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.REFRESH_TOKEN_INVALID]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.TOKEN_SIGNATURE_INVALID]: 401,
  [ErrorCode.TENANT_NOT_FOUND]: 404,
  [ErrorCode.TENANT_DISABLED]: 403,
  [ErrorCode.TENANT_SEATS_FULL]: 403,
  [ErrorCode.TENANT_MISMATCH]: 403,
  [ErrorCode.FEISHU_AUTH_FAILED]: 400,
  [ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED]: 502,
  [ErrorCode.FEISHU_USER_INFO_FAILED]: 502,
  [ErrorCode.FEISHU_APP_CONFIG_ERROR]: 500,
  [ErrorCode.FILE_UPLOAD_FAILED]: 400,
  [ErrorCode.FILE_TYPE_UNSUPPORTED]: 400,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.FILE_EMPTY]: 400,
  [ErrorCode.ANALYSIS_QUOTA_EXCEEDED]: 402,
  [ErrorCode.ANALYSIS_TIMEOUT]: 408,
  [ErrorCode.ANALYSIS_RESULT_FAILED]: 500,
  [ErrorCode.ANALYSIS_NOT_FOUND]: 404,
  [ErrorCode.ANALYSIS_IMAGE_INVALID]: 400,
  [ErrorCode.SUBSCRIPTION_NOT_FOUND]: 404,
  [ErrorCode.SUBSCRIPTION_PLAN_INVALID]: 400,
  [ErrorCode.SUBSCRIPTION_PAYMENT_FAILED]: 402,
  [ErrorCode.SUBSCRIPTION_ALREADY_CANCELED]: 409,
  [ErrorCode.SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED]: 400,
  [ErrorCode.INVOICE_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_USER_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_USER_ALREADY_LOCKED]: 409,
  [ErrorCode.ADMIN_USER_ALREADY_DELETED]: 409,
  [ErrorCode.ADMIN_BATCH_LIMIT_EXCEEDED]: 400,
  [ErrorCode.ADMIN_ARTWORK_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_TEMPLATE_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_API_KEY_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_API_KEY_ALREADY_REVOKED]: 409,
  [ErrorCode.ADMIN_AUDIT_LOG_NOT_FOUND]: 404,
  [ErrorCode.ADMIN_ROLE_INVALID]: 400,
  [ErrorCode.ADMIN_REVIEW_ACTION_INVALID]: 400,
  [ErrorCode.ADMIN_REFUND_FAILED]: 402,
  [ErrorCode.ADMIN_PERMISSION_INSUFFICIENT]: 403,
  [ErrorCode.ADMIN_RESOURCE_CONFLICT]: 409,
  // 预留接口错误码 HTTP 状态映射
  [ErrorCode.KNOWLEDGE_NOT_FOUND]: 404,
  [ErrorCode.KNOWLEDGE_INDEX_ERROR]: 503,
  [ErrorCode.KNOWLEDGE_PERMISSION_DENIED]: 403,
  [ErrorCode.MODULE_NOT_FOUND]: 404,
  [ErrorCode.MODULE_ALREADY_INSTALLED]: 409,
  [ErrorCode.MODULE_CONFIG_INVALID]: 400,
  [ErrorCode.UI_CONFIG_NOT_FOUND]: 404,
  [ErrorCode.UI_THEME_INVALID]: 400,
  [ErrorCode.UI_COMPONENT_NOT_FOUND]: 404,
  [ErrorCode.FEATURE_NOT_FOUND]: 404,
  [ErrorCode.PARAM_KEY_INVALID]: 400,
  [ErrorCode.WORKFLOW_NOT_FOUND]: 404,
  [ErrorCode.WORKFLOW_EXECUTION_FAILED]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.CACHE_ERROR]: 503,
  [ErrorCode.UPSTREAM_UNAVAILABLE]: 502,
  [ErrorCode.RATE_LIMITED]: 429,
  // Phase 5 新增错误码 HTTP 状态映射
  [ErrorCode.PHASE5_PRESET_NOT_FOUND]: 404,
  [ErrorCode.PHASE5_PRESET_BUILTIN_IMMUTABLE]: 403,
  [ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH]: 400,
  [ErrorCode.PHASE5_REVIEW_NOT_FOUND]: 404,
  [ErrorCode.PHASE5_DISPUTE_NOT_FOUND]: 404,
  [ErrorCode.PHASE5_DISPUTE_ALREADY_RESOLVED]: 409,
  [ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED]: 400,
  [ErrorCode.PHASE5_INVITATION_INVALID]: 400,
  [ErrorCode.PHASE5_ADMIN_AUTH_FAILED]: 401,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
});

// ============ 3.3 认证相关类型 ============

/** GET /auth/feishu/authorize 响应 */
export interface FeishuAuthorizeResponse {
  /** 飞书授权页完整 URL,前端直接 location.href 跳转 */
  authorizeUrl: string;
  /** 后端生成的 state,用于 callback 时校验 CSRF */
  state: string;
  /** 客户端传入的 redirect_uri,原样回显 */
  redirectUri: string;
}

/** GET /auth/feishu/callback 请求参数 */
export interface FeishuCallbackQuery {
  /** 飞书返回的授权码 */
  code: string;
  /** 后端在 authorize 阶段生成的 state */
  state: string;
}

/** GET /auth/feishu/callback 响应 */
export interface FeishuCallbackResponse {
  /** JWT access_token,前端存内存(不存 localStorage) */
  accessToken: string;
  /** access_token 过期时间(ISO 8601) */
  accessTokenExpiresAt: ISODateString;
  /** 是否为首次登录(用于前端引导新手流程) */
  isFirstLogin: boolean;
  /** 当前用户信息 */
  user: UserProfile;
  /** 当前激活租户信息 */
  tenant: TenantInfo;
  /**
   * refresh_token(仅 client=mobile 时返回)
   * RN 无法可靠读取 Set-Cookie,故 mobile 分支在响应体返回,
   * 由移动端自行安全存储(expo-secure-store),刷新时以 Cookie header 回传 /auth/refresh。
   * web/admin 走 HttpOnly Cookie 模式,该字段为 undefined。
   */
  refreshToken?: string;
  /**
   * CSRF token(仅 client=mobile 时返回,与 refreshToken 同周期下发)
   * 刷新时以 X-CSRF-Token 头回传,后端 csrfMiddleware 校验双提交。
   */
  csrfToken?: string;
}

/** POST /auth/refresh 响应 */
export interface AuthRefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: ISODateString;
}

/** POST /auth/logout 请求体(可选) */
export interface AuthLogoutRequest {
  revokeAll?: boolean;
}

/** POST /auth/logout 响应 */
export interface AuthLogoutResponse {
  /** 撤销的会话数 */
  revokedSessions: number;
}

/** GET /auth/me 响应 */
export interface AuthMeResponse {
  user: UserProfile;
  tenant: TenantInfo;
  /** 当前用户在所有租户中的成员关系(用于切换租户) */
  memberships: TenantMembership[];
}

// ============ 3.4 用户与租户类型 ============

/** 用户角色(租户内角色) */
export type UserRole = 'admin' | 'teacher' | 'student' | 'owner';

/** 用户资料(完整) */
export interface UserProfile {
  id: string;
  /** 当前激活租户 ID */
  tenantId: string;
  /** 飞书 open_id(Phase 5 起可空:非飞书用户为 null) */
  feishuOpenId: string | null;
  /** 飞书 union_id(Phase 5 起可空:非飞书用户为 null) */
  feishuUnionId: string | null;
  name: string;
  avatar: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  lastLoginAt: ISODateString | null;
}

/** PATCH /users/profile 请求 */
export interface UpdateProfileRequest {
  name?: string;
  avatar?: string;
  email?: string | null;
  phone?: string | null;
}

/** GET /users/profile 响应(等同 UserProfile) */
export type GetProfileResponse = UserProfile;

/** PATCH /users/profile 响应(返回更新后的完整资料) */
export type UpdateProfileResponse = UserProfile;

/**
 * PATCH /users/role 请求
 * 用于首次登录后的新手引导(onboarding)选择职业身份。
 * 业务规则:
 *   - 仅允许当前 role='student'(首次登录默认角色)的用户自选一次
 *   - 已选过(已切换到 teacher/admin)的账户无法再次自选,需管理员介入
 *   - 不允许选 'owner'(owner 由系统在创建个人租户时隐式赋值)
 */
export interface UpdateRoleRequest {
  role: 'admin' | 'teacher' | 'student';
}

/** PATCH /users/role 响应(返回更新后的完整资料) */
export type UpdateRoleResponse = UserProfile;

/** 租户类型 */
export type TenantType = 'school' | 'college' | 'class' | 'individual';

/** 订阅计划 */
export type TenantPlan = 'free' | 'standard' | 'enterprise';

/** 租户状态 */
export type TenantStatus = 'active' | 'disabled';

/** 租户信息 */
export interface TenantInfo {
  id: string;
  name: string;
  type: TenantType;
  feishuTenantKey: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  maxSeats: number;
  /** 父租户 ID(层级关系,class→college→school) */
  parentId: string | null;
  createdAt: ISODateString;
  /** 当月已用分析次数(仅 current 接口返回) */
  usedQuota?: number;
  /** 当月分析配额上限(仅 current 接口返回,-1 表示无限) */
  maxQuota?: number;
}

/** GET /tenants/current 响应 */
export type GetCurrentTenantResponse = TenantInfo;

/** POST /tenants/switch 请求 */
export interface SwitchTenantRequest {
  tenantId: string;
}

/** POST /tenants/switch 响应(返回新 access_token + 新角色) */
export interface SwitchTenantResponse {
  accessToken: string;
  accessTokenExpiresAt: ISODateString;
  tenant: TenantInfo;
  /** 切换后在新租户内的角色 */
  role: UserRole;
}

/** 用户在某租户中的成员关系 */
export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantType: TenantType;
  role: UserRole;
  joinedAt: ISODateString;
}

/** GET /tenants 响应(当前用户所有租户成员关系) */
export type ListUserTenantsResponse = TenantMembership[];

/** 租户成员信息(列表项) */
export interface TenantMemberInfo {
  userId: string;
  tenantId: string;
  role: UserRole;
  joinedAt: ISODateString;
  user: {
    id: string;
    name: string;
    avatar: string;
    email: string | null;
    feishuOpenId: string | null;
  };
}

/** GET /tenants/:id/members 响应 */
export type ListTenantMembersResponse = TenantMemberInfo[];

/** POST /tenants/:id/members 请求(邀请成员) */
export interface InviteMemberRequest {
  /** 被邀请用户的 ID(已注册用户)
   *  注:Phase 1 简化为按 userId 直接添加;后续可扩展为按 email/feishuOpenId 邀请 */
  userId: string;
  /** 在本租户中的角色 */
  role: UserRole;
}

/** POST /tenants/:id/members 响应 */
export interface InviteMemberResponse {
  userId: string;
  tenantId: string;
  role: UserRole;
  joinedAt: ISODateString;
}

/** DELETE /tenants/:id/members/:userId 响应 */
export interface RemoveMemberResponse {
  removed: boolean;
  userId: string;
}

// ============ 3.5 AI 分析相关类型 ============

/** 艺术作品类型(四类) */
export type ArtType = 'painting' | 'design' | 'product' | 'sculpture';

/** 分析任务状态 */
export type AnalysisStatus = 'pending' | 'processing' | 'success' | 'failed';

/** 提交分析任务请求 */
export interface CreateAnalysisRequest {
  /** 作品类型 */
  artType: ArtType;
  /** 图片 URL(若已上传)与 imageFile 二选一 */
  imageUrl?: string;
  /** 作品标题(可选) */
  title?: string;
  /** 备注(可选,如教师布置的作业要求) */
  remark?: string;
}

/** 提交分析任务响应(同步模式返回完整结果,异步模式仅返回 id+status) */
export interface CreateAnalysisResponse {
  id: string;
  status: AnalysisStatus;
  /** 同步模式且成功时返回完整结果;异步模式为 null */
  result: AnalysisDetail | null;
  /** 分析耗时(毫秒),异步模式为 null */
  durationMs: number | null;
}

/** 分析详情(完整结果) */
export interface AnalysisDetail {
  id: string;
  tenantId: string;
  userId: string;
  workType: ArtType;
  imageUrl: string;
  title: string | null;
  remark: string | null;
  status: AnalysisStatus;
  /** 分析结果 JSON(成功时非空),结构与 workType 对应 */
  result: AnalysisResult | null;
  /** 失败原因(status=failed 时非空) */
  failureReason: string | null;
  durationMs: number | null;
  createdAt: ISODateString;
  completedAt: ISODateString | null;
  // ---- Phase F1 可观测性元信息(可选,向后兼容) ----
  /** 是否经过 AI 增强(Phase F1 透传) */
  aiEnhanced?: boolean;
  /** 是否命中分析缓存(Phase F1 透传) */
  cacheHit?: boolean;
  /** Jimp 本地算法耗时(毫秒,Phase F1 透传) */
  jimpDurationMs?: number;
  /** AI 调用耗时(毫秒,Phase F1 透传) */
  aiDurationMs?: number;
}

/** 分析历史列表项(精简) */
export interface AnalysisListItem {
  id: string;
  workType: ArtType;
  imageUrl: string;
  title: string | null;
  status: AnalysisStatus;
  overallScore: number | null;
  createdAt: ISODateString;
}

/** GET /analyses 查询参数 */
export interface ListAnalysesQuery extends PaginationQuery {
  /** 按作品类型筛选 */
  artType?: ArtType;
  /** 按状态筛选 */
  status?: AnalysisStatus;
  /** 起始时间(ISO 8601) */
  startDate?: ISODateString;
  /** 结束时间(ISO 8601) */
  endDate?: ISODateString;
  /** 按用户筛选(教师查看班级学生时使用) */
  userId?: string;
}

/** GET /analyses 响应 */
export type ListAnalysesResponse = PaginatedData<AnalysisListItem>;

/** GET /analyses/:id 响应 */
export type GetAnalysisResponse = AnalysisDetail;

/** DELETE /analyses/:id 响应 */
export interface DeleteAnalysisResponse {
  id: string;
  deleted: boolean;
}

// ============ 3.6 分析结果类型(对齐现有 src/types/index.ts) ============

/** 焦点坐标 */
export interface FocusPoint {
  x: number;
  y: number;
}

/** 饱和度分布 */
export interface SaturationDistribution {
  low: number;
  mid: number;
  high: number;
}

/** pHash最相似作品信息 */
export interface MostSimilarWork {
  title: string;
  artist: string;
  distance: number;
}

/** 原创性维度(所有作品类型共享) */
export interface OriginalityDimension {
  score: number;
  /** 与网络图片相似度(0-1) */
  similarity: number;
  creativityLevel: 'excellent' | 'good' | 'average' | 'needsWork';
  suggestion: string;
  /** pHash感知哈希相似度(0-1),Phase A新增 */
  pHashSimilarity?: number;
  /** 最相似的名作信息(Phase A新增) */
  mostSimilarWork?: MostSimilarWork | null;
}

/** 绘画类分析维度 */
export interface PaintingAnalysis {
  type: 'painting';
  composition: {
    score: number;
    focusPoint: FocusPoint;
    balance: 'balanced' | 'left-heavy' | 'right-heavy' | 'top-heavy' | 'bottom-heavy';
    guideline: 'good' | 'average' | 'poor';
    whitespaceRatio: number;
    symmetry: number;
    suggestion: string;
    heatmapData: number[][];
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  color: {
    score: number;
    warmRatio: number;
    coolRatio: number;
    contrast: 'high' | 'medium' | 'low';
    saturation: 'high' | 'medium' | 'low';
    richness: 'rich' | 'moderate' | 'limited';
    harmony: string;
    dominantColor: string;
    suggestion: string;
    /** 色彩和谐度分数(0-100),Phase A新增 */
    harmonyScore?: number;
    /** 色彩和谐类型英文标识,Phase A新增 */
    harmonyType?: string;
    /** 饱和度三级分布,Phase A新增 */
    saturationDistribution?: SaturationDistribution;
  };
  brushwork: {
    score: number;
    textureLevel: 'rich' | 'moderate' | 'simple';
    strokeVariety: number;
    wetDryBalance: string;
    suggestion: string;
    /** 笔触方向一致性(0-1),Phase A新增 */
    directionCoherence?: number;
    /** 笔触能量/张力(0-1),Phase A新增 */
    strokeEnergy?: number;
    /** 主导笔触方向(0-180度),Phase A新增 */
    dominantBrushDirection?: number;
  };
}

/** 设计类分析维度 */
export interface DesignAnalysis {
  type: 'design';
  visualHierarchy: {
    score: number;
    focusPoint: FocusPoint;
    primarySecondaryClarity: 'clear' | 'moderate' | 'unclear';
    informationFlow: 'good' | 'average' | 'poor';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  typography: {
    score: number;
    alignmentQuality: 'good' | 'average' | 'poor';
    rhythmConsistency: 'good' | 'average' | 'poor';
    negativeSpaceUsage: 'good' | 'average' | 'poor';
    gridAdherence: number;
    suggestion: string;
    /** 排版方向对齐一致性(0-1),coherence>0.5表示对齐良好,Phase A新增 */
    directionCoherence?: number;
  };
  colorApplication: {
    score: number;
    contrast: 'high' | 'medium' | 'low';
    brandConsistency: 'strong' | 'moderate' | 'weak';
    colorPsychology: string;
    paletteHarmony: string;
    suggestion: string;
  };
}

/** 产品设计类分析维度 */
export interface ProductAnalysis {
  type: 'product';
  form: {
    score: number;
    focusPoint: FocusPoint;
    proportionBalance: 'good' | 'average' | 'poor';
    lineFluidity: 'smooth' | 'moderate' | 'stiff';
    surfaceQuality: 'excellent' | 'good' | 'average';
    ergonomicsHint: 'strong' | 'moderate' | 'weak';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
    /** 曲面/线条方向流畅度(0-1),Phase A新增 */
    directionCoherence?: number;
  };
  materialExpression: {
    score: number;
    textureRealism: 'high' | 'medium' | 'low';
    lightShadowPerformance: 'excellent' | 'good' | 'average';
    surfaceTreatment: 'refined' | 'moderate' | 'rough';
    suggestion: string;
  };
  functionExpression: {
    score: number;
    structureClarity: 'clear' | 'moderate' | 'unclear';
    functionImplication: 'strong' | 'moderate' | 'weak';
    detailRefinement: 'excellent' | 'good' | 'average';
    suggestion: string;
  };
}

/** 雕塑类分析维度 */
export interface SculptureAnalysis {
  type: 'sculpture';
  spatialComposition: {
    score: number;
    focusPoint: FocusPoint;
    volumeSense: 'strong' | 'moderate' | 'weak';
    spaceOccupation: 'full' | 'moderate' | 'sparse';
    voidSolidRelation: 'harmonious' | 'moderate' | 'imbalanced';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  bodyLanguage: {
    score: number;
    dynamicSense: 'strong' | 'moderate' | 'static';
    tensionExpression: 'high' | 'medium' | 'low';
    rhythmFlow: 'fluent' | 'moderate' | 'stiff';
    suggestion: string;
    /** 形体方向一致性(0-1),形体张力辅助,Phase A新增 */
    directionCoherence?: number;
    /** 形体能量/张力(0-1),Phase A新增 */
    strokeEnergy?: number;
  };
  materialLanguage: {
    score: number;
    materialCharacter: 'distinct' | 'moderate' | 'obscure';
    textureExpression: 'rich' | 'moderate' | 'simple';
    qualityLayering: 'rich' | 'moderate' | 'simple';
    suggestion: string;
  };
}

/** 分析结果联合类型(workType 决定具体分支) */
export type DimensionResult =
  | PaintingAnalysis
  | DesignAnalysis
  | ProductAnalysis
  | SculptureAnalysis;

// ============ 3.6.5 AI 增强字段(AI 视觉分析返回,可选) ============

/** 建议等级(对应美院评分标准的四档:优/良/中/差) */
export type SuggestionLevel = 'excellent' | 'good' | 'average' | 'poor';

/** 建议优先级:high(<60分必改)/medium(60-80分提升)/low(>80分亮点) */
export type SuggestionPriority = 'high' | 'medium' | 'low';

/** 专业改进建议(ArtCoT 证据锚定格式) */
export interface ProfessionalSuggestion {
  /** 维度名(构图与造型/色彩表现/笔触与技法/视觉层次/排版与构成/形态语义 等) */
  dimension: string;
  /** 该维度的评级 */
  level: SuggestionLevel;
  /** 证据字段:引用具体数值证据 */
  evidence: string;
  /** 具体操作(含数值/位置/方法) */
  operation: string;
  /** 参考案例(美术史作品) */
  reference: string;
  /** 练习路径(1-2 个针对性练习) */
  practice: string;
  /** 优先级 */
  priority: SuggestionPriority;
}

/** 美术史参考作品推荐 */
export interface ReferenceArtwork {
  /** 作品名 */
  title: string;
  /** 艺术家 */
  artist: string;
  /** 推荐理由(与本作业的关联) */
  reason: string;
}

/** AI 调用失败原因分类 */
export type AIFailureReason =
  | 'AI_DISABLED'
  | 'AI_KEY_MISSING'
  | 'AI_TIMEOUT'
  | 'AI_HTTP_ERROR'
  | 'AI_PARSE_ERROR'
  | 'AI_SCHEMA_ERROR'
  | 'AI_NETWORK_ERROR'
  | 'AI_UNKNOWN_ERROR';

/** AI 调用元信息(可观测性) */
export interface AIInvocationMeta {
  /** AI 是否成功调用并返回有效结果 */
  aiSuccess: boolean;
  /** AI 调用耗时(毫秒) */
  aiDurationMs: number;
  /** AI 失败原因(aiSuccess=false 时非空) */
  aiFailureReason: AIFailureReason | null;
  /** 使用的 AI 模型名 */
  aiModel: string;
  /** AI 调用时间戳(ISO 8601) */
  aiInvokedAt: string;
  /** AI 响应的 token 用量 */
  aiTokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 完整分析结果(对应 AnalysisDetail.result) */
export interface AnalysisResult {
  /** 作品类型(与 DimensionResult.type 一致,便于前端 narrowing) */
  artType: ArtType;
  dimensions: DimensionResult;
  originality: OriginalityDimension;
  /** 综合评分(0-100) */
  overallScore: number;
  // ---- AI 增强字段(Phase 2,可选,Jimp-only 模式下可能不存在) ----
  /** 专业改进建议列表(AI 增强时非空,Jimp+模板降级也会填充) */
  professionalSuggestions?: ProfessionalSuggestion[];
  /** 主题与意境理解(50-100字,AI 成功时提供) */
  semanticTheme?: string;
  /** 风格识别(如"印象派条件色处理",AI 成功时提供) */
  styleRecognition?: string;
  /** 参考案例推荐(美术史作品,AI 成功时提供) */
  referenceArtworks?: ReferenceArtwork[];
}

// ============ 3.7 艺术品知识库相关类型 ============

/** 艺术品分类(比 ArtType 多 calligraphy/architecture 两类,用于知识库检索) */
export type ArtworkCategory =
  | 'painting'
  | 'design'
  | 'product'
  | 'sculpture'
  | 'calligraphy'
  | 'architecture';

/** 艺术品地域 */
export type ArtworkRegion = 'china' | 'east-asia' | 'europe' | 'america' | 'other';

/** 艺术品条目(对齐前端 src/services/artworksDatabase.ts 的 ArtworkItem) */
export interface ArtworkItem {
  id: string;
  title: string;
  titleEn?: string;
  artist: string;
  artistEn?: string;
  year: string;
  category: ArtworkCategory;
  style: string;
  era: string;
  region: ArtworkRegion;
  description: string;
  imageUrl: string;
  thumbUrl?: string;
  source: string;
  sourceUrl?: string;
  tags: string[];
  dimensions?: string;
  medium?: string;
}

/** 单个分类的风格/时代/题材配置 */
export interface StyleCategoryEntry {
  name: string;
  styles: string[];
  eras: string[];
  subjects: string[];
}

/** 风格分类配置(键为 ArtType 四类,值为对应分类配置) */
export type StyleCategories = Record<ArtType, StyleCategoryEntry>;

/** 艺术品分页查询响应 */
export type PaginatedArtworks = PaginatedData<ArtworkItem>;

// ============ 3.9 订阅相关类型(Phase 3 追加) ============

/** 订阅状态 */
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';

/** 发票状态 */
export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/** 支付渠道 */
export type PaymentProvider = 'stripe' | 'alipay' | 'wechat' | 'manual';

/** 订阅计划详情(静态配置,对应 data-model-v1.md TenantPlan) */
export interface PlanInfo {
  /** 计划标识 */
  plan: TenantPlan;
  /** 计划名称(中文) */
  name: string;
  /** 月度分析配额上限(-1 表示无限) */
  maxQuota: number;
  /** 席位上限 */
  maxSeats: number;
  /** 月度价格(单位:元;free 为 0) */
  price: number;
  /** 货币 */
  currency: string;
  /** 计划特性列表(用于前端展示) */
  features: string[];
  /** 是否推荐(前端高亮展示) */
  recommended?: boolean;
}

/** 订阅信息(完整) */
export interface SubscriptionInfo {
  id: string;
  tenantId: string;
  plan: TenantPlan;
  status: SubscriptionStatus;
  /** 当前计费周期开始时间 */
  periodStart: ISODateString;
  /** 当前计费周期结束时间 */
  periodEnd: ISODateString;
  /** 周期结束自动取消 */
  cancelAtPeriodEnd: boolean;
  /** 支付渠道(free 为 null) */
  paymentProvider: PaymentProvider | null;
  /** 月度金额(单位:元) */
  amount: number;
  currency: string;
  /** 席位数 */
  seats: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** 当月已用分析次数(从 Redis 计数器读取) */
  usedQuota?: number;
  /** 当月分析配额上限(-1 表示无限) */
  maxQuota?: number;
}

/** 发票信息 */
export interface InvoiceInfo {
  id: string;
  tenantId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: ISODateString;
  periodEnd: ISODateString;
  paidAt: ISODateString | null;
  paymentProvider: PaymentProvider | null;
  externalInvoiceId: string | null;
  description: string | null;
  createdAt: ISODateString;
}

/** GET /subscriptions/current 响应 */
export type GetCurrentSubscriptionResponse = SubscriptionInfo;

/** GET /subscriptions/plans 响应 */
export type ListPlansResponse = PlanInfo[];

/** GET /subscriptions/usage 响应 */
export interface GetUsageResponse {
  /** 当前计划 */
  plan: TenantPlan;
  /** 当月已用分析次数 */
  usedQuota: number;
  /** 当月配额上限(-1 表示无限) */
  maxQuota: number;
  /** 剩余次数(-1 表示无限;0 表示已耗尽) */
  remainingQuota: number;
  /** 当前计费周期 */
  periodStart: ISODateString;
  periodEnd: ISODateString;
  /** 席位使用情况 */
  usedSeats: number;
  maxSeats: number;
}

/** POST /subscriptions/upgrade 请求 */
export interface UpgradeSubscriptionRequest {
  /** 目标计划 */
  plan: TenantPlan;
  /** 支付渠道(升级到付费计划时必填) */
  paymentProvider?: PaymentProvider;
  /** 外部支付凭证(如支付宝订单号;free 计划可省略) */
  paymentToken?: string;
}

/** POST /subscriptions/upgrade 响应 */
export type UpgradeSubscriptionResponse = SubscriptionInfo;

/** POST /subscriptions/cancel 响应 */
export interface CancelSubscriptionResponse {
  id: string;
  status: SubscriptionStatus;
  /** 周期结束时间(取消后仍可用至此时间) */
  periodEnd: ISODateString;
  cancelAtPeriodEnd: boolean;
}

/** GET /subscriptions/invoices 响应(分页) */
export type ListInvoicesResponse = PaginatedData<InvoiceInfo>;

// ============ 3.8 AI 增强分析相关类型(Phase 2 追加,向后兼容) ============
//
// 设计原则:
//   - 仅追加新类型,不修改现有类型(向后兼容)
//   - AnalysisDetail.result 字段类型保持 AnalysisResult | null
//     实际存储 HybridAnalysisResult(扩展 AnalysisResult,前端按 aiEnhanced 字段判断是否启用 AI 增强)
//   - 前端旧版本忽略 aiEnhanced/aiVisionResult/aiMeta 字段,仍可正常渲染基础分析结果
//
// 详见:server/src/types/ai-analysis.ts(权威定义)
// ====================================================================

/**
 * AI 增强后的分析结果摘要(用于列表项追加 AI 标识)
 * 仅追加 aiEnhanced 字段,其余字段同 AnalysisListItem
 */
export interface AIEnhancedAnalysisListItem extends AnalysisListItem {
  /** 是否经过 AI 增强 */
  aiEnhanced: boolean;
}

/**
 * AI 增强后的分析详情(用于 GET /analyses/:id 响应)
 * 仅追加 aiEnhanced 字段,其余字段同 AnalysisDetail
 */
export interface AIEnhancedAnalysisDetail extends AnalysisDetail {
  /** 是否经过 AI 增强 */
  aiEnhanced: boolean;
}

// ============ 3.9 成长曲线相关类型(Phase 2,对应 GET /growth) ============

/** 成长维度 */
export type GrowthDimension = 'composition' | 'color' | 'originality' | 'overall';

/** 成长时间范围 */
export type GrowthTimeRange = '7d' | '30d' | '90d' | 'all';

/** 成长趋势 */
export type GrowthTrend = 'up' | 'down' | 'stable';

/** 成长曲线数据点 */
export interface GrowthDataPoint {
  /** ISO 8601 日期(对应分析记录的 createdAt) */
  date: ISODateString;
  /** 分数(0-100) */
  score: number;
  /** 关联的分析记录 ID */
  analysisId: string;
  /** 作品类型(painting/design/product/sculpture) */
  artType: string;
}

/** 成长曲线汇总统计 */
export interface GrowthSummary {
  /** 当前最新分数(0-100) */
  current: number;
  /** 平均分(四舍五入取整) */
  average: number;
  /** 趋势:相比第一个数据点上升/下降/持平 */
  trend: GrowthTrend;
  /** 相比第一个数据点的变化量(当前 - 首个) */
  change: number;
  /** 总分析次数(有效数据点数) */
  totalAnalyses: number;
}

/** GET /growth 查询参数 */
export interface GrowthQuery {
  /** 成长维度,默认 overall */
  dimension?: GrowthDimension;
  /** 时间范围,默认 30d */
  timeRange?: GrowthTimeRange;
  /** 作品类型过滤(可选) */
  artType?: ArtType;
  /** TEACHER/ADMIN 查看指定学生的成长(可选;STUDENT 传此参数将被忽略) */
  userId?: string;
}

/** GET /growth 响应 */
export interface GrowthResponse {
  /** 查询的维度 */
  dimension: string;
  /** 查询的时间范围 */
  timeRange: string;
  /** 数据点列表(按时间升序) */
  dataPoints: GrowthDataPoint[];
  /** 汇总统计 */
  summary: GrowthSummary;
}

// ============ 3.10 管理后台类型(Phase 4 追加) ============
//
// 设计原则:
//   - 所有列表查询统一使用 PaginatedData<T> 与 PaginationQuery
//   - 所有写操作请求体使用 Zod schema 校验,与 TS 类型一一对应
//   - 用户列表返回时手机/邮箱/身份证必须脱敏(由 service 层处理)
//   - 审计日志由 service 层统一记录,controller 仅传递上下文
// ====================================================================

/** 用户状态(管理后台) */
export type UserStatus = 'active' | 'locked' | 'deleted';

/** 作品审核状态 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

/** 审核动作 */
export type ReviewAction = 'approve' | 'reject' | 'flag';

/** API 密钥状态 */
export type ApiKeyStatus = 'active' | 'revoked';

/** 审计动作类型 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'lock'
  | 'batch'
  | 'review'
  | 'cancel'
  | 'refund'
  | 'revoke'
  | 'login'
  | 'logout';

// ---------- 3.10.1 用户管理 ----------

/** 管理后台用户列表项(脱敏后) */
export interface AdminUserListItem {
  id: string;
  tenantId: string;
  name: string;
  avatar: string;
  /** 脱敏邮箱(如 z***@example.com) */
  email: string | null;
  /** 脱敏手机号(如 138****1234) */
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: ISODateString;
  lastLoginAt: ISODateString | null;
  lockedAt: ISODateString | null;
}

/** 管理后台用户详情(脱敏后) */
export interface AdminUserDetail extends AdminUserListItem {
  /** 飞书 open_id(Phase 5 起可空:非飞书用户为 null) */
  feishuOpenId: string | null;
  updatedAt: ISODateString;
  lockedBy: string | null;
}

/** GET /api/admin/users 查询参数 */
export interface ListAdminUsersQuery extends PaginationQuery {
  /** 模糊搜索(name/email) */
  search?: string;
  /** 按租户筛选(可选,默认当前租户) */
  tenantId?: string;
  /** 按角色筛选 */
  role?: UserRole;
  /** 按状态筛选 */
  status?: UserStatus;
  /** 起始时间 */
  startDate?: ISODateString;
  /** 结束时间 */
  endDate?: ISODateString;
  /** 排序字段(默认 createdAt) */
  sortBy?: 'createdAt' | 'lastLoginAt' | 'name';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
}

/** GET /api/admin/users 响应 */
export type ListAdminUsersResponse = PaginatedData<AdminUserListItem>;

/** PATCH /api/admin/users/:id 请求 */
export interface UpdateAdminUserRequest {
  role?: UserRole;
  status?: UserStatus;
  name?: string;
}

/** PATCH /api/admin/users/:id 响应 */
export type UpdateAdminUserResponse = AdminUserDetail;

/** POST /api/admin/users/:id/lock 请求 */
export interface LockAdminUserRequest {
  /** true=锁定,false=解锁 */
  locked: boolean;
  /** 锁定原因(可选) */
  reason?: string;
}

/** POST /api/admin/users/:id/lock 响应 */
export interface LockAdminUserResponse {
  id: string;
  status: UserStatus;
  lockedAt: ISODateString | null;
}

/** POST /api/admin/users/batch 请求 */
export interface BatchAdminUsersRequest {
  /** 用户 ID 列表(最多 100 条) */
  userIds: string[];
  /** 批量操作类型 */
  action: 'updateRole' | 'delete';
  /** updateRole 时必填 */
  role?: UserRole;
}

/** 批量操作单条结果 */
export interface BatchAdminUserResult {
  userId: string;
  success: boolean;
  /** 失败时的错误消息 */
  error?: string;
}

/** POST /api/admin/users/batch 响应 */
export interface BatchAdminUsersResponse {
  /** 总数 */
  total: number;
  /** 成功数 */
  succeeded: number;
  /** 失败数 */
  failed: number;
  /** 每条操作结果 */
  results: BatchAdminUserResult[];
}

/** GET /api/admin/users/export 查询参数 */
export interface ExportAdminUsersQuery {
  /** 字段选择(逗号分隔,如 id,name,email,role) */
  fields?: string;
  /** 同 ListAdminUsersQuery 的筛选(无分页) */
  search?: string;
  tenantId?: string;
  role?: UserRole;
  status?: UserStatus;
}

/** GET /api/admin/roles 响应项 */
export interface AdminRoleInfo {
  role: UserRole;
  roleName: string;
  description: string;
  /** 权限码列表 */
  permissions: string[];
}

/** GET /api/admin/roles 响应 */
export type ListAdminRolesResponse = AdminRoleInfo[];

/** PATCH /api/admin/roles/:role 请求 */
export interface UpdateAdminRoleRequest {
  /** 权限码列表(全量替换) */
  permissions: string[];
}

/** PATCH /api/admin/roles/:role 响应 */
export interface UpdateAdminRoleResponse {
  role: UserRole;
  permissions: string[];
}

// ---------- 3.10.2 内容管理 ----------

/** 管理后台作品列表项 */
export interface AdminArtworkListItem {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  workType: ArtType;
  imageUrl: string;
  title: string | null;
  status: AnalysisStatus;
  reviewStatus: ReviewStatus;
  overallScore: number | null;
  createdAt: ISODateString;
  reviewedAt: ISODateString | null;
}

/** GET /api/admin/artworks 查询参数 */
export interface ListAdminArtworksQuery extends PaginationQuery {
  tenantId?: string;
  workType?: ArtType;
  status?: AnalysisStatus;
  reviewStatus?: ReviewStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
  search?: string;
}

/** GET /api/admin/artworks 响应 */
export type ListAdminArtworksResponse = PaginatedData<AdminArtworkListItem>;

/** GET /api/admin/artworks/:id 响应 */
export interface AdminArtworkDetail extends AdminArtworkListItem {
  remark: string | null;
  failureReason: string | null;
  durationMs: number | null;
  completedAt: ISODateString | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}

/** POST /api/admin/artworks/:id/review 请求 */
export interface ReviewArtworkRequest {
  /** 审核动作 */
  action: ReviewAction;
  /** 审核备注(可选) */
  note?: string;
}

/** POST /api/admin/artworks/:id/review 响应 */
export interface ReviewArtworkResponse {
  id: string;
  reviewStatus: ReviewStatus;
  reviewedAt: ISODateString;
  reviewedBy: string;
}

/** DELETE /api/admin/artworks/:id 响应 */
export interface DeleteAdminArtworkResponse {
  id: string;
  deleted: boolean;
}

/** 创意预设模板信息 */
export interface CreativeTemplateInfo {
  id: string;
  name: string;
  description: string | null;
  artType: ArtType;
  content: Record<string, unknown>;
  tags: string[];
  thumbnailUrl: string | null;
  enabled: boolean;
  sortOrder: number;
  createdById: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** GET /api/admin/templates 查询参数 */
export interface ListAdminTemplatesQuery extends PaginationQuery {
  artType?: ArtType;
  enabled?: boolean;
  search?: string;
}

/** GET /api/admin/templates 响应 */
export type ListAdminTemplatesResponse = PaginatedData<CreativeTemplateInfo>;

/** POST /api/admin/templates 请求 */
export interface CreateTemplateRequest {
  name: string;
  description?: string;
  artType: ArtType;
  content: Record<string, unknown>;
  tags?: string[];
  thumbnailUrl?: string;
  enabled?: boolean;
  sortOrder?: number;
}

/** POST /api/admin/templates 响应 */
export type CreateTemplateResponse = CreativeTemplateInfo;

/** PATCH /api/admin/templates/:id 请求 */
export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  content?: Record<string, unknown>;
  tags?: string[];
  thumbnailUrl?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

/** PATCH /api/admin/templates/:id 响应 */
export type UpdateTemplateResponse = CreativeTemplateInfo;

/** DELETE /api/admin/templates/:id 响应 */
export interface DeleteTemplateResponse {
  id: string;
  deleted: boolean;
}

// ---------- 3.10.3 订阅管理 ----------

/** 管理后台订阅列表项 */
export interface AdminSubscriptionListItem {
  id: string;
  tenantId: string;
  tenantName: string;
  plan: TenantPlan;
  status: SubscriptionStatus;
  periodStart: ISODateString;
  periodEnd: ISODateString;
  cancelAtPeriodEnd: boolean;
  amount: number;
  currency: string;
  seats: number;
  createdAt: ISODateString;
}

/** GET /api/admin/subscriptions 查询参数 */
export interface ListAdminSubscriptionsQuery extends PaginationQuery {
  tenantId?: string;
  plan?: TenantPlan;
  status?: SubscriptionStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
}

/** GET /api/admin/subscriptions 响应 */
export type ListAdminSubscriptionsResponse = PaginatedData<AdminSubscriptionListItem>;

/** GET /api/admin/subscriptions/:id 响应 */
export interface AdminSubscriptionDetail extends AdminSubscriptionListItem {
  paymentProvider: PaymentProvider | null;
  externalSubId: string | null;
  updatedAt: ISODateString;
}

/** POST /api/admin/subscriptions/:id/cancel 响应 */
export interface AdminCancelSubscriptionResponse {
  id: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  periodEnd: ISODateString;
}

/** POST /api/admin/subscriptions/:id/refund 请求 */
export interface AdminRefundRequest {
  /** 退款金额(单位:元) */
  amount: number;
  /** 退款原因 */
  reason: string;
  /** 外部退款单号(可选) */
  externalRefundId?: string;
}

/** POST /api/admin/subscriptions/:id/refund 响应 */
export interface AdminRefundResponse {
  subscriptionId: string;
  invoiceId: string;
  refundedAmount: number;
  status: SubscriptionStatus;
}

/** 管理后台发票列表项 */
export interface AdminInvoiceListItem {
  id: string;
  tenantId: string;
  tenantName: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: ISODateString;
  periodEnd: ISODateString;
  paidAt: ISODateString | null;
  createdAt: ISODateString;
}

/** GET /api/admin/invoices 查询参数 */
export interface ListAdminInvoicesQuery extends PaginationQuery {
  tenantId?: string;
  status?: InvoiceStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
}

/** GET /api/admin/invoices 响应 */
export type ListAdminInvoicesResponse = PaginatedData<AdminInvoiceListItem>;

/** GET /api/admin/invoices/:id 响应 */
export interface AdminInvoiceDetail extends AdminInvoiceListItem {
  paymentProvider: PaymentProvider | null;
  externalInvoiceId: string | null;
  description: string | null;
}

/** 管理后台套餐列表项 */
export interface AdminPlanInfo extends PlanInfo {
  /** 启用状态 */
  enabled: boolean;
}

/** GET /api/admin/plans 响应 */
export type ListAdminPlansResponse = AdminPlanInfo[];

/** POST /api/admin/plans 请求 */
export interface CreateAdminPlanRequest {
  plan: TenantPlan;
  name: string;
  maxQuota: number;
  maxSeats: number;
  price: number;
  currency?: string;
  features: string[];
  recommended?: boolean;
  enabled?: boolean;
}

/** POST /api/admin/plans 响应 */
export type CreateAdminPlanResponse = AdminPlanInfo;

/** PATCH /api/admin/plans/:id 请求 */
export interface UpdateAdminPlanRequest {
  name?: string;
  maxQuota?: number;
  maxSeats?: number;
  price?: number;
  features?: string[];
  recommended?: boolean;
  enabled?: boolean;
}

/** PATCH /api/admin/plans/:id 响应 */
export type UpdateAdminPlanResponse = AdminPlanInfo;

// ---------- 3.10.4 数据看板 ----------

/** GET /api/admin/stats/overview 响应 */
export interface AdminStatsOverview {
  /** 日活用户数(当日登录) */
  dau: number;
  /** 月活用户数(30 日内登录) */
  mau: number;
  /** 总作品数(分析任务总数) */
  totalArtworks: number;
  /** 当日 AI 调用量 */
  todayAiCalls: number;
  /** 总租户数 */
  totalTenants: number;
  /** 总用户数 */
  totalUsers: number;
  /** 当日新增用户数 */
  todayNewUsers: number;
  /** 当日新增作品数 */
  todayNewArtworks: number;
  /** 统计时间戳 */
  timestamp: ISODateString;
}

/** GET /api/admin/stats/growth 查询参数 */
export interface AdminStatsGrowthQuery {
  /** 统计粒度 */
  granularity: 'day' | 'week' | 'month';
  /** 起始时间 */
  startDate: ISODateString;
  /** 结束时间 */
  endDate: ISODateString;
  /** 指标类型 */
  metric?: 'users' | 'artworks' | 'aiCalls' | 'revenue';
}

/** 成长趋势数据点 */
export interface AdminGrowthDataPoint {
  date: ISODateString;
  /** 新增数量 */
  count: number;
  /** 累计总数 */
  cumulative: number;
}

/** GET /api/admin/stats/growth 响应 */
export interface AdminStatsGrowthResponse {
  granularity: string;
  metric: string;
  dataPoints: AdminGrowthDataPoint[];
}

/** GET /api/admin/stats/retention 查询参数 */
export interface AdminStatsRetentionQuery {
  /** 起始时间 */
  startDate: ISODateString;
  /** 结束时间 */
  endDate: ISODateString;
  /** 留存周期类型 */
  period?: '7d' | '14d' | '30d';
}

/** 留存数据点 */
export interface AdminRetentionDataPoint {
  /** 注册日期 */
  date: ISODateString;
  /** 当日注册数 */
  registered: number;
  /** 第 N 日留存数 */
  retained: number;
  /** 留存率(0-1) */
  retentionRate: number;
}

/** GET /api/admin/stats/retention 响应 */
export interface AdminStatsRetentionResponse {
  period: string;
  dataPoints: AdminRetentionDataPoint[];
}

/** GET /api/admin/stats/ai-cost 查询参数 */
export interface AdminStatsAiCostQuery {
  startDate: ISODateString;
  endDate: ISODateString;
  /** 按维度聚合 */
  groupBy?: 'day' | 'tenant' | 'model';
}

/** AI 成本统计 */
export interface AdminAiCostStat {
  /** 日期/租户/模型(取决于 groupBy) */
  dimension: string;
  /** 调用次数 */
  callCount: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failedCount: number;
  /** 平均耗时(毫秒) */
  avgDurationMs: number;
  /** 估算成本(元) */
  estimatedCost: number;
}

/** GET /api/admin/stats/ai-cost 响应 */
export interface AdminStatsAiCostResponse {
  groupBy: string;
  stats: AdminAiCostStat[];
  /** 总成本 */
  totalCost: number;
}

/** GET /api/admin/stats/realtime 响应 */
export interface AdminStatsRealtime {
  /** 在线用户数(5 分钟内活跃) */
  onlineUsers: number;
  /** 当日累计 AI 调用 */
  todayAiCalls: number;
  /** 处理中任务数 */
  pendingTasks: number;
  /** 系统负载(0-1) */
  systemLoad: number;
  /** 最近 5 分钟请求量 */
  recentRequests: number;
  /** 统计时间戳 */
  timestamp: ISODateString;
}

/** GET /api/admin/stats/tenant/:id 响应 */
export interface AdminTenantStats {
  tenantId: string;
  tenantName: string;
  /** 租户内用户数 */
  userCount: number;
  /** 租户内作品数 */
  artworkCount: number;
  /** 当月 AI 调用量 */
  monthlyAiCalls: number;
  /** 当月配额上限 */
  monthlyQuota: number;
  /** 配额使用率(0-1) */
  quotaUsageRate: number;
  /** 席位使用数 */
  usedSeats: number;
  /** 席位上限 */
  maxSeats: number;
  /** 当前订阅计划 */
  plan: TenantPlan;
  /** 最近 7 日作品数 */
  last7dArtworks: number;
  /** 平均作品评分 */
  avgScore: number;
}

// ---------- 3.10.5 系统管理 ----------

/** 管理后台租户列表项 */
export interface AdminTenantListItem {
  id: string;
  name: string;
  type: TenantType;
  feishuTenantKey: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  maxSeats: number;
  parentId: string | null;
  createdAt: ISODateString;
  /** 成员数(冗余字段,便于列表展示) */
  memberCount: number;
}

/** GET /api/admin/system/tenants 查询参数 */
export interface ListAdminTenantsQuery extends PaginationQuery {
  search?: string;
  type?: TenantType;
  plan?: TenantPlan;
  status?: TenantStatus;
}

/** GET /api/admin/system/tenants 响应 */
export type ListAdminTenantsResponse = PaginatedData<AdminTenantListItem>;

/** POST /api/admin/system/tenants 请求 */
export interface CreateAdminTenantRequest {
  name: string;
  type: TenantType;
  plan?: TenantPlan;
  maxSeats?: number;
  parentId?: string;
  feishuTenantKey?: string;
}

/** POST /api/admin/system/tenants 响应 */
export interface CreateAdminTenantResponse {
  id: string;
  name: string;
  type: TenantType;
  plan: TenantPlan;
  status: TenantStatus;
  maxSeats: number;
  createdAt: ISODateString;
}

/** PATCH /api/admin/system/tenants/:id 请求 */
export interface UpdateAdminTenantRequest {
  name?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
  maxSeats?: number;
}

/** PATCH /api/admin/system/tenants/:id 响应 */
export type UpdateAdminTenantResponse = CreateAdminTenantResponse;

/** 审计日志信息 */
export interface AuditLogInfo {
  id: string;
  operatorId: string;
  operatorRole: string;
  operatorTenantId: string | null;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  targetTenantId: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ip: string;
  userAgent: string;
  traceId: string | null;
  note: string | null;
  createdAt: ISODateString;
}

/** GET /api/admin/system/audit-logs 查询参数 */
export interface ListAuditLogsQuery extends PaginationQuery {
  operatorId?: string;
  action?: AuditAction;
  resource?: string;
  resourceId?: string;
  targetTenantId?: string;
  startDate?: ISODateString;
  endDate?: ISODateString;
}

/** GET /api/admin/system/audit-logs 响应 */
export type ListAuditLogsResponse = PaginatedData<AuditLogInfo>;

/** API 密钥信息(列表项,不含完整密钥) */
export interface ApiKeyInfo {
  id: string;
  name: string;
  /** 密钥前缀(如 dk_abcd12) */
  keyPrefix: string;
  tenantId: string | null;
  scopes: string[];
  status: ApiKeyStatus;
  createdById: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  expiresAt: ISODateString | null;
  revokedAt: ISODateString | null;
  lastUsedAt: ISODateString | null;
}

/** GET /api/admin/system/api-keys 查询参数 */
export interface ListApiKeysQuery extends PaginationQuery {
  status?: ApiKeyStatus;
  tenantId?: string;
}

/** GET /api/admin/system/api-keys 响应 */
export type ListApiKeysResponse = PaginatedData<ApiKeyInfo>;

/** POST /api/admin/system/api-keys 请求 */
export interface CreateApiKeyRequest {
  name: string;
  scopes: string[];
  tenantId?: string;
  /** 过期天数(null=永不过期) */
  expiresAfterDays?: number | null;
}

/** POST /api/admin/system/api-keys 响应 */
export interface CreateApiKeyResponse extends ApiKeyInfo {
  /** 完整密钥(仅创建时返回一次,后续不可获取) */
  plainKey: string;
}

/** DELETE /api/admin/system/api-keys/:id 响应 */
export interface RevokeApiKeyResponse {
  id: string;
  status: ApiKeyStatus;
  revokedAt: ISODateString;
}

/** GET /api/admin/system/health 响应 */
export interface AdminSystemHealth {
  status: 'up' | 'degraded' | 'down';
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    aiService: 'up' | 'down' | 'disabled';
  };
  /** 进程运行时间(秒) */
  uptime: number;
  /** 内存使用(MB) */
  memoryUsageMb: number;
  /** Node.js 版本 */
  nodeVersion: string;
  timestamp: ISODateString;
}

// ============================================================
// 3.11 预留接口类型(Phase 5,4 类预留扩展点)
//
// 设计原则:
//   - 仅追加新类型,不修改现有类型(向后兼容)
//   - 所有预留接口当前返回 501 NOT_IMPLEMENTED + ErrorCode.NOT_IMPLEMENTED(9901)
//   - 类型定义必须完整:请求参数/响应格式/错误码全部声明
//   - 预留接口需经 authMiddleware 鉴权,并按角色配置权限
//   - 版本控制:v1 预留接口骨架 → v2 实现具体业务逻辑
//
// 4 类预留接口:
//   1. 知识库实时检索(/api/v1/knowledge)
//   2. 模块化功能扩展(/api/v1/modules)
//   3. UI 配置与组件数据(/api/v1/ui)
//   4. 功能参数与流程控制(/api/v1/config)
// ====================================================================

// ---------- 3.11.1 知识库实时检索(预留) ----------
//
/**
 * @reserved 预留接口
 * @status planned
 * @target_version v2.0
 * @description 知识库实时检索功能
 * @future_direction 支持 ES/向量检索,提供艺术知识库智能问答
 */

/** 知识条目来源类型 */
export type KnowledgeSource = 'manual' | 'imported' | 'ai-generated' | 'external';

/** 知识条目状态 */
export type KnowledgeStatus = 'draft' | 'published' | 'archived';

/** 知识条目详情 */
export interface KnowledgeEntry {
  id: string;
  tenantId: string;
  /** 条目标题 */
  title: string;
  /** 摘要 */
  summary: string;
  /** 正文内容(Markdown) */
  content: string;
  /** 关联作品类型 */
  artType: ArtType | null;
  /** 关联艺术品 ID(可选) */
  artworkId: string | null;
  /** 标签列表 */
  tags: string[];
  /** 分类 */
  category: string;
  /** 来源 */
  source: KnowledgeSource;
  /** 状态 */
  status: KnowledgeStatus;
  /** 创建人 ID */
  createdById: string;
  /** 最后更新人 ID */
  updatedById: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** 全文检索相关性分数(仅搜索接口返回,0-1) */
  score?: number;
}

/** GET /knowledge/search 查询参数 */
export interface KnowledgeSearchQuery extends PaginationQuery {
  /** 关键词(全文检索) */
  q?: string;
  /** 标签筛选(逗号分隔,AND 语义) */
  tags?: string;
  /** 分类筛选 */
  category?: string;
  /** 作品类型筛选 */
  artType?: ArtType;
  /** 状态筛选(默认 published) */
  status?: KnowledgeStatus;
  /** 是否启用语义检索(向量) */
  semantic?: boolean;
}

/** GET /knowledge/search 响应 */
export type KnowledgeSearchResponse = PaginatedData<KnowledgeEntry>;

/** GET /knowledge/:id 响应 */
export type GetKnowledgeResponse = KnowledgeEntry;

/** POST /knowledge 请求体(创建知识条目) */
export interface CreateKnowledgeRequest {
  title: string;
  summary: string;
  content: string;
  artType?: ArtType | null;
  artworkId?: string | null;
  tags?: string[];
  category: string;
  source?: KnowledgeSource;
  status?: KnowledgeStatus;
}

/** POST /knowledge 响应 */
export type CreateKnowledgeResponse = KnowledgeEntry;

/** PATCH /knowledge/:id 请求体(部分更新) */
export interface UpdateKnowledgeRequest {
  title?: string;
  summary?: string;
  content?: string;
  artType?: ArtType | null;
  artworkId?: string | null;
  tags?: string[];
  category?: string;
  status?: KnowledgeStatus;
}

/** PATCH /knowledge/:id 响应 */
export type UpdateKnowledgeResponse = KnowledgeEntry;

/** DELETE /knowledge/:id 响应 */
export interface DeleteKnowledgeResponse {
  id: string;
  deleted: boolean;
}

/** POST /knowledge/index/rebuild 响应 */
export interface KnowledgeIndexRebuildResponse {
  /** 重建任务 ID(异步) */
  taskId: string;
  /** 已重建文档数 */
  rebuiltCount: number;
  /** 索引状态 */
  status: 'rebuilding' | 'completed' | 'failed';
  startedAt: ISODateString;
}

/** GET /knowledge/index/status 响应 */
export interface KnowledgeIndexStatus {
  /** 索引是否就绪 */
  ready: boolean;
  /** 索引类型 */
  indexType: 'none' | 'keyword' | 'elastic' | 'vector';
  /** 总文档数 */
  totalDocs: number;
  /** 已索引文档数 */
  indexedDocs: number;
  /** 最后构建时间 */
  lastBuildAt: ISODateString | null;
  /** 当前是否在重建中 */
  rebuilding: boolean;
}

/** POST /knowledge/search/validate 请求体 */
export interface KnowledgeSearchValidateRequest {
  /** 待校验的查询条件 */
  query: KnowledgeSearchQuery;
  /** 当前用户角色(由 token 推断,可不传) */
  role?: UserRole;
}

/** POST /knowledge/search/validate 响应 */
export interface KnowledgeSearchValidateResponse {
  /** 是否允许搜索 */
  allowed: boolean;
  /** 拒绝原因(allowed=false 时非空) */
  reason: string | null;
  /** 校准后的查询条件(注入租户隔离等) */
  sanitizedQuery: KnowledgeSearchQuery;
}

// ---------- 3.11.2 模块化功能扩展(预留) ----------
//
/**
 * @reserved 预留接口
 * @status planned
 * @target_version v2.0
 * @description 模块化功能扩展点
 * @future_direction 支持插件式模块加载,允许第三方扩展功能
 */

/** 模块状态 */
export type ModuleStatus = 'installed' | 'enabled' | 'disabled' | 'error';

/** 模块来源 */
export type ModuleSource = 'builtin' | 'marketplace' | 'custom';

/** 模块信息(已安装) */
export interface ModuleInfo {
  /** 模块唯一标识(如 danqing-analysis-pro) */
  moduleId: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 版本号(SemVer) */
  version: string;
  /** 最低后端版本要求 */
  minServerVersion: string;
  /** 作者 */
  author: string;
  /** 来源 */
  source: ModuleSource;
  /** 当前状态 */
  status: ModuleStatus;
  /** 入口路径 */
  entryPath: string;
  /** 模块声明的能力(权限/路由前缀等) */
  capabilities: string[];
  /** 模块依赖 */
  dependencies: { moduleId: string; version: string }[];
  /** 安装时间 */
  installedAt: ISODateString;
  /** 最后更新时间 */
  updatedAt: ISODateString;
  /** 错误信息(status=error 时非空) */
  errorMessage: string | null;
}

/** 模块配置(键值对,具体结构由模块自定义) */
export interface ModuleConfig {
  moduleId: string;
  /** 配置项(JSON Schema 描述) */
  schema: Record<string, unknown>;
  /** 当前配置值 */
  values: Record<string, unknown>;
  /** 是否启用运行时编辑 */
  editable: boolean;
  updatedAt: ISODateString;
  updatedBy: string;
}

/** 模块注册表条目(市场) */
export interface ModuleRegistryEntry {
  moduleId: string;
  name: string;
  description: string;
  /** 最新版本 */
  latestVersion: string;
  /** 所有可用版本 */
  versions: string[];
  author: string;
  /** 下载/安装量 */
  downloadCount: number;
  /** 评分(0-5) */
  rating: number;
  /** 截图 URL */
  screenshots: string[];
  /** README URL */
  readmeUrl: string;
  /** 是否官方认证 */
  verified: boolean;
  /** 价格(0=免费,单位:元/月) */
  price: number;
  categories: string[];
  /** 发布时间 */
  publishedAt: ISODateString;
  updatedAt: ISODateString;
}

/** GET /modules 响应 */
export type ListModulesResponse = ModuleInfo[];

/** POST /modules/:moduleId/install 请求体 */
export interface InstallModuleRequest {
  /** 安装版本(默认 latest) */
  version?: string;
  /** 安装时初始配置 */
  config?: Record<string, unknown>;
  /** 是否安装后自动启用 */
  autoEnable?: boolean;
}

/** POST /modules/:moduleId/install 响应 */
export type InstallModuleResponse = ModuleInfo;

/** DELETE /modules/:moduleId 响应 */
export interface UninstallModuleResponse {
  moduleId: string;
  uninstalled: boolean;
}

/** GET /modules/:moduleId/config 响应 */
export type GetModuleConfigResponse = ModuleConfig;

/** PATCH /modules/:moduleId/config 请求体 */
export interface UpdateModuleConfigRequest {
  values: Record<string, unknown>;
}

/** PATCH /modules/:moduleId/config 响应 */
export type UpdateModuleConfigResponse = ModuleConfig;

/** POST /modules/:moduleId/enable 响应 */
export interface EnableModuleResponse {
  moduleId: string;
  status: ModuleStatus;
}

/** POST /modules/:moduleId/disable 响应 */
export interface DisableModuleResponse {
  moduleId: string;
  status: ModuleStatus;
}

/** GET /modules/registry 查询参数 */
export interface ListModuleRegistryQuery extends PaginationQuery {
  /** 按分类筛选 */
  category?: string;
  /** 关键词搜索 */
  q?: string;
  /** 仅显示免费模块 */
  freeOnly?: boolean;
  /** 仅显示已认证 */
  verifiedOnly?: boolean;
}

/** GET /modules/registry 响应 */
export type ListModuleRegistryResponse = PaginatedData<ModuleRegistryEntry>;

// ---------- 3.11.3 UI 配置与组件数据(预留) ----------
//
/**
 * @reserved 预留接口
 * @status planned
 * @target_version v2.0
 * @description UI 配置与组件数据传递
 * @future_direction 支持主题切换、布局自定义、看板组件化配置
 */

/** 主题类型 */
export type ThemeMode = 'light' | 'dark' | 'auto';

/** 主题配置 */
export interface ThemeConfig {
  /** 主题标识(如 default / midnight / ocean) */
  themeId: string;
  /** 显示名称 */
  name: string;
  /** 模式 */
  mode: ThemeMode;
  /** 主色(HEX) */
  primaryColor: string;
  /** 辅色(HEX) */
  secondaryColor: string;
  /** 强调色(HEX) */
  accentColor: string;
  /** 背景色 */
  backgroundColor: string;
  /** 文字颜色 */
  textColor: string;
  /** 圆角(px) */
  borderRadius: number;
  /** 字体族 */
  fontFamily: string;
  /** 是否当前激活 */
  active: boolean;
  updatedAt: ISODateString;
  updatedBy: string;
}

/** 主题列表项(简化) */
export interface ThemeListItem {
  themeId: string;
  name: string;
  mode: ThemeMode;
  /** 缩略图预览 */
  previewUrl: string;
  /** 是否官方提供 */
  official: boolean;
  /** 是否当前激活 */
  active: boolean;
}

/** 组件数据(动态组件渲染数据) */
export interface ComponentData {
  /** 组件唯一标识(如 analysis-chart / user-growth-card) */
  componentId: string;
  /** 组件类型 */
  type: string;
  /** 组件标题 */
  title: string;
  /** 配置数据(JSON Schema 描述) */
  schema: Record<string, unknown>;
  /** 当前配置值 */
  props: Record<string, unknown>;
  /** 数据源 URL(组件运行时拉取) */
  dataSourceUrl: string | null;
  /** 刷新间隔(秒,0=不刷新) */
  refreshInterval: number;
  updatedAt: ISODateString;
  updatedBy: string;
}

/** 布局配置(看板栅格布局) */
export interface LayoutConfig {
  /** 布局标识 */
  layoutId: string;
  /** 适用页面 */
  page: string;
  /** 栅格列数(12/24) */
  columns: number;
  /** 间距(px) */
  gutter: number;
  /** 子组件位置 */
  widgets: LayoutWidget[];
  updatedAt: ISODateString;
  updatedBy: string;
}

/** 布局子组件位置 */
export interface LayoutWidget {
  /** 组件 ID(对应 ComponentData.componentId) */
  componentId: string;
  /** 栅格 x 坐标 */
  x: number;
  /** 栅格 y 坐标 */
  y: number;
  /** 宽度(列数) */
  w: number;
  /** 高度(行数) */
  h: number;
  /** 是否可移动 */
  movable: boolean;
  /** 是否可调整大小 */
  resizable: boolean;
}

/** 个性化看板配置 */
export interface DashboardConfig {
  /** 用户 ID */
  userId: string;
  /** 租户 ID */
  tenantId: string;
  /** 看板布局 ID */
  layoutId: string;
  /** 启用的组件 ID 列表 */
  enabledComponents: string[];
  /** 用户自定义配置覆盖 */
  overrides: Record<string, Record<string, unknown>>;
  updatedAt: ISODateString;
}

/** GET /ui/theme 响应 */
export type GetCurrentThemeResponse = ThemeConfig;

/** PATCH /ui/theme 请求体 */
export interface UpdateThemeRequest {
  themeId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: number;
  fontFamily?: string;
  mode?: ThemeMode;
}

/** PATCH /ui/theme 响应 */
export type UpdateThemeResponse = ThemeConfig;

/** GET /ui/themes 响应 */
export type ListThemesResponse = ThemeListItem[];

/** GET /ui/components/:componentId 响应 */
export type GetComponentDataResponse = ComponentData;

/** PUT /ui/components/:componentId 请求体 */
export interface UpdateComponentDataRequest {
  title?: string;
  props?: Record<string, unknown>;
  dataSourceUrl?: string | null;
  refreshInterval?: number;
}

/** PUT /ui/components/:componentId 响应 */
export type UpdateComponentDataResponse = ComponentData;

/** GET /ui/layout 响应 */
export type GetLayoutResponse = LayoutConfig;

/** PATCH /ui/layout 请求体 */
export interface UpdateLayoutRequest {
  columns?: number;
  gutter?: number;
  widgets?: LayoutWidget[];
}

/** PATCH /ui/layout 响应 */
export type UpdateLayoutResponse = LayoutConfig;

/** GET /ui/dashboard/:userId 响应 */
export type GetDashboardResponse = DashboardConfig;

/** PATCH /ui/dashboard/:userId 请求体 */
export interface UpdateDashboardRequest {
  layoutId?: string;
  enabledComponents?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

/** PATCH /ui/dashboard/:userId 响应 */
export type UpdateDashboardResponse = DashboardConfig;

// ---------- 3.11.4 功能参数与流程控制(预留) ----------
//
/**
 * @reserved 预留接口
 * @status planned
 * @target_version v2.0
 * @description 功能参数调整与流程控制
 * @future_direction 支持 feature flag 灰度发布、系统参数热更新、工作流编排
 */

/** 功能开关类型 */
export type FeatureFlagType = 'boolean' | 'percentage' | 'user-list' | 'tenant-list';

/** 功能开关状态 */
export type FeatureFlagStatus = 'enabled' | 'disabled' | 'gradual';

/** 功能开关 */
export interface FeatureFlag {
  /** 功能标识(如 new-analysis-engine) */
  featureId: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 类型 */
  type: FeatureFlagType;
  /** 状态 */
  status: FeatureFlagStatus;
  /** 当前值(boolean / 百分比 0-100 / 用户ID列表 / 租户ID列表) */
  value: boolean | number | string[];
  /** 默认值(关闭时回退) */
  defaultValue: boolean | number | string[];
  /** 灰度目标用户(列表) */
  targetUserIds: string[];
  /** 灰度目标租户(列表) */
  targetTenantIds: string[];
  /** 创建人 */
  createdById: string;
  /** 最后更新人 */
  updatedById: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** 系统参数 */
export interface SystemParam {
  /** 参数键(如 analysis.timeout.ms) */
  paramKey: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 参数值(字符串存储,运行时按 valueType 转换) */
  value: string;
  /** 值类型 */
  valueType: 'string' | 'number' | 'boolean' | 'json' | 'enum';
  /** 枚举可选值(valueType=enum 时非空) */
  enumOptions: string[];
  /** 单位(可选) */
  unit: string | null;
  /** 是否需要重启生效 */
  requireRestart: boolean;
  /** 是否敏感(不在前端展示) */
  sensitive: boolean;
  updatedAt: ISODateString;
  updatedBy: string;
}

/** 工作流定义 */
export interface WorkflowDefinition {
  id: string;
  /** 工作流名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 触发条件(JSON DSL) */
  trigger: Record<string, unknown>;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 当前是否启用 */
  enabled: boolean;
  /** 版本号 */
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** 工作流步骤 */
export interface WorkflowStep {
  /** 步骤 ID(工作流内唯一) */
  stepId: string;
  /** 步骤名称 */
  name: string;
  /** 动作类型(http-call / db-query / ai-call / delay / condition) */
  action: string;
  /** 动作参数 */
  params: Record<string, unknown>;
  /** 下一步骤 ID(null=结束) */
  nextStepId: string | null;
  /** 超时(秒) */
  timeoutSec: number;
  /** 重试次数 */
  retryCount: number;
}

/** 工作流执行状态 */
export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'canceled';

/** 工作流执行记录 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  /** 触发人 ID */
  triggeredBy: string;
  status: WorkflowExecutionStatus;
  /** 输入参数 */
  input: Record<string, unknown>;
  /** 输出结果 */
  output: Record<string, unknown> | null;
  /** 各步骤执行结果 */
  stepResults: WorkflowStepResult[];
  /** 错误信息(status=failed 时非空) */
  errorMessage: string | null;
  /** 开始时间 */
  startedAt: ISODateString;
  /** 结束时间 */
  finishedAt: ISODateString | null;
  /** 总耗时(毫秒) */
  durationMs: number | null;
}

/** 单步骤执行结果 */
export interface WorkflowStepResult {
  stepId: string;
  stepName: string;
  status: WorkflowExecutionStatus;
  /** 输出 */
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: ISODateString;
  finishedAt: ISODateString | null;
  durationMs: number | null;
}

/** GET /config/features 查询参数 */
export interface ListFeatureFlagsQuery {
  /** 按状态筛选 */
  status?: FeatureFlagStatus;
  /** 关键词搜索 */
  q?: string;
}

/** GET /config/features 响应 */
export type ListFeatureFlagsResponse = FeatureFlag[];

/** PATCH /config/features/:featureId 请求体 */
export interface UpdateFeatureFlagRequest {
  status?: FeatureFlagStatus;
  value?: boolean | number | string[];
  targetUserIds?: string[];
  targetTenantIds?: string[];
}

/** PATCH /config/features/:featureId 响应 */
export type UpdateFeatureFlagResponse = FeatureFlag;

/** GET /config/params 查询参数 */
export interface ListSystemParamsQuery {
  /** 关键词搜索 */
  q?: string;
  /** 按值类型筛选 */
  valueType?: SystemParam['valueType'];
  /** 是否包含敏感参数(默认 false) */
  includeSensitive?: boolean;
}

/** GET /config/params 响应 */
export type ListSystemParamsResponse = SystemParam[];

/** PATCH /config/params/:paramKey 请求体 */
export interface UpdateSystemParamRequest {
  value: string;
}

/** PATCH /config/params/:paramKey 响应 */
export type UpdateSystemParamResponse = SystemParam;

/** GET /config/workflows 查询参数 */
export interface ListWorkflowsQuery extends PaginationQuery {
  /** 是否启用筛选 */
  enabled?: boolean;
  /** 关键词搜索 */
  q?: string;
}

/** GET /config/workflows 响应 */
export type ListWorkflowsResponse = PaginatedData<WorkflowDefinition>;

/** POST /config/workflows 请求体 */
export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  trigger: Record<string, unknown>;
  steps: WorkflowStep[];
  enabled?: boolean;
}

/** POST /config/workflows 响应 */
export type CreateWorkflowResponse = WorkflowDefinition;

/** PATCH /config/workflows/:id 请求体 */
export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  trigger?: Record<string, unknown>;
  steps?: WorkflowStep[];
  enabled?: boolean;
}

/** PATCH /config/workflows/:id 响应 */
export type UpdateWorkflowResponse = WorkflowDefinition;

/** GET /config/workflows/:id/executions 查询参数 */
export interface ListWorkflowExecutionsQuery extends PaginationQuery {
  /** 按状态筛选 */
  status?: WorkflowExecutionStatus;
  /** 起始时间 */
  startDate?: ISODateString;
  /** 结束时间 */
  endDate?: ISODateString;
}

/** GET /config/workflows/:id/executions 响应 */
export type ListWorkflowExecutionsResponse = PaginatedData<WorkflowExecution>;

/** POST /config/workflows/:id/execute 请求体 */
export interface ExecuteWorkflowRequest {
  /** 执行入参 */
  input: Record<string, unknown>;
  /** 是否异步执行(默认 true) */
  async?: boolean;
}

/** POST /config/workflows/:id/execute 响应(同步模式返回完整结果,异步模式返回执行 ID) */
export interface ExecuteWorkflowResponse {
  executionId: string;
  status: WorkflowExecutionStatus;
  /** 同步模式且有结果时返回;异步模式为 null */
  output: Record<string, unknown> | null;
  /** 总耗时(毫秒,异步模式为 null) */
  durationMs: number | null;
}

// ============================================================
// 3.12 Phase 5 新增类型(自定义评分预设 + 多评委争议仲裁 + 多租户认证扩展)
//
// 设计原则:
//   - 仅追加新类型,不修改现有类型(向后兼容)
//   - 与 Prisma schema 一一对应(arbitration.ts 已定义枚举对齐类型)
//   - 错误码使用 91xx 段(避免与 9001-9005 系统错误码冲突)
//
// 3 大模块:
//   1. 认证扩展(手机 OTP / 邀请码 / 院校管理员账号)
//   2. 评分预设(内置 seed + 用户 fork 派生 + 应用重算)
//   3. 多评委争议仲裁(评审记录 + 争议案件 + 加权裁定)
// ============================================================

// re-export Phase 5 枚举对齐类型(便于 controller/service 直接从 api-contract 引用)
// 同时本地 import 供本文件内类型引用(如 EvaluationPresetSummary 使用 PresetStyle)
import type {
  ReviewerType,
  DisputeLevel,
  DisputeStatus,
  ReviewRecordStatus,
  PresetStyle,
  PresetStage,
  PresetDimension,
  ArbitrationConfig,
  DisputeTriggerReason,
  DisputeFinalScore,
} from './arbitration.js';

export type {
  ReviewerType,
  DisputeLevel,
  DisputeStatus,
  ReviewRecordStatus,
  PresetStyle,
  PresetStage,
  AuthType,
  PresetDimension,
  ArbitrationConfig,
  DisputeTriggerReason,
  DisputeFinalScore,
  ReviewScores,
  DimensionScore,
} from './arbitration.js';

/** 评审维度等级(Phase 5 采用 arbitration.ts 的四档:excellent/good/qualified/needs_improvement) */
export type ReviewLevel = 'excellent' | 'good' | 'qualified' | 'needs_improvement';

// ---------- 3.12.1 认证扩展类型 ----------

/** 手机验证码用途 */
export type PhoneOtpPurpose = 'register' | 'login' | 'bind' | 'reset';

/** POST /auth/phone/otp 请求体 */
export interface PhoneOtpRequest {
  /** 中国手机号正则 /^1[3-9]\d{9}$/ */
  phone: string;
  purpose: PhoneOtpPurpose;
  /** bind 场景必传 */
  tenantId?: string;
}

/** POST /auth/phone/otp 响应 */
export interface PhoneOtpResponse {
  sent: boolean;
  /** 重发冷却秒数 */
  resendAfter: number;
  /** 验证码过期时间(ISO 8601) */
  expiresAt: ISODateString;
}

/** POST /auth/phone/verify 请求体 */
export interface PhoneVerifyRequest {
  phone: string;
  /** 6 位数字 */
  code: string;
  purpose: PhoneOtpPurpose;
  /** register 场景可带邀请码直接加入租户 */
  invitationCode?: string;
  /** register 场景设置用户名 */
  name?: string;
}

/** POST /auth/phone/verify 响应(复用飞书回调结构) */
export type PhoneVerifyResponse = FeishuCallbackResponse;

/** POST /auth/invitation/redeem 请求体 */
export interface InvitationRedeemRequest {
  code: string;
  name?: string;
}

/** POST /auth/invitation/redeem 响应 */
export type InvitationRedeemResponse = FeishuCallbackResponse;

/** POST /auth/register/admin 请求体 */
export interface AdminRegisterRequest {
  email: string;
  /** ≥8 位,含大小写+数字 */
  password: string;
  name: string;
  /** 院校管理员邀请码 */
  invitationCode: string;
  /** 新建租户名称(若邀请码允许建租户) */
  tenantName?: string;
}

/** POST /auth/login/admin 请求体 */
export interface AdminLoginRequest {
  email: string;
  password: string;
}

/** POST /auth/login/admin 响应 */
export type AdminLoginResponse = FeishuCallbackResponse;

/** POST /auth/phone/bind 请求体 */
export interface PhoneBindRequest {
  phone: string;
  code: string;
}

// ---------- 3.12.2 评分预设类型 ----------

/** GET /presets 响应项(精简) */
export interface EvaluationPresetSummary {
  id: string;
  name: string;
  description: string | null;
  styleType: PresetStyle;
  artType: ArtType;
  applicableStage: PresetStage;
  isBuiltIn: boolean;
  isPrivate: boolean;
  forkedFromId: string | null;
  creatorId: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** GET /presets/:id 响应(完整) */
export interface EvaluationPresetDetail extends EvaluationPresetSummary {
  dimensions: PresetDimension[];
  /** 预设理由(创建时可选填写) */
  rationale: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** POST /presets 请求体 */
export interface CreatePresetRequest {
  name: string;
  description?: string;
  styleType: PresetStyle;
  artType: ArtType;
  dimensions: PresetDimension[];
  applicableStage: PresetStage;
  isPrivate?: boolean;
}

/** POST /presets/:id/fork 请求体 */
export interface ForkPresetRequest {
  name: string;
  description?: string;
  /** 覆盖的权重(可选,不传则完全复制源预设) */
  dimensions?: PresetDimension[];
  isPrivate?: boolean;
}

/** PATCH /presets/:id 请求体 */
export interface UpdatePresetRequest {
  name?: string;
  description?: string;
  dimensions?: PresetDimension[];
  applicableStage?: PresetStage;
  isPrivate?: boolean;
  enabled?: boolean;
}

/** POST /presets/apply 请求体 */
export interface ApplyPresetRequest {
  /** 已有分析结果 ID */
  analysisId: string;
  /** 要应用的预设 ID */
  presetId: string;
}

/** POST /presets/apply 响应 */
export interface ApplyPresetResponse {
  /** 按预设权重重算后的加权总分 */
  weightedScore: number;
  /** 各维度加权明细 */
  weightedDimensions: {
    key: string;
    label: string;
    originalScore: number;
    weight: number;
    weightedContribution: number;
  }[];
  /** 使用的预设信息 */
  appliedPreset: EvaluationPresetSummary;
}

// ---------- 3.12.3 评委评审类型 ----------

/** 评审评分结构(与 ReviewScores 对齐,用于 API 契约) */
export interface ReviewScoresPayload {
  dimensions: Record<
    string,
    {
      score: number;
      level: ReviewLevel;
      note?: string;
    }
  >;
  overallScore: number;
}

/** POST /analyses/:id/reviews 请求体 */
export interface CreateReviewRequest {
  reviewerType: ReviewerType;
  presetId?: string;
  scores: ReviewScoresPayload;
  /** AI 评审时必传 0-1 */
  confidence?: number;
  comment?: string;
  /** 默认 submitted */
  status?: 'draft' | 'submitted';
}

/** GET /analyses/:id/reviews 响应项 */
export interface ReviewRecordSummary {
  id: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerType: ReviewerType;
  presetId: string | null;
  scores: ReviewScoresPayload;
  confidence: number | null;
  comment: string | null;
  status: ReviewRecordStatus;
  createdAt: ISODateString;
}

/** POST /analyses/:id/disputes/check 响应 */
export interface DisputeCheckResponse {
  /** 是否触发争议 */
  triggered: boolean;
  /** 触发级别 */
  level: DisputeLevel | null;
  /** 触发原因 */
  reason: {
    totalRange: number;
    dimDiffs: Record<string, number>;
    gradeCrossCount: number;
  } | null;
  /** 已创建的争议案件 ID(触发时非空) */
  disputeCaseId: string | null;
  /** 当前评审数量 */
  reviewCount: number;
}

// ---------- 3.12.4 争议仲裁类型 ----------

/** GET /disputes 查询参数 */
export interface DisputeListQuery extends PaginationQuery {
  status?: DisputeStatus;
  level?: DisputeLevel;
  analysisId?: string;
}

/** GET /disputes/:id 响应 */
export interface DisputeCaseDetail {
  id: string;
  analysisId: string;
  triggerLevel: DisputeLevel;
  triggerReason: DisputeTriggerReason;
  status: DisputeStatus;
  reviews: ReviewRecordSummary[];
  arbitrationConfig: ArbitrationConfig;
  finalScore: DisputeFinalScore | null;
  resolvedBy: string | null;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
}

/** POST /disputes/:id/resolve 请求体 */
export interface ResolveDisputeRequest {
  /** 裁定规则:weighted=加权 / majority=多数决 / unanimous=一致 */
  rule: 'weighted' | 'majority' | 'unanimous';
  /** 是否手动覆盖最终分(可选) */
  overrideScore?: {
    overallScore: number;
    dimensions: Record<string, number>;
    note: string;
  };
}

/** POST /disputes/:id/resolve 响应 */
export type ResolveDisputeResponse = DisputeCaseDetail;

/** POST /disputes/:id/apply-result 响应 */
export interface ApplyDisputeResultResponse {
  disputeId: string;
  analysisId: string;
  appliedScore: number;
  applied: boolean;
}

// ---------- 3.12.5 院校管理扩展类型 ----------

/** POST /admin/tenants/:id/invitations 请求体 */
export interface CreateInvitationRequest {
  role: UserRole;
  /** 1-100 */
  maxUses: number;
  /** 有效时长(小时) */
  expiresHours: number;
}

/** GET /admin/tenants/:id/invitations 响应项 */
export interface InvitationCodeSummary {
  id: string;
  code: string;
  tenantId: string;
  role: UserRole;
  maxUses: number;
  usedCount: number;
  expiresAt: ISODateString;
  createdBy: string;
  createdAt: ISODateString;
}

/** POST /admin/tenants/:id/students/batch 请求体 */
export interface BatchImportStudentsRequest {
  students: {
    name: string;
    phone?: string;
    email?: string;
  }[];
  /** 默认 student */
  role?: UserRole;
}

/** POST /admin/tenants/:id/students/batch 响应 */
export interface BatchImportStudentsResponse {
  imported: number;
  failed: { name: string; reason: string }[];
  /** 每个学生一个邀请码 */
  invitationCodes: { name: string; code: string }[];
}

/** POST /admin/presets/:id/override 请求体 */
export interface OverridePresetRequest {
  name: string;
  description?: string;
  dimensions: PresetDimension[];
  isPrivate?: boolean;
}

/** GET /admin/presets 响应项(含全局+租户) */
export type AdminPresetListItem = EvaluationPresetDetail;

/** GET /admin/presets 响应 */
export type ListAdminPresetsResponse = AdminPresetListItem[];

// ---------- 3.12.6 AI 用量统计类型(用量统计模块) ----------

/**
 * AI 用量统计通用查询参数
 *   - startDate / endDate:YYYY-MM-DD 闭区间,可空表示不限
 *   - days:trend 专用,最近 N 天(1-90,默认 7)
 *   - limit:by-user 专用,Top N(1-100,默认 10)
 */
export interface AdminAiUsageQuery {
  startDate?: string;
  endDate?: string;
  days?: number;
  limit?: number;
}

/** GET /api/admin/stats/ai-usage/overview 响应 */
export interface AdminAiUsageOverviewResponse {
  startDate: string | null;
  endDate: string | null;
  /** 总调用次数 */
  totalCount: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failedCount: number;
  /** 成功率(0-1) */
  successRate: number;
  /** 总输入 token 数 */
  totalPromptTokens: number;
  /** 总输出 token 数 */
  totalCompletionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 总成本(元) */
  totalCostYuan: number;
  /** 平均耗时(ms) */
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-provider 单项 */
export interface AdminAiUsageProviderStat {
  provider: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostYuan: number;
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-provider 响应 */
export interface AdminAiUsageByProviderResponse {
  startDate: string | null;
  endDate: string | null;
  stats: AdminAiUsageProviderStat[];
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/by-user 单项 */
export interface AdminAiUsageUserStat {
  userId: string;
  userName: string;
  userEmail: string | null;
  userRole: UserRole | null;
  tenantId: string | null;
  tenantName: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalTokens: number;
  totalCostYuan: number;
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-user 响应 */
export interface AdminAiUsageByUserResponse {
  startDate: string | null;
  endDate: string | null;
  limit: number;
  stats: AdminAiUsageUserStat[];
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/trend 单日数据点 */
export interface AdminAiUsageTrendPoint {
  /** YYYY-MM-DD */
  date: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalTokens: number;
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/trend 响应 */
export interface AdminAiUsageTrendResponse {
  days: number;
  dataPoints: AdminAiUsageTrendPoint[];
  totalCostYuan: number;
}

// ============================================================
// 3.13 通知系统类型(任务包 B:通知系统真实数据接入)
//
// 设计原则:
//   - 多租户强制:每条通知归属 (tenantId, userId),查询必带两者过滤
//   - 游标分页:按 createdAt DESC + id DESC,nextCursor 编码
//   - 3 秒 SLA:索引覆盖 (tenantId,userId,readAt) 与 (tenantId,userId,createdAt)
//   - 仅追加新类型,不修改现有类型(向后兼容)
//
// 对应 API:
//   GET    /notifications                通知列表(游标分页)
//   GET    /notifications/unread-count   未读计数
//   PATCH  /notifications/:id/read       单条标记已读
//   POST   /notifications/read-all       全部标记已读
// ============================================================

/** 通知类型(与 Prisma NotificationType 枚举一一对应) */
export type NotificationType =
  | 'SYSTEM'
  | 'ANALYSIS_DONE'
  | 'ANALYSIS_FAIL'
  | 'REVIEW'
  | 'SUBSCRIPTION'
  | 'INVITATION';

/** 通知级别(与 Prisma NotificationLevel 枚举一一对应) */
export type NotificationLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

/** 通知条目(对应 Prisma Notification 模型) */
export interface Notification {
  id: string;
  /** 租户 ID(多租户隔离) */
  tenantId: string;
  /** 接收者用户 ID */
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  level: NotificationLevel;
  /** 点击跳转的相对路径(可选) */
  linkUrl?: string | null;
  /** 附加数据(如关联 analysisId / presetId 等) */
  metadata?: Record<string, unknown> | null;
  /** 已读时间(ISO 8601),null 表示未读 */
  readAt: ISODateString | null;
  /** 创建时间(ISO 8601) */
  createdAt: ISODateString;
}

/** GET /notifications 查询参数 */
export interface ListNotificationsQuery {
  /** 每页数量,默认 20,最大 50 */
  limit?: number;
  /** 游标(上一页最后一项的 createdAt+id 编码) */
  cursor?: string;
  /** 仅未读 */
  onlyUnread?: boolean;
}

/** GET /notifications 响应(游标分页) */
export interface NotificationListResponse {
  items: Notification[];
  /** 下一页游标,null 表示无更多数据 */
  nextCursor: string | null;
}

/** GET /notifications/unread-count 响应 */
export interface UnreadCountResponse {
  count: number;
}

/** PATCH /notifications/:id/read 响应(返回更新后的通知) */
export type MarkNotificationReadResponse = Notification;

/** POST /notifications/read-all 响应 */
export interface MarkAllNotificationsReadResponse {
  /** 本次标记已读的条数 */
  count: number;
}

/** createNotification 内部触发入参(供其他 service 调用,非公开 API) */
export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  level?: NotificationLevel;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}

