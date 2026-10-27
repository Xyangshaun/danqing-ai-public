// ============================================================
// 管理后台 - 数据脱敏工具(Phase 4)
// 对应文档:auth-design.md §3.9 + 任务要求"手机号/邮箱/身份证必须脱敏"
//
// 脱敏规则:
//   - 手机号:138****1234(中间 4 位掩码)
//   - 邮箱:z***@example.com(用户名首字符 + *** + 域名)
//   - 身份证:110101********1234(出生日期 8 位掩码)
//   - 飞书 open_id:ou_xxxx****(保留前 8 位)
// ============================================================

/**
 * 脱敏手机号:138****1234
 * 支持中国手机号(11 位)与国际号码(保留前 3 + 后 4)
 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  // 中国手机号:11 位,中间 4 位掩码
  const cnMatch = phone.match(/^(\+?86)?(1[3-9]\d)(\d{4})(\d{4})$/);
  if (cnMatch) {
    return `${cnMatch[1] ?? ''}${cnMatch[2]}****${cnMatch[4]}`;
  }
  // 国际号码:保留前 3 + 后 4
  if (phone.length >= 8) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
  return '****';
}

/**
 * 脱敏邮箱:z***@example.com
 * 用户名首字符 + *** + @ + 域名
 */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const atIndex = email.indexOf('@');
  if (atIndex < 1) return '****';
  const username = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (username.length <= 1) return `${username}***${domain}`;
  return `${username[0]}***${domain}`;
}

/**
 * 脱敏身份证号:110101********1234
 * 保留前 6 位(地区码)+ 后 4 位(校验码),中间 8 位(出生日期)掩码
 */
export function maskIdCard(idCard: string | null): string | null {
  if (!idCard) return null;
  // 18 位身份证
  if (idCard.length === 18) {
    return `${idCard.slice(0, 6)}********${idCard.slice(-4)}`;
  }
  // 15 位身份证
  if (idCard.length === 15) {
    return `${idCard.slice(0, 4)}*******${idCard.slice(-2)}`;
  }
  return '****';
}

/**
 * 脱敏飞书 open_id:ou_xxxx****
 * 保留前 8 位,其余掩码
 */
export function maskFeishuOpenId(openId: string | null): string | null {
  if (!openId) return null;
  if (openId.length <= 8) return '****';
  return `${openId.slice(0, 8)}****`;
}

/**
 * 脱敏用户对象(批量处理常用字段)
 */
export function redactUser<T extends Record<string, unknown>>(user: T): T {
  return {
    ...user,
    email: user.email ? maskEmail(user.email as string) : null,
    phone: user.phone ? maskPhone(user.phone as string) : null,
  } as T;
}
