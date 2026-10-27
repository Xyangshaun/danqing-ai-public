// ============================================================
// 加密工具
// - SHA-256 哈希(refresh_token 哈希存储)
// - state 生成(OAuth CSRF 防护,256bit 熵)
// - jti 生成(access_token / refresh_token 唯一 ID)
// 对应文档:auth-design.md §1.2 步骤 3, §2.2, §2.3
// ============================================================

import crypto from 'node:crypto';

/**
 * 计算 SHA-256 哈希(十六进制输出)
 * 用途:refresh_token 哈希存储(数据库只存哈希,不存明文)
 */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 生成 OAuth state 参数(64 字符 hex,256bit 熵)
 * 对应 auth-design.md §1.2 步骤 3a:crypto.randomBytes(32).toString('hex')
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成 JWT jti(UUID v4)
 * 对应 auth-design.md §1.2 步骤 9a/9c
 */
export function generateJti(): string {
  return crypto.randomUUID();
}

/**
 * 生成 UUID v4(通用业务 ID)
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}

/**
 * 校验 state 是否符合格式(64 字符 hex)
 */
export function isValidStateFormat(state: string): boolean {
  return /^[0-9a-f]{64}$/.test(state);
}

/**
 * 安全字符串相等比较(防时序攻击)
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
