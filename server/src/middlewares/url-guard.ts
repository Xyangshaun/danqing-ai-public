// ============================================================
// SSRF 防护中间件
// 对应文档:安全设计 §SSRF 防护
// 用于校验用户提交的 imageUrl,防止服务端发起请求访问内网/元数据
// 拦截:
//   - 非 http(s) 协议(file://、data://、gopher://、ftp:// 等)
//   - localhost 主机名(含 *.localhost)
//   - IPv4 私网/loopback/link-local:
//       127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、
//       192.168.0.0/16、169.254.0.0/16(云元数据服务)
//   - IPv6 私网/loopback/link-local:
//       ::1、fc00::/7(ULA)、fe80::/10、IPv4-mapped (::ffff:a.b.c.d)
//   - IPv4 编码变体(十进制/八进制/十六进制):
//       2130706433、0177.0.0.1、0x7f.0.0.1 等
// 失败时抛 BusinessError(PARAM_INVALID, 'imageUrl 不允许的地址', 400)
// ============================================================

import { isIP } from 'node:net';
import { BusinessError } from './error-handler.js';
import { ErrorCode } from '../types/api-contract.js';

/** 私网 IPv4 CIDR 列表:[网络号(大端序 uint32), 前缀长度] */
const IPV4_PRIVATE_RANGES: readonly (readonly [number, number])[] = [
  [0x7F000000, 8],  // 127.0.0.0/8   (loopback)
  [0x0A000000, 8],  // 10.0.0.0/8    (private class A)
  [0xAC100000, 12], // 172.16.0.0/12 (private class B)
  [0xC0A80000, 16], // 192.168.0.0/16(private class C)
  [0xA9FE0000, 16], // 169.254.0.0/16(link-local / cloud metadata)
];

/**
 * 宽松解析 IPv4 主机名为 32 位无符号整数
 * 支持点分十进制、十进制整数、八进制、十六进制变体
 *  - 127.0.0.1      点分十进制
 *  - 2130706433     单十进制整数
 *  - 0177.0.0.1     点分八进制(每段以 0 开头)
 *  - 0x7f.0.0.1     点分十六进制(每段以 0x 开头)
 *  - 0x7f000001     单十六进制整数
 * 不通过则返回 null(主机名不是 IPv4 字面量)
 */
function parseIPv4Loose(hostname: string): number | null {
  const lower = hostname.toLowerCase();

  // 单整数形式(十进制或十六进制)
  if (/^\d+$/.test(lower)) {
    const n = Number.parseInt(lower, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return n >>> 0;
    }
    return null;
  }
  if (/^0x[0-9a-f]+$/.test(lower)) {
    const n = Number.parseInt(lower, 16);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return n >>> 0;
    }
    return null;
  }

  // 点分形式(每段独立解析十进制/八进制/十六进制)
  const parts = lower.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    let n: number;
    if (/^\d+$/.test(part)) {
      n = Number.parseInt(part, 10);
    } else if (/^0x[0-9a-f]+$/.test(part)) {
      n = Number.parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      n = Number.parseInt(part, 8);
    } else {
      return null;
    }
    if (!Number.isInteger(n) || n < 0 || n > 0xff) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/** 判断 32 位无符号整数形式的 IPv4 是否落在私网/loopback/link-local */
function isPrivateIPv4Uint(val: number): boolean {
  for (const [network, bits] of IPV4_PRIVATE_RANGES) {
    // 位掩码:bits=0 时为 0,否则前 bits 位为 1
    const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
    if ((val & mask) >>> 0 === network >>> 0) {
      return true;
    }
  }
  return false;
}

/** 判断点分十进制 IPv4 是否私网(用于 IPv4-mapped IPv6 提取后) */
function isPrivateIPv4String(ip: string): boolean {
  const val = parseIPv4Loose(ip);
  return val !== null && isPrivateIPv4Uint(val);
}

/**
 * 判断 IPv6 字面量是否落在私网/loopback/link-local
 * 输入为 `node:net.isIP` 认可的规范 IPv6 字符串(hostname 已去括号)
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // ::1 loopback / :: unspecified
  if (lower === '::1' || lower === '::') return true;

  // fc00::/7(Unique Local Address, fc.. 与 fd.. 前缀)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // fe80::/10 link-local
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:a.b.c.d → 提取 IPv4 部分校验
  const v4Mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped && v4Mapped[1]) {
    return isPrivateIPv4String(v4Mapped[1]);
  }

  // IPv4-compatible IPv6(已弃用但需校验): ::a.b.c.d
  const v4Compat = lower.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Compat && v4Compat[1]) {
    return isPrivateIPv4String(v4Compat[1]);
  }

  return false;
}

/** 判断主机名是否为 localhost(含子域 *.localhost) */
function isLocalhostHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost');
}

/**
 * 校验 imageUrl 是否安全(防止 SSRF)
 * 在 service 调用前调用,失败抛 BusinessError(PARAM_INVALID, 400)
 *
 * @param url 用户提交的 imageUrl(已通过 Zod URL 校验)
 * @throws {BusinessError} PARAM_INVALID 'imageUrl 不允许的地址' (HTTP 400)
 */
export function assertSafeImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 必须为合法 URL', 400);
  }

  // 1. 协议白名单(只允许 http/https)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 不允许的地址', 400);
  }

  // 2. 主机名(hostname 自动去除 [],不含端口)
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 不允许的地址', 400);
  }

  // 3. localhost 主机名拦截
  if (isLocalhostHost(hostname)) {
    throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 不允许的地址', 400);
  }

  // 4. IPv4 字面量拦截(宽松解析,覆盖十进制/八进制/十六进制变体)
  const ipv4Val = parseIPv4Loose(hostname);
  if (ipv4Val !== null) {
    if (isPrivateIPv4Uint(ipv4Val)) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 不允许的地址', 400);
    }
    return;
  }

  // 5. IPv6 字面量拦截(规范形式)
  if (isIP(hostname) === 6) {
    if (isPrivateIPv6(hostname)) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, 'imageUrl 不允许的地址', 400);
    }
    return;
  }

  // 6. 普通域名:通过(运行时由下游 fetch 实际解析)
}
