// ============================================================
// heritageCategory 校验逻辑测试 (Task 21.5)
// 对应源码:src/controllers/analysis.controller.ts
//   - validateHeritageCategory (superRefine 互斥校验)
//   - heritageCategorySchema (z.enum 枚举校验)
//   - createAnalysisBodySchema (POST /analyses,JSON 模式)
//   - uploadFormSchema (POST /analyses/upload,multipart 模式)
//
// 测试策略(supertest 集成,走完整中间件链):
//   - 400 场景:Zod schema 校验失败,在 service 调用前返回,不依赖 Jimp/AI
//   - 200 场景:走完整 Jimp 流程(setup.ts mock 返回 100x100 伪图,AI 关闭)
//   - 覆盖维度:
//       A. 互斥校验(4 种非 heritage artType × heritageCategory → 400)
//       B. 枚举校验(3 合法值 → 200;1 非法值 → 400)
//       C. upload 端点(multipart 模式同样应用互斥校验)
//       D. 错误响应结构(code/message/traceId/data=null)
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
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';

// ============================================================
// 测试常量
// ============================================================

const TENANT_ID = 't-heritage-val-0001';
const STUDENT_ID = 'u-heritage-val-stu-0001';
const STUDENT_OPEN_ID = 'ou_heritage_val_stu';

/** 占位图片 URL(setup.ts Jimp mock 对 https://example.com/*.jpg 返回 100x100 伪图) */
const VALID_IMAGE_URL = 'https://example.com/heritage-test.jpg';

/**
 * 最小 JPEG 缓冲(FF D8 FF E0 ... + EOI)
 * 供 POST /analyses/upload 的魔数校验(detectImageType)通过
 */
const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, // JPEG SOI + APP0 marker
  0x00, 0x10, // APP0 length = 16
  0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0" identifier
  0x01, 0x01, 0x00, 0x00, 0x01, // version + units + density
  0x00, 0x01, 0x00, 0x01, // x/y density
  0x00, 0x00, // thumbnail dimensions
  0xff, 0xd9, // EOI
]);

// ============================================================
// 辅助函数
// ============================================================

/** 签发学生 access_token 并构造 Authorization 头 */
function authHeaders(): Record<string, string> {
  const token = createTestTokenSet({
    userId: STUDENT_ID,
    tenantId: TENANT_ID,
    role: 'student',
    feishuOpenId: STUDENT_OPEN_ID,
  }).accessToken;
  return buildAuthHeaders(token);
}

/** 预置租户 + 学生用户 + 租户成员关系(供 RBAC 鉴权通过) */
function seedTestData(): void {
  prismaMock.__clear();
  createTestTenant({
    id: TENANT_ID,
    name: 'heritage校验测试学院',
    type: 'college',
    plan: 'standard',
    status: 'active',
    maxSeats: 100,
  });
  createTestUser({
    id: STUDENT_ID,
    tenantId: TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID,
    feishuUnionId: 'on_heritage_val_stu',
    name: 'heritage校验学生',
    role: 'student',
  });
  // 租户成员关系(权限中间件依赖)
  prismaMock.tenantMemberStore.set(`${STUDENT_ID}_${TENANT_ID}`, {
    userId: STUDENT_ID,
    tenantId: TENANT_ID,
    role: 'student',
    joinedAt: new Date('2026-08-01T00:00:00Z'),
  });
}

// ============================================================
// 测试用例
// ============================================================

describe('heritageCategory 校验逻辑 (Task 21.5)', () => {
  beforeEach(() => {
    seedTestData();
  });

  // ----------------------------------------------------------
  // A: artType 与 heritageCategory 互斥校验 (POST /analyses JSON)
  // 验证点:artType !== 'heritage' 时,heritageCategory 传值 → 400 拒绝
  // ----------------------------------------------------------
  describe('A: artType 与 heritageCategory 互斥校验 (POST /analyses)', () => {
    it('should_return_400_when_heritageCategory_provided_with_artType_painting', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'painting',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'papercut',
        })
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_return_400_when_heritageCategory_provided_with_artType_design', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'design',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'embroidery',
        })
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_return_400_when_heritageCategory_provided_with_artType_product', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'product',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'porcelain',
        })
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_return_400_when_heritageCategory_provided_with_artType_sculpture', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'sculpture',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'papercut',
        })
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_accept_when_heritageCategory_provided_with_artType_heritage', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'papercut',
        })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_accept_when_heritageCategory_absent_with_artType_heritage', async () => {
      // artType=heritage 但不传 heritageCategory → 200(按通用维度评估)
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
        })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_accept_when_heritageCategory_absent_with_artType_painting', async () => {
      // 非 heritage 类型且不传 heritageCategory → 200(正常流程)
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'painting',
          imageUrl: VALID_IMAGE_URL,
        })
        .expect(200);
      assertApiResponse(res);
    });
  });

  // ----------------------------------------------------------
  // B: heritageCategory 枚举校验 (POST /analyses)
  // 验证点:仅 papercut/embroidery/porcelain 三值为合法枚举
  // ----------------------------------------------------------
  describe('B: heritageCategory 枚举校验 (POST /analyses)', () => {
    it('should_accept_heritageCategory_papercut_when_artType_heritage', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'papercut',
        })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_accept_heritageCategory_embroidery_when_artType_heritage', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'embroidery',
        })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_accept_heritageCategory_porcelain_when_artType_heritage', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'porcelain',
        })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_return_400_when_heritageCategory_invalid_enum_value', async () => {
      // 'calligraphy' 不在合法枚举内 → 400(枚举校验先于互斥校验触发)
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'heritage',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'calligraphy',
        })
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });
  });

  // ----------------------------------------------------------
  // C: upload 端点 heritageCategory 校验 (POST /analyses/upload)
  // 验证点:multipart 模式同样应用 validateHeritageCategory 互斥校验
  // ----------------------------------------------------------
  describe('C: upload 端点 heritageCategory 校验 (POST /analyses/upload)', () => {
    it('should_return_400_when_upload_heritageCategory_with_non_heritage_artType', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses/upload')
        .set(authHeaders())
        .field('artType', 'painting')
        .field('heritageCategory', 'papercut')
        .attach('image', MINIMAL_JPEG, 'test.jpg')
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it('should_accept_upload_when_heritageCategory_with_heritage_artType', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses/upload')
        .set(authHeaders())
        .field('artType', 'heritage')
        .field('heritageCategory', 'papercut')
        .attach('image', MINIMAL_JPEG, 'test.jpg')
        .expect(200);
      assertApiResponse(res);
    });
  });

  // ----------------------------------------------------------
  // D: 错误响应结构与消息
  // 验证点:错误码 PARAM_INVALID(1001) + 友好消息含 artType + traceId 非空 + data=null
  // ----------------------------------------------------------
  describe('D: 错误响应结构与消息校验', () => {
    it('should_include_PARAM_INVALID_code_and_helpful_message_when_heritageCategory_mismatch', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'painting',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'papercut',
        })
        .expect(400);
      const body = assertApiError(res, ErrorCode.PARAM_INVALID, 400);
      // 互斥校验消息应包含 heritageCategory 关键字 + heritage 字样
      expect(body.message).toContain('heritageCategory');
      expect(body.message).toContain('heritage');
      // data 应为 null
      expect(body.data).toBeNull();
    });

    it('should_include_traceId_in_error_response_when_heritageCategory_rejected', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'design',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'porcelain',
        })
        .expect(400);
      const body = assertApiError(res, ErrorCode.PARAM_INVALID, 400);
      expect(typeof body.traceId).toBe('string');
      expect(body.traceId.length).toBeGreaterThan(0);
    });

    it('should_return_error_message_mentioning_current_artType_when_mismatch', async () => {
      // 互斥校验消息格式:"heritageCategory 仅在 artType='heritage' 时有效(当前 artType='sculpture')"
      // 应包含当前 artType 值,便于前端定位
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders())
        .send({
          artType: 'sculpture',
          imageUrl: VALID_IMAGE_URL,
          heritageCategory: 'embroidery',
        })
        .expect(400);
      const body = res.body as { message: string };
      expect(body.message).toContain('sculpture');
    });
  });
});
