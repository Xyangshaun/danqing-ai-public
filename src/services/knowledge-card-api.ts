// ============================================================
// 丹青有AI - 知识点卡片 API 封装(参考图混合方案 Phase 3 批次④)
//
// 设计说明(照 grading-profile-api.ts 惯例):
//   复用业务命名空间 /api/v1,中间件链 auth → tenant → rate-limit
//     - GET /knowledge-cards/:id  卡片详情(登录即可;学生端弹层拉取)
//   列表端点限教师及以上(knowledge-card:read),前端学生侧不消费,
//   故此处仅封装详情读取;权限差异由后端路由层保证。
//   相对路径由 api.ts buildUrl 自动拼接 BASE_URL(/api/v1)。
//   类型为前端本地镜像(types/knowledge-card.ts),不改动只读契约副本。
// ============================================================

import { get } from './api';
import type { KnowledgeCard } from '../types/knowledge-card';

/** GET /knowledge-cards/:id - 卡片详情(分步图/讲解/练习/关联作品) */
export function getKnowledgeCard(id: string): Promise<KnowledgeCard> {
  return get<KnowledgeCard>(`/knowledge-cards/${id}`);
}
