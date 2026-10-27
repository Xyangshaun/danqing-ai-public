// ============================================================
// 密码哈希工具(Phase 5 院校管理员认证)
// 对应文档:auth-design.md §0 C4(密码存储)
// 技术约束:bcrypt(salt rounds = 12)
// 设计原则:
//   - 哈希与校验分离,便于单元测试
//   - 校验失败统一返回 false(不抛错,由调用方决定错误处理)
//   - 禁止日志输出明文密码 / 哈希值
// ============================================================

import bcrypt from 'bcrypt';

/** bcrypt 盐轮数(系统硬性约束:salt rounds = 12) */
export const BCRYPT_SALT_ROUNDS = 12;

/**
 * 校验密码复杂度(院校管理员密码)
 * 规则:≥8 位,含大小写字母 + 数字
 * @throws Error 密码不满足复杂度要求时抛错(供 Zod refine 或 service 调用)
 */
export function validatePasswordComplexity(password: string): void {
  if (password.length < 8) {
    throw new Error('密码长度至少 8 位');
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('密码必须包含大写字母');
  }
  if (!/[a-z]/.test(password)) {
    throw new Error('密码必须包含小写字母');
  }
  if (!/\d/.test(password)) {
    throw new Error('密码必须包含数字');
  }
}

/**
 * 哈希密码(bcrypt,salt rounds = 12)
 * @param plainPassword 明文密码
 * @returns bcrypt 哈希字符串(含 salt 与 cost factor)
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
}

/**
 * 校验密码(bcrypt 比对)
 * @param plainPassword 用户输入的明文密码
 * @param hashedPassword 数据库存储的 bcrypt 哈希
 * @returns 匹配返回 true,否则 false(不抛错,防时序攻击统一返回)
 */
export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch {
    // 哈希格式异常等情况:统一返回 false(不暴露内部错误)
    return false;
  }
}
