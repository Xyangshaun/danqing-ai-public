// ============================================================
// 丹青有AI - 班级管理 API 封装
//
// 设计说明:
//   班级管理复用业务命名空间 /api/v1(与 teacher-api.ts 一致):
//     - POST /classes                                  创建班级(review:write)
//     - GET  /classes                                  我的班级列表(review:read)
//     - GET  /classes/:id                              班级详情 + 成员列表(review:read)
//     - POST /classes/:id/invitations                  生成邀请码(review:write)
//     - GET  /classes/:id/invitations                  邀请码列表(review:read)
//     - GET  /classes/:id/students/:userId/works       学生作品列表(分页,review:read)
//     - POST /classes/:id/students/:userId/works/:analysisId/review
//                                                      教师打分(review:write)
//   学生加入班级复用鉴权域邀请码兑换端点 POST /auth/invitation/redeem。
//   相对路径由 api.ts buildUrl 自动拼接 BASE_URL(/api/v1)。
//   类型为前端本地镜像(与 types/teacher.ts 做法一致),不改动只读契约副本。
// ============================================================

import { get, post } from './api';
import type { FeishuCallbackResponse } from '../types/api-contract';

/* ============================================================
 * 类型定义(本地镜像,字段与 server/src/types/api-contract.ts §3.20 对齐)
 * ============================================================ */

/** 班级信息(ClassSummary 的精简子集,列表/详情共用) */
export interface ClassInfo {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

/** 班级成员(与后端 TenantMemberInfo 对齐,user 取子集) */
export interface ClassMemberInfo {
  userId: string;
  tenantId: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    avatar: string;
    email: string | null;
  };
}

/** 班级邀请码(与后端 ClassInvitationInfo 对齐) */
export interface ClassInvitation {
  id: string;
  code: string;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

/** 学生作品的评审记录(与后端 ClassStudentWorkReview 对齐) */
export interface StudentWorkReview {
  id: string;
  /** null 表示 AI 评审 */
  reviewerId: string | null;
  reviewerType: string;
  scores: {
    dimensions: Record<string, { score: number; level: string; note?: string }>;
    overallScore: number;
  };
  comment: string | null;
  status: string;
  createdAt: string;
}

/** 学生作品(与后端 ClassStudentWorkItem 对齐,result 仅透传不消费) */
export interface StudentWork {
  id: string;
  workType: string;
  imageUrl: string;
  title: string | null;
  status: string;
  /** AI 综合评分(status=success 时非空) */
  overallScore: number | null;
  result?: unknown;
  reviews: StudentWorkReview[];
  createdAt: string;
  completedAt: string | null;
}

/** 班级详情响应(扁平结构:班级字段 + 成员列表,与后端 ClassDetailResponse 对齐) */
export interface ClassDetailResponse extends ClassInfo {
  status: string;
  maxSeats: number;
  members: ClassMemberInfo[];
}

/** 学生作品分页响应(与后端 ListClassStudentWorksResponse 对齐) */
export interface StudentWorksResponse {
  items: StudentWork[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 教师打分请求体 */
export interface ClassReviewRequest {
  reviewerType: 'professor';
  scores: {
    dimensions: Record<string, { score: number; level: string; note?: string }>;
    overallScore: number;
  };
  comment?: string;
}

/**
 * 加入班级结果(POST /auth/invitation/redeem 响应)
 * 已登录用户兑换:服务端为现有账户添加班级成员关系并切换激活租户,
 * 返回新签发的 JWT(租户上下文 = 班级),前端必须 setAccessToken 落盘。
 */
export type JoinClassResult = FeishuCallbackResponse;

/* ============================================================
 * 班级 CRUD
 * ============================================================ */

/** POST /classes - 创建班级 */
export function createClass(body: { name: string; description?: string }): Promise<ClassInfo> {
  return post<ClassInfo>('/classes', body);
}

/** GET /classes - 我的班级列表 */
export function listMyClasses(): Promise<ClassInfo[]> {
  return get<ClassInfo[]>('/classes');
}

/** GET /classes/:id - 班级详情(含成员列表) */
export function getClassDetail(id: string): Promise<ClassDetailResponse> {
  return get<ClassDetailResponse>(`/classes/${id}`);
}

/* ============================================================
 * 邀请码
 * ============================================================ */

/** POST /classes/:id/invitations - 生成邀请码 */
export function createClassInvitation(
  classId: string,
  body?: { maxUses?: number; expiresHours?: number },
): Promise<ClassInvitation> {
  return post<ClassInvitation>(`/classes/${classId}/invitations`, body ?? {});
}

/** GET /classes/:id/invitations - 邀请码列表 */
export function listClassInvitations(classId: string): Promise<ClassInvitation[]> {
  return get<ClassInvitation[]>(`/classes/${classId}/invitations`);
}

/* ============================================================
 * 学生作品与打分
 * ============================================================ */

/** GET /classes/:id/students/:userId/works - 学生作品列表(分页) */
export function getStudentWorks(
  classId: string,
  userId: string,
  query?: { page?: number; limit?: number },
): Promise<StudentWorksResponse> {
  // 展开为新对象字面量,避免可选属性类型与 query index signature 的兼容性问题
  return get<StudentWorksResponse>(`/classes/${classId}/students/${userId}/works`, { ...query });
}

/** POST /classes/:id/students/:userId/works/:analysisId/review - 教师打分 */
export function submitClassReview(
  classId: string,
  userId: string,
  analysisId: string,
  body: ClassReviewRequest,
): Promise<unknown> {
  return post(`/classes/${classId}/students/${userId}/works/${analysisId}/review`, body);
}

/* ============================================================
 * 学生加入班级(复用 auth 邀请码兑换)
 * ------------------------------------------------------------
 * silent:true —— 邀请码错误属于用户输入问题,由 JoinClassPage
 * 内联展示错误,不触发全局 Toast 噪声。
 * ============================================================ */

/** POST /auth/invitation/redeem - 学生通过邀请码加入班级 */
export function joinClassByInvitation(code: string): Promise<JoinClassResult> {
  return post<JoinClassResult>('/auth/invitation/redeem', { code }, { silent: true });
}

/* ============================================================
 * 班级讨论(聊天框 + 分享诊断报告)
 * 权限:review:read(班级成员均可,含学生)
 * ============================================================ */

/** 班级消息类型 */
export type ClassMessageType = 'text' | 'analysis_share';

/** 分享报告快照(发送时点后端冗余) */
export interface ClassMessageSnapshot {
  title: string | null;
  overallScore: number | null;
  imageUrl: string;
  workType: string;
}

/** 班级消息发送者 */
export interface ClassMessageSender {
  id: string;
  name: string;
  avatar: string;
  role: string;
}

/** 班级消息列表项 */
export interface ClassMessage {
  id: string;
  type: ClassMessageType;
  content: string;
  analysisId: string | null;
  snapshot: ClassMessageSnapshot | null;
  sender: ClassMessageSender;
  createdAt: string;
}

/** GET /classes/:id/messages 响应 */
export interface ClassMessagesResponse {
  items: ClassMessage[];
  hasMore: boolean;
}

/** 分享报告详情(AnalysisDetail 精简镜像,用于班级内查看分享报告) */
export interface SharedAnalysisDetail {
  id: string;
  workType: string;
  imageUrl: string;
  title: string | null;
  remark: string | null;
  status: string;
  result: {
    overallScore?: number;
    summary?: string;
    dimensions?: Record<string, { score?: number; level?: string; comment?: string }>;
    suggestions?: { title?: string; description?: string; priority?: string }[];
    aiEnhanced?: boolean;
  } | null;
  createdAt: string;
  completedAt: string | null;
  aiEnhanced?: boolean;
}

/** GET /classes/:id/messages - 拉取班级消息(初始/增量/翻页三模式) */
export function listClassMessages(
  classId: string,
  query?: { after?: string; before?: string; limit?: number },
): Promise<ClassMessagesResponse> {
  return get<ClassMessagesResponse>(`/classes/${classId}/messages`, { ...query });
}

/** POST /classes/:id/messages - 发送班级消息(文本/分享诊断报告) */
export function sendClassMessage(
  classId: string,
  body: { type: ClassMessageType; content?: string; analysisId?: string },
): Promise<ClassMessage> {
  return post<ClassMessage>(`/classes/${classId}/messages`, body);
}

/** GET /classes/:id/shared-analyses/:analysisId - 查看被分享到班级的诊断报告 */
export function getSharedClassAnalysis(
  classId: string,
  analysisId: string,
): Promise<SharedAnalysisDetail> {
  return get<SharedAnalysisDetail>(`/classes/${classId}/shared-analyses/${analysisId}`);
}
