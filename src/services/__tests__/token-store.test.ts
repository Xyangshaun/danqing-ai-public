// ============================================================
// token-store 单元测试 (任务包 E:块4 服务层覆盖率补强)
// 对应源码: src/services/token-store.ts
//
// 测试范围:
//   1. setAccessToken / getAccessToken: 内存读写
//   2. clearAccessToken: 清空内存 token
//   3. hasAccessToken: 判断登录态
//   4. isAccessTokenExpiringSoon: 提前 30 秒判定即将过期
//   5. isAccessTokenExpired: 判定已过期
//   6. getDeviceId: 设备指纹生成与持久化
//
// 注意:access_token 仅存内存(模块级闭包),每个测试需 clear 重置
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setAccessToken,
  getAccessToken,
  clearAccessToken,
  hasAccessToken,
  isAccessTokenExpiringSoon,
  isAccessTokenExpired,
  getDeviceId,
} from '../token-store';

/* ---------- 公共清理 ---------- */

beforeEach(() => {
  clearAccessToken();
  localStorage.clear();
});

afterEach(() => {
  clearAccessToken();
  localStorage.clear();
  vi.restoreAllMocks();
});

/* ============================================================
 * 1. setAccessToken / getAccessToken
 * ============================================================ */
describe('setAccessToken / getAccessToken', () => {
  it('setAccessToken 后 getAccessToken 返回相同 token', () => {
    setAccessToken('my-token-123');
    expect(getAccessToken()).toBe('my-token-123');
  });

  it('未设置时 getAccessToken 返回 null', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('多次 setAccessToken 覆盖旧值', () => {
    setAccessToken('token-1');
    setAccessToken('token-2');
    expect(getAccessToken()).toBe('token-2');
  });

  it('带 expiresAt 参数(ISO 字符串)时正确解析过期时间', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 小时后
    setAccessToken('token-with-exp', future);
    expect(getAccessToken()).toBe('token-with-exp');
    // 未过期
    expect(isAccessTokenExpired()).toBe(false);
    expect(isAccessTokenExpiringSoon()).toBe(false);
  });
});

/* ============================================================
 * 2. clearAccessToken
 * ============================================================ */
describe('clearAccessToken', () => {
  it('清除后 getAccessToken 返回 null', () => {
    setAccessToken('token-to-clear');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('清除后 hasAccessToken 返回 false', () => {
    setAccessToken('token');
    clearAccessToken();
    expect(hasAccessToken()).toBe(false);
  });

  it('清除后 isAccessTokenExpired 返回 true(无过期时间)', () => {
    setAccessToken('token', new Date(Date.now() + 60000).toISOString());
    clearAccessToken();
    expect(isAccessTokenExpired()).toBe(true);
  });
});

/* ============================================================
 * 3. hasAccessToken
 * ============================================================ */
describe('hasAccessToken', () => {
  it('未设置时返回 false', () => {
    expect(hasAccessToken()).toBe(false);
  });

  it('设置后返回 true', () => {
    setAccessToken('any-token');
    expect(hasAccessToken()).toBe(true);
  });

  it('清除后返回 false', () => {
    setAccessToken('token');
    clearAccessToken();
    expect(hasAccessToken()).toBe(false);
  });

  it('空字符串 token 也算已设置(返回 true)', () => {
    // 注:实现仅判断 !== null,空字符串也算
    setAccessToken('');
    expect(hasAccessToken()).toBe(true);
  });
});

/* ============================================================
 * 4. isAccessTokenExpiringSoon
 * ============================================================ */
describe('isAccessTokenExpiringSoon', () => {
  it('clearAccessToken 后(无过期时间)返回 true', () => {
    // 注意:setAccessToken 不传 expiresAt 时默认 14 分钟后过期,
    // 只有 clearAccessToken 后 accessTokenExpiresAt 才为 null
    setAccessToken('token');
    clearAccessToken();
    expect(isAccessTokenExpiringSoon()).toBe(true);
  });

  it('过期时间在 30 秒内时返回 true', () => {
    const soon = new Date(Date.now() + 20 * 1000).toISOString(); // 20 秒后
    setAccessToken('token', soon);
    expect(isAccessTokenExpiringSoon()).toBe(true);
  });

  it('过期时间在 30 秒外时返回 false', () => {
    const later = new Date(Date.now() + 60 * 1000).toISOString(); // 60 秒后
    setAccessToken('token', later);
    expect(isAccessTokenExpiringSoon()).toBe(false);
  });

  it('默认过期时间为 14 分钟后(未传 expiresAt)', () => {
    setAccessToken('token');
    // 14 分钟 - 30 秒 = 13.5 分钟后,远未过期
    expect(isAccessTokenExpiringSoon()).toBe(false);
    expect(isAccessTokenExpired()).toBe(false);
  });
});

/* ============================================================
 * 5. isAccessTokenExpired
 * ============================================================ */
describe('isAccessTokenExpired', () => {
  it('clearAccessToken 后(无过期时间)返回 true', () => {
    // 注意:setAccessToken 不传 expiresAt 时默认 14 分钟后过期,
    // 只有 clearAccessToken 后 accessTokenExpiresAt 才为 null
    setAccessToken('token');
    clearAccessToken();
    expect(isAccessTokenExpired()).toBe(true);
  });

  it('过期时间在未来时返回 false', () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    setAccessToken('token', future);
    expect(isAccessTokenExpired()).toBe(false);
  });

  it('过期时间已过时返回 true', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    setAccessToken('token', past);
    expect(isAccessTokenExpired()).toBe(true);
  });
});

/* ============================================================
 * 6. getDeviceId
 * ============================================================ */
describe('getDeviceId', () => {
  it('首次调用生成 UUID 并持久化到 localStorage', () => {
    const id = getDeviceId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    // 验证已写入 localStorage
    expect(localStorage.getItem('danqing-ai-device-id')).toBe(id);
  });

  it('二次调用返回相同的 id(从 localStorage 读取)', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe(second);
  });

  it('localStorage 中已有 id 时直接返回', () => {
    localStorage.setItem('danqing-ai-device-id', 'preset-device-id');
    const id = getDeviceId();
    expect(id).toBe('preset-device-id');
  });

  it('生成的 id 符合 UUID v4 格式(使用 crypto.randomUUID)', () => {
    const id = getDeviceId();
    // crypto.randomUUID 格式: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('localStorage 不可用时降级为会话级随机 ID(不抛错)', () => {
    // 模拟 localStorage 抛错(隐私模式)
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('localStorage disabled');
    });
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('localStorage disabled');
    });
    try {
      const id = getDeviceId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    } finally {
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
