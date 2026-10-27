// ============================================================
// 丹青有AI 移动端设备 ID 管理
// - 首次启动生成稳定的设备 ID 并持久化到 secure-store
// - 跨登录持久化(用户登出后再登录仍用同一设备 ID)
// - 用于后端 /auth/feishu/authorize 的 device_id 参数(会话绑定 + 风控)
// - 生成策略:expo-crypto.randomUUID()(RFC 4122 v4 UUID)
// ============================================================
import * as Crypto from 'expo-crypto';
import { deviceStorage } from '../utils/storage';

/**
 * 获取或创建稳定的设备 ID。
 * 1. 优先从 secure-store 读取持久化的设备 ID
 * 2. 不存在则用 expo-crypto.randomUUID() 生成新 v4 UUID 并持久化
 *
 * 注:expo-constants 在 SDK 51 中已无 installationId/deviceId 字段
 *     (仅 sessionId,但跨启动变化),故直接采用随机 UUID 持久化方案。
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const stored = await deviceStorage.getDeviceId();
  if (stored && stored.length > 0) {
    return stored;
  }
  const newId = Crypto.randomUUID();
  await deviceStorage.setDeviceId(newId);
  return newId;
}
