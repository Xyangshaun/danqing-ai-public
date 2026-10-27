// ============================================================
// 手机验证码 Repository(Phase 5)
// 对应文档:new-features-design.md §1.3, §3.5.1
// 6 位数字验证码,5 分钟过期,5 次尝试上限,60 秒重发冷却
// 多租户:bind 场景 tenantId 关联,其他场景 tenantId 可空
// ============================================================

import type { Prisma, PhoneVerification } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 验证码用途 */
export type PhoneOtpPurpose = 'register' | 'login' | 'bind' | 'reset';

/** 验证码尝试上限 */
export const MAX_OTP_ATTEMPTS = 5;
/** 验证码有效期(秒) */
export const OTP_TTL_SEC = 5 * 60;
/** 重发冷却(秒) */
export const OTP_RESEND_COOLDOWN_SEC = 60;

export class PhoneVerificationRepository {
  /**
   * 创建验证码记录
   * @param phone 手机号
   * @param code 6 位数字
   * @param purpose 用途
   * @param ip 客户端 IP
   * @param tenantId bind 场景关联租户(仅记录,无外键关系)
   * @param userId bind 场景关联用户
   */
  async create(params: {
    phone: string;
    code: string;
    purpose: PhoneOtpPurpose;
    ip: string;
    tenantId?: string;
    userId?: string;
  }): Promise<PhoneVerification> {
    const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
    const data: Prisma.PhoneVerificationCreateInput = {
      phone: params.phone,
      code: params.code,
      purpose: params.purpose,
      expiresAt,
      ip: params.ip,
      tenantId: params.tenantId ?? null,
      attempts: 0,
      ...(params.userId ? { User: { connect: { id: params.userId } } } : {}),
    };
    return prisma().phoneVerification.create({ data });
  }

  /**
   * 查询某手机号+用途的最近一条有效验证码(未过期/未消费/尝试未超限)
   */
  async findLatestValid(phone: string, purpose: PhoneOtpPurpose): Promise<PhoneVerification | null> {
    const now = new Date();
    return prisma().phoneVerification.findFirst({
      where: {
        phone,
        purpose,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_OTP_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 查询最近一条记录(含已消费/已过期,用于冷却判断)
   */
  async findLatest(phone: string, purpose: PhoneOtpPurpose): Promise<PhoneVerification | null> {
    return prisma().phoneVerification.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 标记验证码已消费
   */
  async markConsumed(id: string): Promise<void> {
    await prisma().phoneVerification.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * 增加尝试次数(校验失败时调用)
   */
  async incrementAttempts(id: string): Promise<PhoneVerification> {
    const current = await prisma().phoneVerification.findUnique({ where: { id } });
    const attempts = (current?.attempts ?? 0) + 1;
    return prisma().phoneVerification.update({
      where: { id },
      data: { attempts },
    });
  }
}

export const phoneVerificationRepository = new PhoneVerificationRepository();
