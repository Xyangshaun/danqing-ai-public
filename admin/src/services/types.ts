// ============================================================
// services 类型聚合(从 @/types/api 重导出,便于 service 层引用)
// ============================================================

export type {
  // 用户
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  AdminUserListItem,
  AdminUserDetail,
  UpdateAdminUserRequest,
  UpdateAdminUserResponse,
  LockAdminUserRequest,
  LockAdminUserResponse,
  BatchAdminUsersRequest,
  BatchAdminUsersResponse,
  ListAdminRolesResponse,
  AdminRoleInfo,
  UpdateAdminRoleRequest,
  UpdateAdminRoleResponse,
  // 内容
  ListAdminArtworksQuery,
  ListAdminArtworksResponse,
  AdminArtworkListItem,
  AdminArtworkDetail,
  ReviewArtworkRequest,
  ReviewArtworkResponse,
  DeleteAdminArtworkResponse,
  ListAdminTemplatesQuery,
  ListAdminTemplatesResponse,
  CreativeTemplateInfo,
  CreateTemplateRequest,
  CreateTemplateResponse,
  UpdateTemplateRequest,
  UpdateTemplateResponse,
  DeleteTemplateResponse,
  // 订阅
  ListAdminSubscriptionsQuery,
  ListAdminSubscriptionsResponse,
  AdminSubscriptionListItem,
  AdminSubscriptionDetail,
  AdminCancelSubscriptionResponse,
  AdminRefundRequest,
  AdminRefundResponse,
  ListAdminInvoicesQuery,
  ListAdminInvoicesResponse,
  AdminInvoiceListItem,
  AdminInvoiceDetail,
  ListAdminPlansResponse,
  AdminPlanInfo,
  CreateAdminPlanRequest,
  CreateAdminPlanResponse,
  UpdateAdminPlanRequest,
  UpdateAdminPlanResponse,
  // 看板
  AdminStatsOverview,
  AdminStatsGrowthQuery,
  AdminStatsGrowthResponse,
  AdminStatsRetentionQuery,
  AdminStatsRetentionResponse,
  AdminStatsAiCostQuery,
  AdminStatsAiCostResponse,
  AdminStatsRealtime,
  AdminTenantStats,
  // 可观测性
  MetricsProviderAvailability,
  AiMetricsResponse,
  SlaDailyPoint,
  SlaMetricsResponse,
  // 系统
  ListAdminTenantsQuery,
  ListAdminTenantsResponse,
  AdminTenantListItem,
  CreateAdminTenantRequest,
  CreateAdminTenantResponse,
  UpdateAdminTenantRequest,
  UpdateAdminTenantResponse,
  ListAuditLogsQuery,
  ListAuditLogsResponse,
  AuditLogInfo,
  ListApiKeysQuery,
  ListApiKeysResponse,
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  RevokeApiKeyResponse,
  AdminSystemHealth,
  // 邀请码 / 批量导入(Phase 5)
  AdminInvitationInfo,
  CreateAdminInvitationRequest,
  CreateAdminInvitationResponse,
  ListAdminInvitationsResponse,
  BatchImportStudentItem,
  BatchImportStudentsRequest,
  BatchImportStudentsResponse,
  // 仲裁配置(P-04 / M-1)
  ArbitrationConfig,
  DeepPartial,
  GetTenantArbitrationConfigResponse,
  UpdateTenantArbitrationConfigRequest,
  UpdateTenantArbitrationConfigResponse,
  // 用户在线状态 Presence(M4-ADM-1)
  PresenceState,
  PresenceClient,
  UserPresenceEntry,
  PresenceBatchResponse,
} from '@/types/api';

/** GET /api/admin/users/export 查询参数(无分页) */
export interface ExportAdminUsersQueryLike {
  fields?: string;
  search?: string;
  tenantId?: string;
  role?: 'admin' | 'teacher' | 'student' | 'owner';
  status?: 'active' | 'locked' | 'deleted';
}
