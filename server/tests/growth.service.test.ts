// ============================================================
// 成长曲线服务测试(Supertest 集成 + Service 单元)
// 对应 API:GET /api/v1/growth
//
// 测试维度(12 组用例):
//   G1  : STUDENT 获取自己的成长数据
//   G2  : STUDENT 传 userId 越权 → 忽略,只返回自己的
//   G3  : TEACHER 查看指定学生成长数据
//   G4  : TEACHER 查看租户全部成长数据
//   G5  : 不同 dimension 返回对应维度分数(composition/color/originality/overall)
//   G6  : 不同 timeRange 过滤正确的时间范围(7d/30d/90d/all)
//   G7  : 空数据返回空 dataPoints + summary 全 0
//   G8  : 趋势计算正确(up/down/stable)
//   G9  : 跨租户数据隔离
//   G10 : 鉴权与参数校验
//   G11 : artType 过滤
//   G12 : overallScore 兜底(result 为 null 时用 DB 列)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
  TEST_TENANT_ID_A,
  TEST_TENANT_ID_B,
  TEST_USER_ID_A,
  TEST_USER_ID_B,
  TEST_FEISHU_OPEN_ID_A,
  TEST_FEISHU_OPEN_ID_B,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { growthService } from '../src/services/growth.service.js';

// ============================================================
// 测试常量
// ============================================================

const TEACHER_USER_ID_A = 'u-teacher-growth-001';
const STUDENT_USER_ID_A2 = 'u-student-growth-002';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 构造 painting 分析结果 JSON(含 composition/color/originality/overallScore) */
function buildPaintingResult(scores: {
  composition: number;
  color: number;
  brushwork: number;
  originality: number;
  overall: number;
}): unknown {
  return {
    artType: 'painting',
    dimensions: {
      type: 'painting',
      composition: {
        score: scores.composition,
        focusPoint: { x: 0, y: 0 },
        balance: 'balanced',
        guideline: 'good',
        whitespaceRatio: 0.3,
        symmetry: 0.8,
        suggestion: '',
        heatmapData: [],
      },
      color: {
        score: scores.color,
        warmRatio: 0.5,
        coolRatio: 0.5,
        contrast: 'medium',
        saturation: 'medium',
        richness: 'moderate',
        harmony: '',
        dominantColor: '',
        suggestion: '',
      },
      brushwork: {
        score: scores.brushwork,
        textureLevel: 'moderate',
        strokeVariety: 5,
        wetDryBalance: '',
        suggestion: '',
      },
    },
    originality: {
      score: scores.originality,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '',
    },
    overallScore: scores.overall,
  };
}

/** 构造 design 分析结果 JSON(含 colorApplication,无 composition/color) */
function buildDesignResult(scores: {
  visualHierarchy: number;
  typography: number;
  colorApplication: number;
  originality: number;
  overall: number;
}): unknown {
  return {
    artType: 'design',
    dimensions: {
      type: 'design',
      visualHierarchy: {
        score: scores.visualHierarchy,
        focusPoint: { x: 0, y: 0 },
        primarySecondaryClarity: 'clear',
        informationFlow: 'good',
        heatmapData: [],
        suggestion: '',
      },
      typography: {
        score: scores.typography,
        alignmentQuality: 'good',
        rhythmConsistency: 'good',
        negativeSpaceUsage: 'good',
        gridAdherence: 0.8,
        suggestion: '',
      },
      colorApplication: {
        score: scores.colorApplication,
        contrast: 'medium',
        brandConsistency: 'moderate',
        colorPsychology: '',
        paletteHarmony: '',
        suggestion: '',
      },
    },
    originality: {
      score: scores.originality,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '',
    },
    overallScore: scores.overall,
  };
}

/** 插入一条 painting 分析记录(快捷方法) */
function insertPaintingAnalysis(
  id: string,
  tenantId: string,
  userId: string,
  daysAgo: number,
  scores: { composition: number; color: number; brushwork: number; originality: number; overall: number },
): void {
  prismaMock.__insertAnalysis({
    id,
    tenantId,
    userId,
    workType: 'painting',
    imageUrl: `https://example.com/${id}.jpg`,
    title: id,
    status: 'success',
    result: buildPaintingResult(scores),
    overallScore: scores.overall,
    createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    completedAt: new Date(Date.now() - daysAgo * DAY_MS),
  });
}

/** 插入一条 design 分析记录(快捷方法) */
function insertDesignAnalysis(
  id: string,
  tenantId: string,
  userId: string,
  daysAgo: number,
  scores: { visualHierarchy: number; typography: number; colorApplication: number; originality: number; overall: number },
): void {
  prismaMock.__insertAnalysis({
    id,
    tenantId,
    userId,
    workType: 'design',
    imageUrl: `https://example.com/${id}.jpg`,
    title: id,
    status: 'success',
    result: buildDesignResult(scores),
    overallScore: scores.overall,
    createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    completedAt: new Date(Date.now() - daysAgo * DAY_MS),
  });
}

function authHeaders(accessToken: string): Record<string, string> {
  return buildAuthHeaders(accessToken);
}

// ============================================================
// 测试主体
// ============================================================

describe('growth (成长曲线 API)', () => {
  beforeEach(() => {
    // setup.ts 全局 beforeEach 已清空 mock,这里预置共享数据
    createTestTenant({
      id: TEST_TENANT_ID_A,
      name: '美术学院Growth',
      type: 'college',
      plan: 'standard',
      status: 'active',
      maxSeats: 50,
    });
    createTestTenant({
      id: TEST_TENANT_ID_B,
      name: '美术学院B-Growth',
      type: 'college',
      plan: 'standard',
      status: 'active',
      maxSeats: 50,
    });

    createTestUser({
      id: TEST_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      feishuUnionId: 'on_growth_a',
      name: '学生G1',
      role: 'student',
    });
    createTestUser({
      id: STUDENT_USER_ID_A2,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: 'ou_growth_a2',
      feishuUnionId: 'on_growth_a2',
      name: '学生G2',
      role: 'student',
    });
    createTestUser({
      id: TEACHER_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: 'ou_growth_teacher',
      feishuUnionId: 'on_growth_teacher',
      name: '教师G',
      role: 'teacher',
    });
    createTestUser({
      id: TEST_USER_ID_B,
      tenantId: TEST_TENANT_ID_B,
      feishuOpenId: TEST_FEISHU_OPEN_ID_B,
      feishuUnionId: 'on_growth_b',
      name: '学生B-G',
      role: 'student',
    });
  });

  // ============================================================
  // G1: STUDENT 获取自己的成长数据
  // ============================================================
  describe('G1: STUDENT 获取自己的成长数据', () => {
    it('should_return_own_growth_data_points_sorted_by_date_asc', async () => {
      // 插入 3 条自己的记录(分数递增,模拟进步)
      insertPaintingAnalysis('g-a-001', TEST_TENANT_ID_A, TEST_USER_ID_A, 20, {
        composition: 60, color: 65, brushwork: 62, originality: 68, overall: 64,
      });
      insertPaintingAnalysis('g-a-002', TEST_TENANT_ID_A, TEST_USER_ID_A, 10, {
        composition: 70, color: 72, brushwork: 71, originality: 75, overall: 72,
      });
      insertPaintingAnalysis('g-a-003', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 80, color: 82, brushwork: 79, originality: 85, overall: 82,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'overall', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        dimension: string;
        timeRange: string;
        dataPoints: Array<{ date: string; score: number; analysisId: string; artType: string }>;
        summary: { current: number; average: number; trend: string; change: number; totalAnalyses: number };
      };

      expect(data.dimension).toBe('overall');
      expect(data.timeRange).toBe('all');
      expect(data.dataPoints).toHaveLength(3);
      // 升序排列(最早在前)
      expect(data.dataPoints[0]!.analysisId).toBe('g-a-001');
      expect(data.dataPoints[1]!.analysisId).toBe('g-a-002');
      expect(data.dataPoints[2]!.analysisId).toBe('g-a-003');
      // 分数对应 overall 维度
      expect(data.dataPoints[0]!.score).toBe(64);
      expect(data.dataPoints[1]!.score).toBe(72);
      expect(data.dataPoints[2]!.score).toBe(82);
      // artType 字段
      expect(data.dataPoints[0]!.artType).toBe('painting');
      // summary
      expect(data.summary.current).toBe(82);
      expect(data.summary.totalAnalyses).toBe(3);
      expect(data.summary.trend).toBe('up');
      expect(data.summary.change).toBe(18); // 82 - 64
    });
  });

  // ============================================================
  // G2: STUDENT 传 userId 越权 → 忽略,只返回自己的
  // ============================================================
  describe('G2: STUDENT 传 userId 参数查看他人 → 忽略', () => {
    it('should_ignore_userId_param_for_student_and_return_own_data_only', async () => {
      // 学生 A1 的记录
      insertPaintingAnalysis('g-a-own', TEST_TENANT_ID_A, TEST_USER_ID_A, 2, {
        composition: 75, color: 76, brushwork: 74, originality: 77, overall: 75,
      });
      // 学生 A2 的记录(越权目标)
      insertPaintingAnalysis('g-a2-other', TEST_TENANT_ID_A, STUDENT_USER_ID_A2, 2, {
        composition: 90, color: 91, brushwork: 89, originality: 92, overall: 90,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      // 学生 A1 试图通过 userId 参数查询 A2 的记录
      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ userId: STUDENT_USER_ID_A2, timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }>; summary: { totalAnalyses: number } };

      // service 层强制覆盖:学生角色 effectiveUserId = 自己,忽略 query.userId
      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.analysisId).toBe('g-a-own');
      expect(data.dataPoints[0]!.score).toBe(75);
    });
  });

  // ============================================================
  // G3: TEACHER 查看指定学生成长数据
  // ============================================================
  describe('G3: TEACHER 查看指定学生成长数据', () => {
    it('should_return_specified_student_growth_when_teacher_passes_userId', async () => {
      // 学生 A1 的记录
      insertPaintingAnalysis('g-t-001', TEST_TENANT_ID_A, TEST_USER_ID_A, 5, {
        composition: 60, color: 62, brushwork: 61, originality: 63, overall: 62,
      });
      // 学生 A2 的记录
      insertPaintingAnalysis('g-t-002', TEST_TENANT_ID_A, STUDENT_USER_ID_A2, 5, {
        composition: 88, color: 90, brushwork: 87, originality: 89, overall: 88,
      });

      const tokens = createTestTokenSet({
        userId: TEACHER_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'teacher',
        feishuOpenId: 'ou_growth_teacher',
      });

      // 教师通过 userId 参数查看学生 A1 的成长
      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ userId: TEST_USER_ID_A, timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }>; summary: { totalAnalyses: number } };

      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.analysisId).toBe('g-t-001');
      expect(data.dataPoints[0]!.score).toBe(62);
    });
  });

  // ============================================================
  // G4: TEACHER 查看租户全部成长数据
  // ============================================================
  describe('G4: TEACHER 查看租户全部成长数据', () => {
    it('should_aggregate_all_tenant_students_growth_when_teacher_no_userId', async () => {
      // 两个学生的记录
      insertPaintingAnalysis('g-ag-001', TEST_TENANT_ID_A, TEST_USER_ID_A, 3, {
        composition: 70, color: 71, brushwork: 69, originality: 72, overall: 70,
      });
      insertPaintingAnalysis('g-ag-002', TEST_TENANT_ID_A, STUDENT_USER_ID_A2, 2, {
        composition: 80, color: 81, brushwork: 79, originality: 82, overall: 80,
      });

      const tokens = createTestTokenSet({
        userId: TEACHER_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'teacher',
        feishuOpenId: 'ou_growth_teacher',
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // 教师未传 userId → 聚合租户内所有人
      expect(data.summary.totalAnalyses).toBe(2);
      const ids = data.dataPoints.map((p) => p.analysisId);
      expect(ids).toContain('g-ag-001');
      expect(ids).toContain('g-ag-002');
    });
  });

  // ============================================================
  // G5: 不同 dimension 返回对应维度分数
  // ============================================================
  describe('G5: 不同 dimension 返回对应维度分数', () => {
    beforeEach(() => {
      // 插入一条 painting 记录,各维度分数不同
      insertPaintingAnalysis('g-dim-001', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 65,
        color: 78,
        brushwork: 82,
        originality: 88,
        overall: 75,
      });
      // 插入一条 design 记录(有 colorApplication,无 composition/color)
      insertDesignAnalysis('g-dim-002', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        visualHierarchy: 70,
        typography: 72,
        colorApplication: 85,
        originality: 80,
        overall: 77,
      });
    });

    it('should_return_composition_score_for_painting_when_dimension=composition', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'composition', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }>; summary: { totalAnalyses: number } };

      // composition 仅 painting 有(design 无 dimensions.composition → 跳过)
      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.analysisId).toBe('g-dim-001');
      expect(data.dataPoints[0]!.score).toBe(65);
    });

    it('should_return_color_score_for_painting_and_design_when_dimension=color', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'color', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }>; summary: { totalAnalyses: number } };

      // color:painting → dimensions.color.score(78);design → dimensions.colorApplication.score(85)
      expect(data.summary.totalAnalyses).toBe(2);
      const byId = new Map(data.dataPoints.map((p) => [p.analysisId, p.score]));
      expect(byId.get('g-dim-001')).toBe(78);
      expect(byId.get('g-dim-002')).toBe(85);
    });

    it('should_return_originality_score_when_dimension=originality', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'originality', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }> };

      // originality 所有作品类型共享
      const byId = new Map(data.dataPoints.map((p) => [p.analysisId, p.score]));
      expect(byId.get('g-dim-001')).toBe(88);
      expect(byId.get('g-dim-002')).toBe(80);
    });

    it('should_return_overall_score_when_dimension=overall', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'overall', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }> };

      const byId = new Map(data.dataPoints.map((p) => [p.analysisId, p.score]));
      expect(byId.get('g-dim-001')).toBe(75);
      expect(byId.get('g-dim-002')).toBe(77);
    });
  });

  // ============================================================
  // G6: 不同 timeRange 过滤正确的时间范围
  // ============================================================
  describe('G6: 不同 timeRange 过滤正确的时间范围', () => {
    beforeEach(() => {
      // 插入不同时间的记录:1天前 / 5天前 / 20天前 / 50天前 / 100天前
      insertPaintingAnalysis('g-tr-1d', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 60, color: 60, brushwork: 60, originality: 60, overall: 60,
      });
      insertPaintingAnalysis('g-tr-5d', TEST_TENANT_ID_A, TEST_USER_ID_A, 5, {
        composition: 65, color: 65, brushwork: 65, originality: 65, overall: 65,
      });
      insertPaintingAnalysis('g-tr-20d', TEST_TENANT_ID_A, TEST_USER_ID_A, 20, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      insertPaintingAnalysis('g-tr-50d', TEST_TENANT_ID_A, TEST_USER_ID_A, 50, {
        composition: 75, color: 75, brushwork: 75, originality: 75, overall: 75,
      });
      insertPaintingAnalysis('g-tr-100d', TEST_TENANT_ID_A, TEST_USER_ID_A, 100, {
        composition: 80, color: 80, brushwork: 80, originality: 80, overall: 80,
      });
    });

    it('should_filter_7d_correctly', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: '7d' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // 7d:仅 1天前 + 5天前
      expect(data.summary.totalAnalyses).toBe(2);
      const ids = data.dataPoints.map((p) => p.analysisId);
      expect(ids).toContain('g-tr-1d');
      expect(ids).toContain('g-tr-5d');
      expect(ids).not.toContain('g-tr-20d');
    });

    it('should_filter_30d_correctly', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: '30d' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // 30d:1天前 + 5天前 + 20天前(50天前和100天前排除)
      expect(data.summary.totalAnalyses).toBe(3);
      const ids = data.dataPoints.map((p) => p.analysisId);
      expect(ids).toContain('g-tr-1d');
      expect(ids).toContain('g-tr-5d');
      expect(ids).toContain('g-tr-20d');
      expect(ids).not.toContain('g-tr-50d');
    });

    it('should_filter_90d_correctly', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: '90d' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // 90d:1 + 5 + 20 + 50 天前(100天前排除)
      expect(data.summary.totalAnalyses).toBe(4);
      const ids = data.dataPoints.map((p) => p.analysisId);
      expect(ids).toContain('g-tr-50d');
      expect(ids).not.toContain('g-tr-100d');
    });

    it('should_return_all_records_when_timeRange=all', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // all:全部 5 条
      expect(data.summary.totalAnalyses).toBe(5);
    });
  });

  // ============================================================
  // G7: 空数据返回空 dataPoints + summary 全 0
  // ============================================================
  describe('G7: 空数据返回空 dataPoints + summary 全 0', () => {
    it('should_return_empty_data_points_and_zero_summary_when_no_data', async () => {
      // 不插入任何分析记录
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        dataPoints: unknown[];
        summary: { current: number; average: number; trend: string; change: number; totalAnalyses: number };
      };

      expect(data.dataPoints).toHaveLength(0);
      expect(data.summary.current).toBe(0);
      expect(data.summary.average).toBe(0);
      expect(data.summary.trend).toBe('stable');
      expect(data.summary.change).toBe(0);
      expect(data.summary.totalAnalyses).toBe(0);
    });
  });

  // ============================================================
  // G8: 趋势计算正确(up/down/stable)
  // ============================================================
  describe('G8: 趋势计算正确(up/down/stable)', () => {
    it('should_return_up_trend_when_score_increases', async () => {
      // 分数递增:60 → 70 → 80
      insertPaintingAnalysis('g-up-1', TEST_TENANT_ID_A, TEST_USER_ID_A, 20, {
        composition: 60, color: 60, brushwork: 60, originality: 60, overall: 60,
      });
      insertPaintingAnalysis('g-up-2', TEST_TENANT_ID_A, TEST_USER_ID_A, 10, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      insertPaintingAnalysis('g-up-3', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 80, color: 80, brushwork: 80, originality: 80, overall: 80,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { summary: { trend: string; change: number; current: number; average: number } };

      expect(data.summary.trend).toBe('up');
      expect(data.summary.change).toBe(20); // 80 - 60
      expect(data.summary.current).toBe(80);
      expect(data.summary.average).toBe(70); // (60+70+80)/3 = 70
    });

    it('should_return_down_trend_when_score_decreases', async () => {
      // 分数递减:80 → 70 → 60
      insertPaintingAnalysis('g-dn-1', TEST_TENANT_ID_A, TEST_USER_ID_A, 20, {
        composition: 80, color: 80, brushwork: 80, originality: 80, overall: 80,
      });
      insertPaintingAnalysis('g-dn-2', TEST_TENANT_ID_A, TEST_USER_ID_A, 10, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      insertPaintingAnalysis('g-dn-3', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 60, color: 60, brushwork: 60, originality: 60, overall: 60,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { summary: { trend: string; change: number; current: number } };

      expect(data.summary.trend).toBe('down');
      expect(data.summary.change).toBe(-20); // 60 - 80
      expect(data.summary.current).toBe(60);
    });

    it('should_return_stable_trend_when_score_unchanged', async () => {
      // 分数不变:75 → 75 → 75
      insertPaintingAnalysis('g-st-1', TEST_TENANT_ID_A, TEST_USER_ID_A, 20, {
        composition: 75, color: 75, brushwork: 75, originality: 75, overall: 75,
      });
      insertPaintingAnalysis('g-st-2', TEST_TENANT_ID_A, TEST_USER_ID_A, 10, {
        composition: 75, color: 75, brushwork: 75, originality: 75, overall: 75,
      });
      insertPaintingAnalysis('g-st-3', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 75, color: 75, brushwork: 75, originality: 75, overall: 75,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { summary: { trend: string; change: number; current: number; average: number } };

      expect(data.summary.trend).toBe('stable');
      expect(data.summary.change).toBe(0);
      expect(data.summary.current).toBe(75);
      expect(data.summary.average).toBe(75);
    });
  });

  // ============================================================
  // G9: 跨租户数据隔离
  // ============================================================
  describe('G9: 跨租户数据隔离', () => {
    it('should_not_return_other_tenant_growth_data', async () => {
      // 租户 A 的记录
      insertPaintingAnalysis('g-iso-a', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      // 租户 B 的记录(同 userId 但不同 tenantId)
      insertPaintingAnalysis('g-iso-b', TEST_TENANT_ID_B, TEST_USER_ID_B, 1, {
        composition: 90, color: 90, brushwork: 90, originality: 90, overall: 90,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string }>; summary: { totalAnalyses: number } };

      // 仅租户 A 的记录,不含租户 B
      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.analysisId).toBe('g-iso-a');
    });
  });

  // ============================================================
  // G10: 鉴权与参数校验
  // ============================================================
  describe('G10: 鉴权与参数校验', () => {
    it('should_return_401_when_no_authorization_header', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_return_400_when_dimension_is_invalid', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'invalid_dim' })
        .set(authHeaders(tokens.accessToken))
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_return_400_when_timeRange_is_invalid', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ timeRange: '1y' })
        .set(authHeaders(tokens.accessToken))
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_return_400_when_artType_is_invalid', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ artType: 'photography' })
        .set(authHeaders(tokens.accessToken))
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_use_defaults_when_dimension_and_timeRange_omitted', async () => {
      insertPaintingAnalysis('g-def-1', TEST_TENANT_ID_A, TEST_USER_ID_A, 5, {
        composition: 60, color: 60, brushwork: 60, originality: 60, overall: 65,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      // 不传 dimension 和 timeRange → 默认 overall + 30d
      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dimension: string; timeRange: string; dataPoints: unknown[] };

      expect(data.dimension).toBe('overall');
      expect(data.timeRange).toBe('30d');
      expect(data.dataPoints).toHaveLength(1);
    });
  });

  // ============================================================
  // G11: artType 过滤
  // ============================================================
  describe('G11: artType 过滤', () => {
    it('should_filter_by_artType_painting', async () => {
      insertPaintingAnalysis('g-at-p', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      insertDesignAnalysis('g-at-d', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        visualHierarchy: 80, typography: 80, colorApplication: 80, originality: 80, overall: 80,
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ artType: 'painting', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; artType: string }>; summary: { totalAnalyses: number } };

      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.analysisId).toBe('g-at-p');
      expect(data.dataPoints[0]!.artType).toBe('painting');
    });
  });

  // ============================================================
  // G12: overallScore 兜底(result 为 null 时用 DB 列)
  // ============================================================
  describe('G12: overallScore 兜底(result 为 null)', () => {
    it('should_fallback_to_db_overall_score_when_result_is_null', async () => {
      // result 为 null,但 DB overall_score 有值
      prismaMock.__insertAnalysis({
        id: 'g-fb-1',
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        workType: 'painting',
        imageUrl: 'https://example.com/g-fb-1.jpg',
        title: 'fallback-test',
        status: 'success',
        result: null,
        overallScore: 77,
        createdAt: new Date(Date.now() - 1 * DAY_MS),
        completedAt: new Date(Date.now() - 1 * DAY_MS),
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      // overall 维度:result 为 null 时兜底用 DB 列
      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'overall', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: Array<{ analysisId: string; score: number }>; summary: { totalAnalyses: number } };

      expect(data.summary.totalAnalyses).toBe(1);
      expect(data.dataPoints[0]!.score).toBe(77);
    });

    it('should_skip_data_point_when_result_null_and_dimension_not_overall', async () => {
      // result 为 null,dimension=composition → 无兜底 → 跳过
      prismaMock.__insertAnalysis({
        id: 'g-fb-2',
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        workType: 'painting',
        imageUrl: 'https://example.com/g-fb-2.jpg',
        title: 'fallback-skip',
        status: 'success',
        result: null,
        overallScore: 77,
        createdAt: new Date(Date.now() - 1 * DAY_MS),
        completedAt: new Date(Date.now() - 1 * DAY_MS),
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/growth')
        .query({ dimension: 'composition', timeRange: 'all' })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { dataPoints: unknown[]; summary: { totalAnalyses: number } };

      // composition 无兜底,result 为 null → 跳过 → 空
      expect(data.summary.totalAnalyses).toBe(0);
      expect(data.dataPoints).toHaveLength(0);
    });
  });

  // ============================================================
  // 附加:Service 单元测试(直接调用,不走 HTTP)
  // ============================================================
  describe('Service 单元测试(白盒)', () => {
    it('should_compute_average_rounded_to_integer', async () => {
      // 3 条记录:60 + 73 + 82 = 215 / 3 = 71.67 → 72
      insertPaintingAnalysis('g-avg-1', TEST_TENANT_ID_A, TEST_USER_ID_A, 10, {
        composition: 60, color: 60, brushwork: 60, originality: 60, overall: 60,
      });
      insertPaintingAnalysis('g-avg-2', TEST_TENANT_ID_A, TEST_USER_ID_A, 5, {
        composition: 73, color: 73, brushwork: 73, originality: 73, overall: 73,
      });
      insertPaintingAnalysis('g-avg-3', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 82, color: 82, brushwork: 82, originality: 82, overall: 82,
      });

      const result = await growthService.getGrowthData({
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        role: 'student',
        dimension: 'overall',
        timeRange: 'all',
      });

      expect(result.summary.average).toBe(72); // Math.round(215 / 3) = 72
    });

    it('should_return_stable_trend_for_single_data_point', async () => {
      insertPaintingAnalysis('g-single', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 75, color: 75, brushwork: 75, originality: 75, overall: 75,
      });

      const result = await growthService.getGrowthData({
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        role: 'student',
        dimension: 'overall',
        timeRange: 'all',
      });

      // 单条数据:current = first = 75,change = 0,trend = stable
      expect(result.summary.totalAnalyses).toBe(1);
      expect(result.summary.current).toBe(75);
      expect(result.summary.change).toBe(0);
      expect(result.summary.trend).toBe('stable');
      expect(result.summary.average).toBe(75);
    });

    it('should_skip_failed_and_pending_analyses', async () => {
      // success 记录
      insertPaintingAnalysis('g-ok', TEST_TENANT_ID_A, TEST_USER_ID_A, 1, {
        composition: 70, color: 70, brushwork: 70, originality: 70, overall: 70,
      });
      // failed 记录(应被过滤)
      prismaMock.__insertAnalysis({
        id: 'g-failed',
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        workType: 'painting',
        imageUrl: 'https://example.com/g-failed.jpg',
        title: 'failed',
        status: 'failed',
        result: buildPaintingResult({ composition: 99, color: 99, brushwork: 99, originality: 99, overall: 99 }),
        overallScore: 99,
        createdAt: new Date(Date.now() - 1 * DAY_MS),
        completedAt: null,
      });
      // pending 记录(应被过滤)
      prismaMock.__insertAnalysis({
        id: 'g-pending',
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        workType: 'painting',
        imageUrl: 'https://example.com/g-pending.jpg',
        title: 'pending',
        status: 'pending',
        result: null,
        overallScore: null,
        createdAt: new Date(Date.now() - 1 * DAY_MS),
        completedAt: null,
      });

      const result = await growthService.getGrowthData({
        tenantId: TEST_TENANT_ID_A,
        userId: TEST_USER_ID_A,
        role: 'student',
        dimension: 'overall',
        timeRange: 'all',
      });

      // 仅 success 记录计入
      expect(result.summary.totalAnalyses).toBe(1);
      expect(result.dataPoints[0]!.analysisId).toBe('g-ok');
    });
  });
});
