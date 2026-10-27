// ============================================================
// 数据脱敏工具单元测试
// 覆盖:maskPhone / maskEmail / maskIdCard / maskOpenId / maskIp
// 边界:空值、已脱敏输入、异常格式、临界长度
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskOpenId,
  maskIp,
} from './mask';

describe('maskPhone', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(maskPhone(null)).toBe('-');
    expect(maskPhone(undefined)).toBe('-');
    expect(maskPhone('')).toBe('-');
    expect(maskPhone('   ')).toBe('-');
  });

  it('masks 11-digit Chinese mobile as 138****1234', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
    expect(maskPhone('15900001111')).toBe('159****1111');
  });

  it('passes through already-masked input', () => {
    expect(maskPhone('138****1234')).toBe('138****1234');
    expect(maskPhone('1***1')).toBe('1***1');
  });

  it('keeps short strings (<=4 chars) as-is', () => {
    expect(maskPhone('1234')).toBe('1234');
    expect(maskPhone('12')).toBe('12');
  });

  it('masks other formats as first2+****+last2', () => {
    expect(maskPhone('123456789')).toBe('12****89');
    expect(maskPhone('1234567')).toBe('12****67');
  });

  it('trims whitespace before masking', () => {
    expect(maskPhone('  13812341234  ')).toBe('138****1234');
  });

  it('does not mask 11-digit-like if not starting with 1', () => {
    // 11 位但非 1 开头:走 other 分支
    expect(maskPhone('23812341234')).toBe('23****34');
  });
});

describe('maskEmail', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(maskEmail(null)).toBe('-');
    expect(maskEmail(undefined)).toBe('-');
    expect(maskEmail('')).toBe('-');
  });

  it('masks email as a***@domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('bob@test.edu.cn')).toBe('b***@test.edu.cn');
  });

  it('passes through already-masked input', () => {
    expect(maskEmail('a***@example.com')).toBe('a***@example.com');
  });

  it('returns input as-is when no @ or @ at index 0', () => {
    expect(maskEmail('notanemail')).toBe('notanemail');
    expect(maskEmail('@domain.com')).toBe('@domain.com');
  });

  it('trims whitespace', () => {
    expect(maskEmail('  alice@example.com  ')).toBe('a***@example.com');
  });
});

describe('maskIdCard', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(maskIdCard(null)).toBe('-');
    expect(maskIdCard(undefined)).toBe('-');
    expect(maskIdCard('')).toBe('-');
  });

  it('masks 18-digit ID as first6+********+last4', () => {
    expect(maskIdCard('110101199001011234')).toBe('110101********1234');
  });

  it('masks 15-digit ID as first4+******+last3', () => {
    expect(maskIdCard('110101900101123')).toBe('1101******123');
  });

  it('passes through already-masked input', () => {
    expect(maskIdCard('110101********1234')).toBe('110101********1234');
  });

  it('returns other lengths as-is', () => {
    expect(maskIdCard('12345')).toBe('12345');
    expect(maskIdCard('1234567890123456789')).toBe('1234567890123456789');
  });
});

describe('maskOpenId', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(maskOpenId(null)).toBe('-');
    expect(maskOpenId(undefined)).toBe('-');
    expect(maskOpenId('')).toBe('-');
  });

  it('returns **** for short ids (<=8 chars)', () => {
    expect(maskOpenId('short')).toBe('****');
    expect(maskOpenId('12345678')).toBe('****');
  });

  it('masks long ids as first4+****+last4', () => {
    expect(maskOpenId('ou_abc1234567890xyz')).toBe('ou_a****0xyz');
    expect(maskOpenId('123456789')).toBe('1234****6789');
  });
});

describe('maskIp', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(maskIp(null)).toBe('-');
    expect(maskIp(undefined)).toBe('-');
    expect(maskIp('')).toBe('-');
  });

  it('masks IPv4 as first.second.*.fourth', () => {
    expect(maskIp('192.168.1.100')).toBe('192.168.*.100');
    expect(maskIp('10.0.0.1')).toBe('10.0.*.1');
    expect(maskIp('127.0.0.1')).toBe('127.0.*.1');
  });

  it('returns non-IPv4 input as-is', () => {
    expect(maskIp('not-an-ip')).toBe('not-an-ip');
    expect(maskIp('::1')).toBe('::1');
    expect(maskIp('1.2.3')).toBe('1.2.3');
  });
});
