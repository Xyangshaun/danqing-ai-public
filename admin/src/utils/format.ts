// ============================================================
// 格式化工具:日期、货币、数字、时长、百分比
// ============================================================

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

/** 格式化日期时间:2026-07-29 14:30:00 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = dayjs(iso);
  if (!d.isValid()) return '-';
  return d.format('YYYY-MM-DD HH:mm:ss');
}

/** 格式化日期:2026-07-29 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = dayjs(iso);
  if (!d.isValid()) return '-';
  return d.format('YYYY-MM-DD');
}

/** 相对时间:3 分钟前 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = dayjs(iso);
  if (!d.isValid()) return '-';
  return d.fromNow();
}

/** 格式化货币(人民币):¥1,234.50 */
export function formatCurrency(amount: number | null | undefined, currency = 'CNY'): string {
  if (amount === null || amount === undefined) return '-';
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '';
  return `${symbol}${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 格式化数字(千分位):12,345 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('zh-CN');
}

/** 格式化百分比:75.3% */
export function formatPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined) return '-';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** 格式化时长(毫秒):1.5s / 230ms */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 格式化运行时长(秒):1d 2h 30m */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 格式化内存(MB):256.30 MB */
export function formatMemory(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return '-';
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 系统负载格式化:75.3% */
export function formatLoad(load: number | null | undefined): string {
  if (load === null || load === undefined) return '-';
  return `${(load * 100).toFixed(1)}%`;
}

/** 获取今日日期范围(ISO) */
export function todayRange(): { start: string; end: string } {
  const now = dayjs();
  return {
    start: now.startOf('day').toISOString(),
    end: now.endOf('day').toISOString(),
  };
}

/** 获取最近 N 天日期范围(ISO) */
export function lastNDaysRange(days: number): { start: string; end: string } {
  const now = dayjs();
  return {
    start: now.subtract(days - 1, 'day').startOf('day').toISOString(),
    end: now.endOf('day').toISOString(),
  };
}

export { dayjs };
