// ============================================================
// 客户端 IP 提取(统一实现,G9 重构)
//
// 之前 rate-limit.ts / client-adapt.ts / auth.controller.ts 各有一份重复实现,
// 现统一收敛到此模块,保证 X-Forwarded-For 解析语义全局一致
//
// 解析规则(保留现有 XFF 优先语义,以不破现有测试):
//   1. 优先读 X-Forwarded-For 头,取第一个逗号前段(去掉空白)
//   2. XFF 不存在或非 string 时,回退到 req.ip
//   3. 仍取不到则返回 'unknown'
//
// 安全说明:
//   生产环境应通过 Express trust proxy 配置限制可信代理,避免客户端伪造 XFF
//   此处仅做解析,trust proxy 的配置在 app.ts 中
// ============================================================

/** Express Request 的最小子集,便于复用且不强制依赖 express 类型 */
export interface IpSource {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * 从请求中提取客户端 IP(优先 X-Forwarded-For 首段)
 * @param req Express 请求对象或兼容结构
 * @returns 客户端 IP 字符串(可能为 'unknown')
 */
export function getClientIp(req: IpSource): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.ip ?? 'unknown';
}
