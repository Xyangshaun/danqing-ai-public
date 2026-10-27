// ============================================================
// 请求层 BizError 单元测试
// 覆盖:BizError 构造、属性、Error 继承、错误码常量
// 注:拦截器逻辑涉及 antd message 与 axios 实例,留给 E2E 验证
// ============================================================

import { describe, it, expect } from 'vitest';
import { BizError } from './request';

describe('BizError', () => {
  it('constructs with code, message, traceId', () => {
    const err = new BizError(2004, '无权限', 'trace-123');
    expect(err.code).toBe(2004);
    expect(err.message).toBe('无权限');
    expect(err.traceId).toBe('trace-123');
    expect(err.name).toBe('BizError');
  });

  it('is an instance of Error', () => {
    const err = new BizError(9005, '限流');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BizError);
  });

  it('traceId is optional', () => {
    const err = new BizError(2001, '未授权');
    expect(err.traceId).toBeUndefined();
    expect(err.code).toBe(2001);
  });

  it('supports representative admin error codes', () => {
    // 验证 D-001 修复后使用的正确错误码
    const unauthorized = new BizError(2001, 'token 失效');
    const forbidden = new BizError(2004, '无权限');
    const rateLimited = new BizError(9005, '限流');
    expect(unauthorized.code).toBe(2001);
    expect(forbidden.code).toBe(2004);
    expect(rateLimited.code).toBe(9005);
  });

  it('message is readable via Error.toString()', () => {
    const err = new BizError(2004, '禁止访问', 't-1');
    expect(err.toString()).toContain('禁止访问');
    expect(err.toString()).toContain('BizError');
  });
});
