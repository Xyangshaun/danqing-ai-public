// ============================================================
// 三级确认操作 Hook(管理后台高危操作确认,P-05 DOC-2026-08-014)
// ------------------------------------------------------------
// 三级确认强度(迁移自 server/src/types/api-contract.ts 主副本,L3542):
//   - normal   :基础确认(仅弹窗确认,现有行为)
//   - sensitive:需输入关键字(requireKeyword,如"删除"/"锁定")
//   - high     :需输入当前管理员密码(requirePassword)
//
// 向前兼容:
//   - 现有调用方不传 config.dangerLevel 时,默认 normal 行为完全不变
//   - 保留历史参数 requireText(关键字) 与 requireFeishuCode(飞书验证码)
//   - action 签名改为 (ctx) => Promise<T>,旧调用方 () => Promise<T> 仍兼容
//
// 高危提交流程:
//   - doAction 会把 confirmPassword / confirmKeyword / idempotencyKey
//     通过 ctx 传给 action,由调用方携带:
//       * confirmPassword → 高危请求体(如 LockAdminUserRequest.confirmPassword)
//       * Idempotency-Key → 请求头(防重复扣款/重复删除)
// ============================================================

import { useCallback, useState } from 'react';
import { Modal, Input, App, Button } from 'antd';

/** 三级确认强度(镜像冻结契约 ConfirmDangerLevel) */
export type ConfirmDangerLevel = 'normal' | 'sensitive' | 'high';

/** 高危确认载荷(镜像冻结契约 HighRiskConfirmPayload) */
export interface HighRiskConfirmPayload {
  confirmPassword?: string;
  confirmKeyword?: string;
}

/** 高危操作前端确认配置(镜像冻结契约 ConfirmActionConfig) */
export interface ConfirmActionConfig {
  dangerLevel: ConfirmDangerLevel;
  /** dangerLevel=sensitive 时必填,需输入关键字 */
  requireKeyword?: string;
  /** dangerLevel=high 时必填,需输入当前管理员密码 */
  requirePassword?: boolean;
  /** 幂等键(可选,防重复提交) */
  idempotencyKey?: string;
}

/** 确认上下文:传给 action,供调用方携带到请求体/头 */
export interface ConfirmContext extends HighRiskConfirmPayload {
  /** 幂等键(对应 ConfirmActionConfig.idempotencyKey) */
  idempotencyKey?: string;
}

interface ConfirmOptions {
  title: string;
  content: React.ReactNode;
  okText?: string;
  cancelText?: string;
  okButtonProps?: { danger?: boolean };
  /** [兼容]是否需要输入确认关键字(如输入"删除"以确认) */
  requireText?: string;
  /** [兼容]危险操作红色按钮 */
  danger?: boolean;
  /** [兼容]是否需要飞书验证码二次验证(超管操作) */
  requireFeishuCode?: boolean;
  /** [三级确认]新配置,消费 ConfirmActionConfig 冻结契约 */
  config?: ConfirmActionConfig;
}

/** 6 位纯数字验证码校验 */
function isValidFeishuCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function useConfirmAction() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const confirm = useCallback(
    <T,>(
      opts: ConfirmOptions,
      action: (ctx: ConfirmContext) => Promise<T>,
    ): Promise<T | undefined> => {
      return new Promise<T | undefined>((resolve) => {
        // 三级确认档位:未传 dangerLevel 时默认 normal(向后兼容)
        const level: ConfirmDangerLevel = opts.config?.dangerLevel ?? 'normal';
        // sensitive 档必须有关键字
        const keyword = opts.config?.requireKeyword;
        // high 档是否需输入密码
        const needPassword = level === 'high' && opts.config?.requirePassword === true;

        // 使用 ref 持有可变输入值(避免 Modal.confirm 闭包捕获旧值)
        const stateRef = {
          feishuCode: '',
          confirmText: '',
          password: '',
          countdown: 0,
        };
        let countdownTimer: ReturnType<typeof setInterval> | null = null;
        let modalInstance: ReturnType<typeof Modal.confirm> | null = null;

        /** 构建 Modal 内容(随 stateRef 变化重建) */
        const buildContent = () => (
          <div>
            <div style={{ marginBottom: 12, color: '#6b6b6b', fontSize: 13 }}>
              {opts.content}
            </div>
            {/* sensitive 档:输入关键字(优先取新配置,兼容旧 requireText) */}
            {(level === 'sensitive' || opts.requireText) && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  请输入 <b style={{ color: '#c8392e' }}>{keyword ?? opts.requireText}</b> 以确认:
                </div>
                <Input
                  value={stateRef.confirmText}
                  onChange={(e) => {
                    stateRef.confirmText = e.target.value;
                  }}
                  placeholder={keyword ?? opts.requireText}
                />
              </div>
            )}
            {/* high 档:输入当前管理员密码 */}
            {needPassword && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>请输入当前管理员密码以确认:</div>
                <Input.Password
                  value={stateRef.password}
                  onChange={(e) => {
                    stateRef.password = e.target.value;
                  }}
                  placeholder="当前管理员密码"
                />
              </div>
            )}
            {/* 兼容:飞书动态验证码 */}
            {opts.requireFeishuCode && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>请输入飞书动态验证码:</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Input
                    value={stateRef.feishuCode}
                    onChange={(e) => {
                      // 仅允许输入数字,最多 6 位
                      stateRef.feishuCode = e.target.value.replace(/\D/g, '').slice(0, 6);
                    }}
                    placeholder="6 位数字验证码"
                    maxLength={6}
                    style={{ flex: 1, fontFamily: 'monospace', letterSpacing: 2 }}
                    inputMode="numeric"
                  />
                  <Button
                    size="small"
                    disabled={stateRef.countdown > 0}
                    onClick={() => {
                      // 发送验证码 + 启动 60s 倒计时
                      // TODO: 后端补充 POST /auth/feishu/verify-code 发送接口后接入
                      stateRef.countdown = 60;
                      modalInstance?.update({
                        content: buildContent(),
                        okButtonProps: {
                          danger: opts.danger ?? opts.okButtonProps?.danger,
                          loading,
                        },
                      });
                      countdownTimer = setInterval(() => {
                        stateRef.countdown -= 1;
                        if (stateRef.countdown <= 0) {
                          if (countdownTimer) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                          }
                        }
                        modalInstance?.update({
                          content: buildContent(),
                          okButtonProps: {
                            danger: opts.danger ?? opts.okButtonProps?.danger,
                            loading,
                          },
                        });
                      }, 1000);
                    }}
                  >
                    {stateRef.countdown > 0 ? `${stateRef.countdown}s 后重发` : '发送验证码'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );

        /** 同步 OK 按钮 loading 态(modal.update 解决闭包不响应问题) */
        const syncLoading = (isLoading: boolean) => {
          modalInstance?.update({
            okButtonProps: {
              danger: opts.danger ?? opts.okButtonProps?.danger,
              loading: isLoading,
            },
          });
        };

        const doAction = async () => {
          setLoading(true);
          syncLoading(true);
          try {
            // 组装确认上下文:高危密码 / 敏感关键字 / 幂等键
            const ctx: ConfirmContext = {
              confirmPassword: needPassword ? stateRef.password : undefined,
              confirmKeyword:
                level === 'sensitive' || opts.requireText
                  ? stateRef.confirmText.trim() || undefined
                  : undefined,
              idempotencyKey: opts.config?.idempotencyKey,
            };
            const result = await action(ctx);
            message.success('操作成功');
            resolve(result as T);
          } catch (err) {
            const msg = err instanceof Error ? err.message : '操作失败';
            message.error(msg);
            resolve(undefined);
          } finally {
            setLoading(false);
            syncLoading(false);
          }
        };

        modalInstance = Modal.confirm({
          title: opts.title,
          icon: null,
          width: 440,
          content: buildContent(),
          okText: opts.okText ?? '确认',
          cancelText: opts.cancelText ?? '取消',
          okButtonProps: {
            danger: opts.danger ?? opts.okButtonProps?.danger,
            loading: false,
          },
          onOk: async () => {
            // sensitive:关键字需严格匹配
            if (level === 'sensitive') {
              const expectKw = keyword ?? opts.requireText;
              if (expectKw && stateRef.confirmText.trim() !== expectKw) {
                message.warning(`请输入正确的确认关键字:${expectKw}`);
                return Promise.reject();
              }
            }
            // high:必须输入密码(实际校验由后端 ADMIN_CONFIRM_PASSWORD_MISMATCH=8015 完成)
            if (needPassword && !stateRef.password) {
              message.warning('请输入当前管理员密码');
              return Promise.reject();
            }
            // 兼容:旧 requireText 关键字校验
            if (opts.requireText && stateRef.confirmText.trim() !== opts.requireText) {
              message.warning(`请输入正确的确认文本:${opts.requireText}`);
              return Promise.reject();
            }
            if (opts.requireFeishuCode) {
              if (!isValidFeishuCode(stateRef.feishuCode)) {
                message.warning('请输入 6 位数字飞书验证码');
                return Promise.reject();
              }
              // TODO: 后端补充 POST /auth/feishu/verify-code 校验接口后,
              //       此处应先 await verifyFeishuCode(stateRef.feishuCode) 再执行 doAction
            }
            await doAction();
          },
          onCancel: () => {
            if (countdownTimer) {
              clearInterval(countdownTimer);
              countdownTimer = null;
            }
            resolve(undefined);
          },
        });
      });
    },
    [loading, message],
  );

  return { confirm, loading };
}