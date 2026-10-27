// ============================================================
// 日志工具(Winston + 脱敏 redactor)
// 对应文档:auth-design.md §3.9 日志脱敏规则
// 严禁日志输出:access_token / refresh_token 明文 / App Secret / 完整手机号 / 完整邮箱
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import Transport from 'winston-transport';
import { env } from '../config/env.js';

/**
 * 脱敏规则表(auth-design.md §3.9)
 * - token 类:仅保留前 8 字符 + "..."
 * - App Secret:完全掩码 ****
 * - 手机号:中间 4 位掩码 138****1234
 * - 邮箱:用户名首尾 + 域名 z***@example.com
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'app_secret',
  'appSecret',
  'feishu_app_secret',
  'feishuAppSecret',
  'client_secret',
  'clientSecret',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'feishu_access_token',
  'private_key',
  'privateKey',
  'jwt_private_key',
  'jwtPrivateKey',
];

function maskToken(value: string): string {
  if (typeof value !== 'string') return '****';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 8)}...`;
}

function maskPhone(value: string): string {
  if (typeof value !== 'string') return '****';
  // 中国手机号:11 位,中间 4 位掩码
  const m = value.match(/^(\+?\d{1,3}[- ]?)?(\d{3})(\d{4})(\d{4})$/);
  if (m) {
    return `${m[1] ?? ''}${m[2]}****${m[4]}`;
  }
  return maskToken(value);
}

function maskEmail(value: string): string {
  if (typeof value !== 'string') return '****';
  const m = value.match(/^([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (m) {
    return `${m[1]}***@${m[2]}`;
  }
  return maskToken(value);
}

/**
 * 深度脱敏对象(原地递归 mutate)
 *
 * 关键设计:必须原地修改传入对象并返回同一引用,不可创建新对象。
 * winston 的 info 对象携带 Symbol 键元数据(Symbol.for('level')/Symbol.for('message')/
 * Symbol.for('splat')),这些是非枚举属性,Object.entries/Object.keys 不会遍历到。
 * 若创建新对象(如 `const out = {}; Object.entries(obj).forEach(...)`)会丢失这些 Symbol,
 * 导致 winston Console/File transport 静默丢弃日志条目(app.log/out.log 0 字节)。
 *
 * 修复历史:G7 修复日志丢失问题 —— redactFormat 返回新对象导致 transports 静默失败。
 */
function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) {
    // 数组:递归 mutate 元素(数组元素本身无敏感键,只处理嵌套对象)
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (v !== null && typeof v === 'object') {
        redact(v);
      }
    }
    return obj;
  }
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const keyLower = k.toLowerCase();
      const v = o[k];
      if (SENSITIVE_KEYS.includes(keyLower) || SENSITIVE_KEYS.includes(k)) {
        // token 类按 8 字符脱敏
        o[k] = typeof v === 'string' ? maskToken(v) : '****';
      } else if (keyLower === 'phone' || keyLower === 'mobile' || keyLower === 'phone_number') {
        o[k] = typeof v === 'string' ? maskPhone(v) : '****';
      } else if (keyLower === 'email') {
        o[k] = typeof v === 'string' ? maskEmail(v) : '****';
      } else if (v !== null && typeof v === 'object') {
        redact(v);
      }
    }
    return obj;
  }
  return obj;
}

const redactFormat = winston.format((info) => {
  if (info && typeof info === 'object') {
    // 原地 mutate,保留 winston Symbol 元数据 —— 不可返回新对象
    redact(info);
  }
  return info;
});

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  redactFormat(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(redact(meta))}` : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  }),
);

let loggerInstance: winston.Logger | null = null;

/**
 * 邮件告警 Transport
 * 对 warn/error 级别的日志自动发送邮件,但跳过自身产生的日志(skipAlert=true)
 */
class AlertTransport extends Transport {
  constructor() {
    super({ level: 'warn' });
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    if (info.skipAlert === true) {
      callback();
      return;
    }

    // 动态导入避免循环依赖:logger -> alert.service -> logger
    import('../services/alert.service.js')
      .then(({ sendAlert }) => {
        const level = String(info.level ?? 'warn');
        const message = String(info.message ?? '');
        const component = String((info.service as string) ?? 'server');
        const traceId = info.traceId ? String(info.traceId) : undefined;
        const stack = info.stack ? String(info.stack) : undefined;

        // 提取上下文(排除内部字段)
        const { level: _l, message: _m, service: _s, timestamp: _t, skipAlert: _sa, ...context } = info;

        void sendAlert({
          level: level as 'error' | 'warn',
          component,
          title: message,
          message,
          traceId,
          stack,
          context: Object.keys(context).length > 0 ? context : undefined,
        });
      })
      .catch(() => {
        // 告警服务加载失败时静默,避免影响主日志
      });

    callback();
  }
}

/**
 * 获取 Winston logger 单例
 * 在 src/index.ts 启动时已通过 import 链初始化
 */
export function initLogger(): winston.Logger {
  if (loggerInstance) {
    return loggerInstance;
  }
  const cfg = env();

  // 确保 logs 目录存在(File transport 兜底需要)
  const logDir = path.resolve(process.cwd(), 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // 忽略:目录已存在或无权限,File transport 会自行处理错误
  }

  const transports: winston.transport[] = [
    // stdout/stderr(PM2 捕获,当前环境因非 TTY socket 导致 Console transport 不落地)
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // 文件兜底:直接写 ./logs/app.log,绕过 stdout/stderr 链路
    // 解决 PM2 fork + Node 20 ESM + 非 TTY 环境下 Console transport 日志丢失问题
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      format: consoleFormat,
      level: cfg.logLevel,
      maxsize: 10 * 1024 * 1024, // 10MB 单文件上限
      maxFiles: 5, // 最多保留 5 个轮转文件(app.log, app.log.1, ... app.log.5)
    }),
  ];

  // 邮件告警 Transport(仅告警开关开启时挂载,避免无 SMTP 配置时每次 warn/error 都尝试发信)
  // 对应 M3 可观测性规划 §5(告警通道)
  if (cfg.alertEnabled) {
    transports.push(new AlertTransport());
  }

  loggerInstance = winston.createLogger({
    level: cfg.logLevel,
    format: logFormat,
    defaultMeta: { service: 'danqing-ai-server' },
    transports,
    exitOnError: false,
  });
  return loggerInstance;
}

/**
 * 自定义日志方法类型
 * 支持两种调用顺序(便于业务代码):
 *   logger.info('message', { meta })
 *   logger.info({ meta }, 'message')
 *   logger.info({ meta, message: 'message' })
 *   logger.info('plain message')
 */
type LogMethod = (
  arg1: string | Record<string, unknown>,
  arg2?: string | Record<string, unknown>,
) => void;

interface WrappedLogger {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  verbose: LogMethod;
  silly: LogMethod;
}

/**
 * 将业务调用规整为 winston 标准调用(message 在前,meta 在后)
 */
function dispatch(
  level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly',
  arg1: string | Record<string, unknown>,
  arg2?: string | Record<string, unknown>,
): void {
  if (!loggerInstance) {
    loggerInstance = initLogger();
  }
  if (typeof arg1 === 'string') {
    // logger.info('msg', meta?)
    if (arg2 !== undefined && typeof arg2 === 'object') {
      loggerInstance[level](arg1, arg2);
    } else {
      loggerInstance[level](arg1);
    }
    return;
  }
  // arg1 为对象:logger.info({ ...meta }, 'msg'?)
  if (typeof arg2 === 'string') {
    loggerInstance[level](arg2, arg1);
  } else {
    loggerInstance[level](arg1);
  }
}

const wrappedLogger: WrappedLogger = {
  error: (a1, a2) => dispatch('error', a1, a2),
  warn: (a1, a2) => dispatch('warn', a1, a2),
  info: (a1, a2) => dispatch('info', a1, a2),
  debug: (a1, a2) => dispatch('debug', a1, a2),
  verbose: (a1, a2) => dispatch('verbose', a1, a2),
  silly: (a1, a2) => dispatch('silly', a1, a2),
};

/**
 * 获取 logger 单例
 * 业务代码统一使用:logger.info({ meta }, 'message') 或 logger.info('message', { meta })
 * 注意:第一次调用时会触发 initLogger,要求 env() 已初始化
 */
export const logger: WrappedLogger = wrappedLogger;

export default logger;
