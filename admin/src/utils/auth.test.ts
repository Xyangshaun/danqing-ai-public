// ============================================================
// Token 存储工具单元测试
// 覆盖:getAccessToken / setAccessToken / clearAccessToken / isTokenExpired / isAuthenticated
// 边界:localStorage 不可用、过期临界、无 token、缓冲时间
// 环境:jsdom(提供 localStorage)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  isTokenExpired,
  isAuthenticated,
  getTokenExpiresAt,
} from './auth';

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getAccessToken', () => {
    it('returns null when no token stored', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('returns stored token', () => {
      localStorage.setItem('dq_admin_access_token', 'abc123');
      expect(getAccessToken()).toBe('abc123');
    });
  });

  describe('getTokenExpiresAt', () => {
    it('returns null when not set', () => {
      expect(getTokenExpiresAt()).toBeNull();
    });

    it('returns stored ISO string', () => {
      const iso = new Date(Date.now() + 3600_000).toISOString();
      localStorage.setItem('dq_admin_token_expires_at', iso);
      expect(getTokenExpiresAt()).toBe(iso);
    });
  });

  describe('setAccessToken', () => {
    it('persists token and expiry', () => {
      const future = new Date(Date.now() + 900_000).toISOString();
      setAccessToken('tok-xyz', future);
      expect(localStorage.getItem('dq_admin_access_token')).toBe('tok-xyz');
      expect(localStorage.getItem('dq_admin_token_expires_at')).toBe(future);
    });
  });

  describe('clearAccessToken', () => {
    it('removes both token and expiry', () => {
      const future = new Date(Date.now() + 900_000).toISOString();
      setAccessToken('tok-xyz', future);
      expect(getAccessToken()).not.toBeNull();
      clearAccessToken();
      expect(getAccessToken()).toBeNull();
      expect(getTokenExpiresAt()).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('returns true when no expiry stored', () => {
      localStorage.setItem('dq_admin_access_token', 'tok');
      expect(isTokenExpired()).toBe(true);
    });

    it('returns true when expiry is in the past', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      setAccessToken('tok', past);
      expect(isTokenExpired()).toBe(true);
    });

    it('returns false when expiry is in the future beyond 30s buffer', () => {
      const future = new Date(Date.now() + 600_000).toISOString();
      setAccessToken('tok', future);
      expect(isTokenExpired()).toBe(false);
    });

    it('returns true when expiry is within 30s buffer', () => {
      // 20s in the future: within 30s buffer → expired
      const near = new Date(Date.now() + 20_000).toISOString();
      setAccessToken('tok', near);
      expect(isTokenExpired()).toBe(true);
    });

    it('returns false at exactly 31s in the future', () => {
      const edge = new Date(Date.now() + 31_000).toISOString();
      setAccessToken('tok', edge);
      expect(isTokenExpired()).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when no token', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('returns false when token exists but expired', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      setAccessToken('tok', past);
      expect(isAuthenticated()).toBe(false);
    });

    it('returns true when token exists and not expired', () => {
      const future = new Date(Date.now() + 600_000).toISOString();
      setAccessToken('tok', future);
      expect(isAuthenticated()).toBe(true);
    });
  });
});
