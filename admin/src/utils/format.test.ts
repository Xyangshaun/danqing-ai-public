// ============================================================
// 格式化工具单元测试
// 覆盖:日期/货币/数字/百分比/时长/运行时长/内存/负载/日期范围
// 边界:空值、非法输入、临界值
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDate,
  formatRelativeTime,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDuration,
  formatUptime,
  formatMemory,
  formatLoad,
  todayRange,
  lastNDaysRange,
} from './format';

describe('formatDateTime', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime(undefined)).toBe('-');
    expect(formatDateTime('')).toBe('-');
  });

  it('returns "-" for invalid date', () => {
    expect(formatDateTime('not-a-date')).toBe('-');
    expect(formatDateTime('invalid-date-string')).toBe('-');
  });

  it('formats valid ISO as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatDateTime('2026-08-02T14:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatDate', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns "-" for invalid date', () => {
    expect(formatDate('invalid')).toBe('-');
  });

  it('formats valid ISO as YYYY-MM-DD', () => {
    expect(formatDate('2026-08-02T14:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatRelativeTime', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(formatRelativeTime(null)).toBe('-');
    expect(formatRelativeTime(undefined)).toBe('-');
  });

  it('returns "-" for invalid date', () => {
    expect(formatRelativeTime('invalid')).toBe('-');
  });

  it('returns a relative time string for past date', () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const out = formatRelativeTime(past);
    expect(out).toContain('分钟');
  });
});

describe('formatCurrency', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency(undefined)).toBe('-');
  });

  it('formats CNY with ¥ and 2 decimals', () => {
    expect(formatCurrency(1234.5)).toBe('¥1,234.50');
    expect(formatCurrency(0)).toBe('¥0.00');
  });

  it('formats USD with $ symbol', () => {
    expect(formatCurrency(99.9, 'USD')).toBe('$99.90');
  });

  it('formats unknown currency without symbol', () => {
    expect(formatCurrency(100, 'EUR')).toBe('100.00');
  });
});

describe('formatNumber', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatNumber(null)).toBe('-');
    expect(formatNumber(undefined)).toBe('-');
  });

  it('formats with thousands separator', () => {
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1000000)).toBe('1,000,000');
  });
});

describe('formatPercent', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatPercent(null)).toBe('-');
    expect(formatPercent(undefined)).toBe('-');
  });

  it('formats rate as percent with 1 decimal by default', () => {
    expect(formatPercent(0.753)).toBe('75.3%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('respects custom digits', () => {
    expect(formatPercent(0.123456, 2)).toBe('12.35%');
    expect(formatPercent(0.5, 0)).toBe('50%');
  });
});

describe('formatDuration', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
  });

  it('formats sub-second as ms', () => {
    expect(formatDuration(230)).toBe('230ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats >= 1000ms as seconds with 2 decimals', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(2500)).toBe('2.50s');
  });
});

describe('formatUptime', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatUptime(null)).toBe('-');
    expect(formatUptime(undefined)).toBe('-');
  });

  it('formats seconds only', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(0)).toBe('0s');
  });

  it('formats minutes with seconds', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });

  it('formats hours with minutes', () => {
    expect(formatUptime(3725)).toBe('1h 2m');
  });

  it('formats days with hours and minutes', () => {
    expect(formatUptime(90061)).toBe('1d 1h 1m');
  });
});

describe('formatMemory', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatMemory(null)).toBe('-');
    expect(formatMemory(undefined)).toBe('-');
  });

  it('formats < 1024 as MB', () => {
    expect(formatMemory(256)).toBe('256.00 MB');
    expect(formatMemory(0)).toBe('0.00 MB');
    expect(formatMemory(1023.99)).toBe('1023.99 MB');
  });

  it('formats >= 1024 as GB', () => {
    expect(formatMemory(1024)).toBe('1.00 GB');
    expect(formatMemory(2048)).toBe('2.00 GB');
  });
});

describe('formatLoad', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatLoad(null)).toBe('-');
    expect(formatLoad(undefined)).toBe('-');
  });

  it('formats load as percent with 1 decimal', () => {
    expect(formatLoad(0.753)).toBe('75.3%');
    expect(formatLoad(1)).toBe('100.0%');
    expect(formatLoad(0)).toBe('0.0%');
  });
});

describe('todayRange', () => {
  it('returns valid ISO start and end with start < end', () => {
    const range = todayRange();
    const start = new Date(range.start);
    const end = new Date(range.end);
    expect(start.toString()).not.toBe('Invalid Date');
    expect(end.toString()).not.toBe('Invalid Date');
    // end - start should be ~24h (one day range)
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBeGreaterThan(23 * 3600 * 1000);
    expect(diffMs).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});

describe('lastNDaysRange', () => {
  it('returns range spanning N days ending today', () => {
    const range = lastNDaysRange(7);
    const start = new Date(range.start);
    const end = new Date(range.end);
    expect(start.toString()).not.toBe('Invalid Date');
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it('for N=1, returns a valid single-day range', () => {
    const range = lastNDaysRange(1);
    const start = new Date(range.start);
    const end = new Date(range.end);
    expect(start.toString()).not.toBe('Invalid Date');
    expect(end.toString()).not.toBe('Invalid Date');
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});
