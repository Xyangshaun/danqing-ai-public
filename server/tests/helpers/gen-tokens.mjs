// 生成 admin + student token 用于 AI 用量统计接口测试
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const SERVER_ROOT = '/var/www/danqing-ai/server';
function loadEnvFile(envPath) {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    value = value.replace(/\\n/g, '\n');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(SERVER_ROOT + '/.env');
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;
const JWT_ISSUER = process.env.JWT_ISSUER || 'danqing-ai-auth';
const JWT_AUDIENCE_ADMIN = process.env.JWT_AUDIENCE_ADMIN || 'danqing-ai-admin';
const JWT_KEY_ID = process.env.JWT_KEY_ID || 'danqing-ai-2026-07';
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
if (!JWT_PRIVATE_KEY) { console.error('NO JWT_PRIVATE_KEY'); process.exit(1); }

function issue(userId, tenantId, role) {
  return jwt.sign({ sub: userId, tenant_id: tenantId, role, feishu_open_id: '', jti: crypto.randomUUID(), iss: JWT_ISSUER, aud: JWT_AUDIENCE_ADMIN }, JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: JWT_ACCESS_EXPIRES, notBefore: 0, keyid: JWT_KEY_ID });
}

const prisma = new PrismaClient();
try {
  const u = await prisma.user.findFirst({ select: { id: true, tenantId: true, role: true, name: true } });
  if (!u) { console.error('NO USER'); process.exit(1); }
  console.error('user:', u.id, u.name, u.role, u.tenantId);
  console.log('ADMIN_TOKEN_BEGIN');
  console.log(issue(u.id, u.tenantId, 'admin'));
  console.log('ADMIN_TOKEN_END');
  console.log('STUDENT_TOKEN_BEGIN');
  console.log(issue(u.id, u.tenantId, 'student'));
  console.log('STUDENT_TOKEN_END');
} finally { await prisma.$disconnect(); }
