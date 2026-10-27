// ============================================================
// 数据脱敏工具
// 后端响应已对手机/邮箱脱敏,此处提供前端兜底脱敏与展示工具
// 默认脱敏:手机 138****1234、邮箱 a***@example.com
// ============================================================

/** 手机号脱敏:138****1234 */
export function maskPhone(phone: string | null | undefined): string {
  if (phone === null || phone === undefined) return '-';
  const s = String(phone).trim();
  if (!s) return '-';
  // 已脱敏(含 *)直接返回
  if (s.includes('*')) return s;
  // 中国大陆手机号 11 位
  if (/^1\d{10}$/.test(s)) {
    return `${s.slice(0, 3)}****${s.slice(-4)}`;
  }
  // 其他格式:保留前 2 后 2
  if (s.length <= 4) return s;
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

/** 邮箱脱敏:a***@example.com */
export function maskEmail(email: string | null | undefined): string {
  if (email === null || email === undefined) return '-';
  const s = String(email).trim();
  if (!s) return '-';
  if (s.includes('*')) return s;
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at);
  const domain = s.slice(at);
  const visible = name.slice(0, 1);
  return `${visible}***${domain}`;
}

/** 身份证号脱敏:110101****1234(出生年月日脱敏) */
export function maskIdCard(id: string | null | undefined): string {
  if (id === null || id === undefined) return '-';
  const s = String(id).trim();
  if (!s) return '-';
  if (s.includes('*')) return s;
  if (s.length === 18) {
    return `${s.slice(0, 6)}********${s.slice(-4)}`;
  }
  if (s.length === 15) {
    return `${s.slice(0, 4)}******${s.slice(-3)}`;
  }
  return s;
}

/** 飞书 OpenID 脱敏:保留前 4 后 4 */
export function maskOpenId(id: string | null | undefined): string {
  if (id === null || id === undefined) return '-';
  const s = String(id).trim();
  if (!s) return '-';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

/** IP 脱敏:192.168.*.1(末段保留) */
export function maskIp(ip: string | null | undefined): string {
  if (ip === null || ip === undefined) return '-';
  const s = String(ip).trim();
  if (!s) return '-';
  const parts = s.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.${parts[3]}`;
  }
  return s;
}
