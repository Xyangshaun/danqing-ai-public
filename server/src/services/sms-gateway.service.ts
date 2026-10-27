// ============================================================
// 短信网关服务(Phase 5)
// 对应文档:new-features-design.md §3.5.1,设计决策 1
// 抽象 SmsGateway 接口 + MockSmsGateway(默认)+ AliyunSmsGateway(占位)
// env SMS_PROVIDER=mock|aliyun|tencent 控制选择,默认 mock
// ============================================================

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * 短信网关抽象接口
 * v1 仅实现 Mock(日志输出),Aliyun/Tencent 为占位
 */
export interface SmsGateway {
  /** 发送 OTP 验证码 */
  sendOtp(params: { phone: string; code: string; purpose: string }): Promise<void>;
}

/**
 * Mock 短信网关:验证码输出到日志(开发/测试用)
 * 注意:不输出完整手机号(脱敏),不输出 token
 */
export class MockSmsGateway implements SmsGateway {
  async sendOtp(params: { phone: string; code: string; purpose: string }): Promise<void> {
    const masked = params.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    // eslint-disable-next-line no-console
    console.info(`[sms-mock] OTP sent to ${masked} (purpose=${params.purpose}): code=${params.code}`);
    logger.info({ phone: masked, purpose: params.purpose }, '[sms-mock] otp sent');
  }
}

/**
 * 阿里云短信网关占位(未接入,抛 NOT_IMPLEMENTED)
 * TODO:接入阿里云 SDK,需配置 ALIYUN_SMS_AK / ALIYUN_SMS_SK / ALIYUN_SMS_SIGN
 */
export class AliyunSmsGateway implements SmsGateway {
  async sendOtp(_params: { phone: string; code: string; purpose: string }): Promise<void> {
    throw new Error('[sms-aliyun] not implemented; configure ALIYUN_SMS_AK/SK and enable provider');
  }
}

/**
 * 腾讯云短信网关占位
 */
export class TencentSmsGateway implements SmsGateway {
  async sendOtp(_params: { phone: string; code: string; purpose: string }): Promise<void> {
    throw new Error('[sms-tencent] not implemented; configure TENCENT_SMS_AK/SK and enable provider');
  }
}

/**
 * 短信网关工厂:按 env().smsProvider 选择实现
 * 默认 mock(开发环境),生产环境需显式配置 aliyun/tencent
 */
export function createSmsGateway(): SmsGateway {
  const provider = env().smsProvider;
  switch (provider) {
    case 'mock':
      return new MockSmsGateway();
    case 'aliyun':
      return new AliyunSmsGateway();
    case 'tencent':
      return new TencentSmsGateway();
    default:
      // 兜底:mock(保证服务可用,避免 provider 配置缺失导致 OTP 完全不可用)
      logger.warn({ provider }, '[sms] unknown provider, fallback to mock');
      return new MockSmsGateway();
  }
}

/** 单例 SmsGateway */
let smsGatewayInstance: SmsGateway | null = null;

export function getSmsGateway(): SmsGateway {
  if (!smsGatewayInstance) {
    smsGatewayInstance = createSmsGateway();
  }
  return smsGatewayInstance;
}

/** 测试用:重置单例(每个测试用例独立隔离) */
export function __resetSmsGateway(): void {
  smsGatewayInstance = null;
}
