// ============================================================
// 告警服务 - 邮件通知
// 职责:
//   1. 发送分级邮件告警(error/warn/info)
//   2. 指数退避重试,失败降级到系统 mail 命令
//   3. 写入审计日志 alert-audit.log
//   4. 同组件同级别冷却,防止邮件轰炸
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { redis } from '../config/redis.js';
import { configFeatureService } from './config-feature.service.js';

export type AlertLevel = 'error' | 'warn' | 'info';
/** 指标告警严重级别(高/中/严重) */
export type AlertSeverity = 'high' | 'medium' | 'critical';

/**
 * 指标快照(与 metrics-aggregation.service 的 OperationalMetricsInternal 结构对齐)
 * 由 evaluateMetrics 消费;结构即契约,双方保持同步
 */
export interface MetricsSnapshot {
  slaComplianceRate: number;
  aiFallbackRate: number;
  fallbackDetails: { jimpOnly: number; templateSuggestion: number; providerSwitch: number };
  providerAvailability: {
    glm: { successRate: number; switchCount: number };
    trae: { successRate: number; switchCount: number };
  };
  analysis: { total: number; successRate: number; avgDurationMs: number };
  costYuanToday: number;
  windowStart: string;
  windowEnd: string;
}

export interface AlertPayload {
  level: AlertLevel;
  component: string;
  title: string;
  message: string;
  traceId?: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
  method?: string;
  ip?: string;
}

interface AlertConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
  maxRetries: number;
  minIntervalMs: number;
}

interface AuditEntry {
  timestamp: string;
  level: AlertLevel;
  component: string;
  title: string;
  to: string;
  subject: string;
  status: 'success' | 'failed';
  attempts: number;
  error?: string;
}

const lastSentMap = new Map<string, number>();

function loadConfig(): AlertConfig {
  const cfg = env();
  return {
    enabled: cfg.alertEnabled,
    host: cfg.alertSmtpHost,
    port: cfg.alertSmtpPort,
    secure: cfg.alertSmtpSecure,
    user: cfg.alertSmtpUser,
    pass: cfg.alertSmtpPass,
    from: cfg.alertFrom,
    to: cfg.alertTo,
    maxRetries: cfg.alertMaxRetries,
    minIntervalMs: cfg.alertMinIntervalMs,
  };
}

function formatTime(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildSubject(payload: AlertPayload): string {
  const levelUpper = payload.level.toUpperCase();
  return `[丹青有AI][${levelUpper}][${formatTime()}][${payload.component}] ${payload.title}`;
}

function buildText(payload: AlertPayload): string {
  const lines: string[] = [
    '丹青有AI 监控系统检测到异常，请尽快处理。',
    '',
    '=== 触发信息 ===',
    `告警级别: ${payload.level.toUpperCase()}`,
    `触发时间: ${formatTime()}`,
    `来源组件: ${payload.component}`,
    `告警标题: ${payload.title}`,
    `目标环境: ${env().nodeEnv}`,
  ];

  if (payload.traceId) lines.push(`Trace ID: ${payload.traceId}`);
  if (payload.url) lines.push(`请求地址: ${payload.method ?? 'UNKNOWN'} ${payload.url}`);
  if (payload.ip) lines.push(`客户端 IP: ${payload.ip}`);

  lines.push('', '=== 详细信息 ===', payload.message);

  if (payload.stack) {
    lines.push('', '=== Stack Trace ===', payload.stack);
  }

  if (payload.context && Object.keys(payload.context).length > 0) {
    lines.push('', '=== 上下文 ===');
    for (const [k, v] of Object.entries(payload.context)) {
      lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }

  lines.push('', '---', '此邮件由 丹青有AI 监控系统自动发送');
  return lines.join('\n');
}

function buildHtml(payload: AlertPayload): string {
  const rows = [
    ['告警级别', `<span style="color:${payload.level === 'error' ? '#dc2626' : payload.level === 'warn' ? '#d97706' : '#2563eb'}">${payload.level.toUpperCase()}</span>`],
    ['触发时间', formatTime()],
    ['来源组件', payload.component],
    ['告警标题', payload.title],
    ['目标环境', env().nodeEnv],
  ];
  if (payload.traceId) rows.push(['Trace ID', payload.traceId]);
  if (payload.url) rows.push(['请求地址', `${payload.method ?? 'UNKNOWN'} ${payload.url}`]);
  if (payload.ip) rows.push(['客户端 IP', payload.ip]);

  const contextRows = payload.context
    ? Object.entries(payload.context).map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb">${k}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>`).join('')
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>丹青有AI 监控告警</title></head>
<body style="font-family:PingFang SC,Microsoft YaHei,sans-serif;line-height:1.6;color:#1f2937;max-width:720px;margin:24px auto;padding:0 16px">
  <h2 style="color:#dc2626;border-bottom:2px solid #e5e7eb;padding-bottom:8px">丹青有AI 监控告警</h2>
  <p>监控系统检测到异常，请尽快处理。</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;width:120px">${k}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${v}</td></tr>`).join('')}
  </table>
  <h3>详细信息</h3>
  <pre style="background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto">${payload.message.replace(/</g, '&lt;')}</pre>
  ${payload.stack ? `<h3>Stack Trace</h3><pre style="background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto;font-size:12px">${payload.stack.replace(/</g, '&lt;')}</pre>` : ''}
  ${contextRows ? `<h3>上下文</h3><table style="width:100%;border-collapse:collapse;margin:16px 0">${contextRows}</table>` : ''}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#6b7280;font-size:12px">此邮件由 丹青有AI 监控系统自动发送</p>
</body>
</html>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendViaNodemailer(config: AlertConfig, subject: string, text: string, html: string): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject,
    text,
    html,
  });
}

async function sendViaCommand(config: AlertConfig, subject: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'mail',
      ['-s', subject, '-r', config.from, config.to],
      { timeout: 30000 },
      (err) => {
        if (err) return reject(err);
        resolve();
      },
    );
    // 若 stdin 为 null(极端情况),立即 reject 交由上层降级处理
    if (proc.stdin) {
      proc.stdin.write(text);
      proc.stdin.end();
    } else {
      reject(new Error('mail command stdin unavailable'));
    }
  });
}

async function sendWithRetry(
  config: AlertConfig,
  subject: string,
  text: string,
  html: string,
): Promise<{ attempts: number; usedCommand: boolean; error?: string }> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      await sendViaNodemailer(config, subject, text, html);
      return { attempts: attempt, usedCommand: false };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < config.maxRetries) {
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  }

  // 降级到系统 mail 命令
  try {
    await sendViaCommand(config, subject, text);
    return { attempts: config.maxRetries, usedCommand: true };
  } catch (err) {
    const cmdErr = err instanceof Error ? err : new Error(String(err));
    return {
      attempts: config.maxRetries,
      usedCommand: true,
      error: `nodemailer: ${lastError?.message}; mail command: ${cmdErr.message}`,
    };
  }
}

function writeAudit(entry: AuditEntry): void {
  try {
    const logDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'alert-audit.log');
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    logger.error({ err }, '[alert] failed to write audit log');
  }
}

function checkCooldown(config: AlertConfig, payload: AlertPayload): boolean {
  const key = `${payload.level}:${payload.component}`;
  const last = lastSentMap.get(key) ?? 0;
  const now = Date.now();
  if (now - last < config.minIntervalMs) {
    return false;
  }
  lastSentMap.set(key, now);
  return true;
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  const config = loadConfig();

  if (!config.enabled) {
    logger.debug({ component: payload.component }, '[alert] disabled, skipping alert');
    return;
  }

  if (!config.pass && config.host === 'smtp.qq.com') {
    logger.warn('[alert] ALERT_SMTP_PASS not configured, skipping email alert');
    return;
  }

  if (!checkCooldown(config, payload)) {
    logger.debug({ component: payload.component, level: payload.level }, '[alert] skipped due to cooldown');
    return;
  }

  const subject = buildSubject(payload);
  const text = buildText(payload);
  const html = buildHtml(payload);

  try {
    const result = await sendWithRetry(config, subject, text, html);
    const status = result.error ? 'failed' : 'success';

    writeAudit({
      timestamp: new Date().toISOString(),
      level: payload.level,
      component: payload.component,
      title: payload.title,
      to: config.to,
      subject,
      status,
      attempts: result.attempts,
      error: result.error,
    });

    if (result.error) {
      logger.error({ error: result.error, attempts: result.attempts }, '[alert] email failed after retries');
    } else {
      logger.info({ attempts: result.attempts, usedCommand: result.usedCommand }, '[alert] email sent');
    }
  } catch (err) {
    logger.error({ err }, '[alert] unexpected error sending alert');
  }
}

// ============================================================
// M3 指标告警服务(对应 m3-observability-plan §5 告警通道设计)
//
// 能力:
//   1. evaluateMetrics(snapshot):阈值判定(SLA 达标率 / AI 降级率 /
//      双提供商可用性 / 提供商切换频繁),供 metrics-aggregation.service 每分钟调用
//   2. sendMetricsAlert:静默窗口(Redis key)+ alerts.log(Winston,always)+ 飞书 webhook(可选)
//   3. fail-safe:任何异常被 catch swallow,不阻断指标采集主链路(门禁 M3-4)
//   4. 特性开关:alerting 默认 disabled,关闭时 fail-closed 不触发(门禁 M3-4/D7)
//
// 不暴露 HTTP 契约:告警通道为后端内部能力,不新增 /api/admin/alerts/* 接口
// (契约铁律:api-contract.ts 已冻结,不新增 AlertRule/AlertEvent 类型)
// ============================================================

const SILENCE_PREFIX = 'metrics:alert:silence:';

class AlertServiceClass {
  /**
   * 评估指标快照并触发阈值告警(M3-T7)
   * @param snapshot 近 1 分钟指标快照(由 metrics-aggregation.service 构造)
   */
  async evaluateMetrics(snapshot: MetricsSnapshot): Promise<void> {
    // 告警通道特性开关(fail-closed):默认关闭,不触发任何告警
    if (!configFeatureService.isAlertingEnabled()) {
      logger.debug('[alert] alerting feature disabled, skipping metrics evaluation');
      return;
    }

    const cfg = env();
    const rules: Array<{
      type: string;
      severity: AlertSeverity;
      message: string;
      silenceMinutes: number;
    }> = [];

    // 1. SLA 达标率低(默认阈值 0.99,低于则告警)
    if (snapshot.slaComplianceRate < cfg.alertSlaComplianceRateThreshold) {
      rules.push({
        type: 'sla_compliance_low',
        severity: 'high',
        message: `SLA 达标率 ${snapshot.slaComplianceRate.toFixed(4)} 低于阈值 ${cfg.alertSlaComplianceRateThreshold}(近 1 分钟)`,
        silenceMinutes: cfg.alertSilenceMinutes,
      });
    }

    // 2. AI 降级率高(默认阈值 0.1,高于则告警)
    if (snapshot.aiFallbackRate > cfg.alertAiFallbackRateThreshold) {
      rules.push({
        type: 'ai_fallback_high',
        severity: 'high',
        message: `AI 降级率 ${snapshot.aiFallbackRate.toFixed(4)} 高于阈值 ${cfg.alertAiFallbackRateThreshold}(近 1 分钟),Jimp-only 降级 ${snapshot.fallbackDetails.jimpOnly} 次,模板建议降级 ${snapshot.fallbackDetails.templateSuggestion} 次`,
        silenceMinutes: cfg.alertSilenceMinutes,
      });
    }

    // 3. 双提供商均不可用(glm 与 trae successRate 均 < 0.5)
    const glmOk = snapshot.providerAvailability.glm.successRate >= 0.5;
    const traeOk = snapshot.providerAvailability.trae.successRate >= 0.5;
    if (!glmOk && !traeOk) {
      rules.push({
        type: 'provider_all_unavailable',
        severity: 'critical',
        message: `双提供商均不可用:glm 成功率 ${snapshot.providerAvailability.glm.successRate.toFixed(4)},trae 成功率 ${snapshot.providerAvailability.trae.successRate.toFixed(4)}(近 1 分钟)`,
        silenceMinutes: 60,
      });
    }

    // 4. 提供商切换频繁(glm+trae switchCount 合计 > 10)
    const switchCount = snapshot.providerAvailability.glm.switchCount + snapshot.providerAvailability.trae.switchCount;
    if (switchCount > 10) {
      rules.push({
        type: 'provider_switch_frequent',
        severity: 'medium',
        message: `提供商切换频繁:${switchCount} 次 > 10(近 1 分钟)`,
        silenceMinutes: 15,
      });
    }

    // 逐条发送(fail-safe:单条失败不影响其余)
    for (const rule of rules) {
      try {
        await this.sendMetricsAlert(rule.type, rule.severity, rule.message, rule.silenceMinutes);
      } catch (err) {
        logger.error({ err: (err as Error).message, type: rule.type }, '[alert] metrics alert send failed');
      }
    }
  }

  /**
   * 单条指标告警发送(静默窗口 + alerts.log + 飞书 webhook)
   * fail-safe:飞书/webhook 失败不阻断;静默窗口内不重复
   */
  private async sendMetricsAlert(
    type: string,
    severity: AlertSeverity,
    message: string,
    silenceMinutes: number,
  ): Promise<void> {
    const silenceKey = `${SILENCE_PREFIX}${type}`;

    // 1. 静默窗口检查(Redis key 存在则跳过;读失败 fail-open 到发送)
    try {
      const silenced = await redis().get(silenceKey);
      if (silenced) {
        logger.debug({ type }, '[alert] suppressed by silence window');
        return;
      }
    } catch {
      // Redis 不可用:fail-open,继续发送(告警优先于防重复)
    }

    // 2. alerts.log(Winston,always;不记录敏感信息)
    logger.warn({ type, severity, message, traceId: '-', tenantId: '-' }, '[alert] threshold exceeded');

    // 3. 飞书 webhook(可选;失败不阻断,仅记日志)
    if (env().alertFeishuWebhookUrl) {
      try {
        await this.sendFeishu(type, severity, message);
      } catch (err) {
        logger.error({ err: (err as Error).message, type }, '[alert] feishu webhook failed');
      }
    }

    // 4. 设置静默窗口(防止告警轰炸)
    try {
      await redis().set(silenceKey, '1', 'EX', silenceMinutes * 60);
    } catch {
      // 写失败仅影响防重复,不阻断
    }
  }

  /**
   * 发送飞书交互卡片(可选;3 秒超时避免阻塞指标采集)
   * 支持飞书 webhook 签名校验(X-Lark-Signature / X-Lark-Request-Timestamp)
   */
  private async sendFeishu(type: string, severity: AlertSeverity, message: string): Promise<void> {
    const url = env().alertFeishuWebhookUrl;
    const secret = env().alertFeishuSecret;
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const template = severity === 'critical' ? 'red' : severity === 'high' ? 'orange' : 'yellow';
    const payload: Record<string, unknown> = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `[丹青有AI][${severity}] 指标告警` },
          template,
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: message } },
          { tag: 'hr' },
          {
            tag: 'note',
            elements: [
              { tag: 'plain_text', content: `类型:${type}\n时间:${new Date().toISOString()}` },
            ],
          },
        ],
      },
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      const stringToSign = `${timestamp}\n${secret}`;
      const signature = createHmac('sha256', stringToSign).digest('base64');
      headers['X-Lark-Signature'] = signature;
      headers['X-Lark-Request-Timestamp'] = timestamp;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const alertService = new AlertServiceClass();
