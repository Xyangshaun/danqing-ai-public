// ============================================================
// 丹青有AI - 预生成测试 JWT(generate-tokens.js)
// 职责:为 seed-database.js 创建的 100 个测试用户签发 access_token
// 复用 server 的 JWT_PRIVATE_KEY(RS256),payload 与 jwt.service.ts 完全一致
// 输出:performance/scripts/tokens.json(供 k6 脚本 SharedArray 加载)
//
// 运行:
//   cd server
//   node performance/scripts/generate-tokens.js
//
// 前置:先运行 seed-database.js 创建测试用户
// ============================================================

import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

// ---------- 手动加载 server/.env ----------
function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    console.error(`[generate-tokens] .env 文件不存在: ${envPath}`);
    console.error('[generate-tokens] 请先: cp .env.example .env 并填入配置');
    process.exit(1);
  }
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // 去除两端引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 还原 \n 为真实换行(PEM 密钥)
    value = value.replace(/\\n/g, '\n');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(SERVER_ROOT, '.env'));

// ---------- 配置 ----------
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;
const JWT_ISSUER = process.env.JWT_ISSUER || 'danqing-ai-auth';
const JWT_AUDIENCE_WEB = process.env.JWT_AUDIENCE_WEB || 'danqing-ai-web';
const JWT_KEY_ID = process.env.JWT_KEY_ID || 'danqing-ai-2026-07';
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const TOKEN_COUNT = parseInt(process.env.TOKEN_COUNT || '100', 10);
const TEST_USER_PREFIX = 'k6-test-'; // 与 seed-database.js 约定一致

if (!JWT_PRIVATE_KEY) {
  console.error('[generate-tokens] JWT_PRIVATE_KEY 未设置,请检查 server/.env');
  process.exit(1);
}

// ---------- 校验 RSA 私钥 ----------
try {
  const keyObj = crypto.createPrivateKey(JWT_PRIVATE_KEY);
  if (keyObj.asymmetricKeyType !== 'rsa') {
    throw new Error(`expected RSA key, got ${keyObj.asymmetricKeyType}`);
  }
} catch (err) {
  console.error(`[generate-tokens] JWT_PRIVATE_KEY 无效: ${err.message}`);
  process.exit(1);
}

// ---------- 签发 access_token(逻辑与 server/src/services/jwt.service.ts 一致)----------
function issueAccessToken({ userId, tenantId, role, feishuOpenId }) {
  const jti = crypto.randomUUID();
  const payload = {
    sub: userId,
    tenant_id: tenantId,
    role,
    feishu_open_id: feishuOpenId,
    jti,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE_WEB,
  };
  const token = jwt.sign(payload, JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: JWT_ACCESS_EXPIRES,
    notBefore: 0,
    keyid: JWT_KEY_ID,
  });
  return { token, jti };
}

// ---------- 主流程 ----------
async function main() {
  const prisma = new PrismaClient();
  try {
    // 查询测试用户(按 feishu_open_id 前缀筛选,与 seed-database.js 约定一致)
    const users = await prisma.user.findMany({
      where: {
        feishuOpenId: { startsWith: TEST_USER_PREFIX },
      },
      select: {
        id: true,
        tenantId: true,
        role: true,
        feishuOpenId: true,
        name: true,
      },
      take: TOKEN_COUNT,
    });

    if (users.length === 0) {
      console.error(`[generate-tokens] 未找到测试用户(feishu_open_id 以 "${TEST_USER_PREFIX}" 开头)`);
      console.error('[generate-tokens] 请先运行: node performance/scripts/seed-database.js');
      process.exit(1);
    }

    console.log(`[generate-tokens] 找到 ${users.length} 个测试用户,开始签发 token...`);

    const tokens = users.map((u) => {
      const { token, jti } = issueAccessToken({
        userId: u.id,
        tenantId: u.tenantId,
        role: u.role,
        feishuOpenId: u.feishuOpenId,
      });
      return {
        userId: u.id,
        tenantId: u.tenantId,
        role: u.role,
        name: u.name,
        jti,
        accessToken: token,
        issuedAt: new Date().toISOString(),
        expiresIn: JWT_ACCESS_EXPIRES,
      };
    });

    const outputPath = path.join(__dirname, 'tokens.json');
    await writeFile(outputPath, JSON.stringify(tokens, null, 2), 'utf-8');
    console.log(`[generate-tokens] ✅ 已签发 ${tokens.length} 个 token → ${outputPath}`);
    console.log('[generate-tokens] k6 脚本可通过 TOKENS_FILE=scripts/tokens.json 或 SharedArray 加载');

    // 同时输出 seed-result.json 的兼容信息(若不存在则创建轻量版)
    const seedResultPath = path.join(__dirname, 'seed-result.json');
    if (!existsSync(seedResultPath)) {
      const seedResult = {
        tenantId: users[0].tenantId,
        userIds: users.map((u) => u.id),
        generatedAt: new Date().toISOString(),
        note: '由 generate-tokens.js 反向生成(未运行 seed-database.js 时)',
      };
      await writeFile(seedResultPath, JSON.stringify(seedResult, null, 2), 'utf-8');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[generate-tokens] 执行失败:', err);
  process.exit(1);
});
