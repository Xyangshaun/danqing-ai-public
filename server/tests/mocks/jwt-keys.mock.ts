// ============================================================
// JWT 测试密钥(一次性 RSA 2048 密钥对)
// 对应文档:auth-design.md §2.1 + §4.7(启动自检:私钥必须 RSA)
// 在 tests/setup.ts 中导入,注入 process.env.JWT_PRIVATE_KEY / JWT_PUBLIC_KEY
// 注意:测试密钥仅用于单元/集成测试,严禁用于生产
// ============================================================

import crypto from 'node:crypto';

/**
 * 生成 RSA 2048 密钥对(PEM 格式)
 * 使用同步 API,确保在 setup 顶部完成
 */
function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
  return {
    privateKey: privateKey as string,
    publicKey: publicKey as string,
  };
}

// 模块加载时一次性生成,全测试共享(避免每个测试重复生成耗时)
export const testJwtKeys: { privateKey: string; publicKey: string } = generateRsaKeyPair();

/**
 * 密钥指纹(SHA-256,用于校验唯一性)
 */
export const testKeyFingerprint: string = crypto
  .createHash('sha256')
  .update(testJwtKeys.privateKey)
  .digest('hex')
  .slice(0, 16);
