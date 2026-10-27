// ============================================================
// 丹青有AI - 飞书扫码登录组件
// 设计语言:水墨卡片 + 飞书品牌蓝点缀
// 流程:
//   1. 调 createFeishuQR() 获取 { qrCodeUrl, qrToken, state }
//   2. 显示 qrCodeUrl 图片,每 2s 调 pollFeishuQRStatus(qrToken, state)
//   3. status='confirmed' → 登录成功(回调 onLogin)
//   4. status='expired' | 'canceled' → 显示"刷新二维码"按钮
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, QrCode } from 'lucide-react';
import {
  createFeishuQR,
  pollFeishuQRStatus,
  type FeishuQrCodeResponse,
  type FeishuQrStatus,
} from '../../services/auth-sdk';
import type { FeishuCallbackResponse } from '../../types/api-contract';
import { ApiError } from '../../services/api';
import { useToast } from '../ToastProvider';

export interface FeishuQrLoginProps {
  /** 扫码确认登录成功后回调(access_token 已存内存,回调内需调 useAuth().login + navigate) */
  onLogin: (data: FeishuCallbackResponse) => void;
}

/** 扫码状态 → 文案/颜色映射 */
const STATUS_TEXT: Partial<Record<FeishuQrStatus, { text: string; color: string }>> = {
  new: { text: '请使用飞书扫码登录', color: 'text-ink-500' },
  scanned: { text: '已在飞书确认,请在手机上点击同意', color: 'text-jade' },
  expired: { text: '二维码已过期,请刷新', color: 'text-cinnabar' },
  canceled: { text: '已取消,请刷新二维码', color: 'text-ink-400' },
};

const POLL_INTERVAL_MS = 2000;

export default function FeishuQrLogin({ onLogin }: FeishuQrLoginProps) {
  const toast = useToast();
  const [qr, setQr] = useState<FeishuQrCodeResponse | null>(null);
  const [status, setStatus] = useState<FeishuQrStatus | 'loading'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 用 ref 保存最新的 qrToken/state,避免轮询闭包捕获旧值
  const qrRef = useRef<FeishuQrCodeResponse | null>(null);
  const mountedRef = useRef(true);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 防止重复触发 onLogin(后端可能多次返回 confirmed)
  const loginTriggeredRef = useRef(false);

  const clearPollingTimer = useCallback(() => {
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  /** 创建新二维码 */
  const refreshQr = useCallback(async () => {
    clearPollingTimer();
    setStatus('loading');
    setErrorMsg(null);
    setQr(null);
    qrRef.current = null;
    loginTriggeredRef.current = false;

    try {
      const result = await createFeishuQR();
      if (!mountedRef.current) return;
      qrRef.current = result;
      setQr(result);
      setStatus('new');
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof ApiError ? err.message : '获取二维码失败';
      setErrorMsg(msg);
      setStatus('expired'); // 复用"刷新"按钮交互
      if (!(err instanceof ApiError)) {
        toast.error('网络错误', '请检查网络后重试');
      }
    }
  }, [clearPollingTimer, toast]);

  /** 轮询一次状态 */
  const pollOnce = useCallback(async () => {
    const current = qrRef.current;
    if (!current) return;

    try {
      const result = await pollFeishuQRStatus(current.qrToken, current.state);
      if (!mountedRef.current) return;

      // 非终态(new/scanned)继续轮询
      if (result.status === 'new' || result.status === 'scanned') {
        setStatus(result.status);
        pollingTimerRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
        return;
      }

      // 终态:expired / canceled / confirmed
      setStatus(result.status);

      if (result.status === 'confirmed') {
        // 防重复触发
        if (loginTriggeredRef.current) return;
        loginTriggeredRef.current = true;
        clearPollingTimer();
        // 构建 FeishuCallbackResponse 并回调
        onLogin({
          accessToken: result.accessToken!,
          accessTokenExpiresAt: result.accessTokenExpiresAt!,
          isFirstLogin: result.isFirstLogin ?? false,
          user: result.user!,
          tenant: result.tenant!,
        });
        return;
      }

      // expired / canceled:停止轮询,显示刷新按钮
      clearPollingTimer();
    } catch (err) {
      if (!mountedRef.current) return;
      // 轮询失败:网络抖动等,2s 后重试
      const isAuthErr =
        err instanceof ApiError &&
        (err.code === 2001 || err.code === 2003 || err.code === 9005);
      if (isAuthErr) {
        // 业务错误不再重试
        setErrorMsg(err instanceof ApiError ? err.message : '查询失败');
        setStatus('expired');
        clearPollingTimer();
        return;
      }
      // 网络/限流错误:延迟重试
      pollingTimerRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
    }
  }, [clearPollingTimer, onLogin]);

  // 组件挂载:首次创建二维码
  useEffect(() => {
    mountedRef.current = true;
    refreshQr();
    return () => {
      mountedRef.current = false;
      clearPollingTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态变化时启动/停止轮询
  useEffect(() => {
    // loading / expired / canceled / confirmed 都不主动轮询
    if (status !== 'new' && status !== 'scanned') return;
    // 首次进入 new/scanned 时启动轮询(若尚未启动)
    if (pollingTimerRef.current) return;
    pollingTimerRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
    return () => {
      // 仅在状态切换时清理,保留挂载卸载的清理给上面的 effect
    };
  }, [status, pollOnce]);

  // 'loading' 状态无文案(显示 spinner),其他状态查表
  const statusInfo = status === 'loading' ? undefined : STATUS_TEXT[status];

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {/* 二维码区域 */}
      <div className="relative w-56 h-56 rounded-lg border border-ink-900/8 bg-rice-100 p-3 flex items-center justify-center">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-2 text-ink-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-2xs">正在生成二维码...</span>
          </div>
        )}

        {qr && status !== 'loading' && (
          <>
            <img
              src={qr.qrCodeUrl}
              alt="飞书登录二维码"
              loading="lazy"
              className="w-full h-full object-contain"
              // 二维码失效时降低透明度
              style={{ opacity: status === 'expired' || status === 'canceled' ? 0.3 : 1 }}
            />
            {/* 失效蒙层 */}
            {(status === 'expired' || status === 'canceled') && (
              <div className="absolute inset-0 flex items-center justify-center bg-rice-50/80 backdrop-blur-sm rounded-lg">
                <button
                  type="button"
                  onClick={refreshQr}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cinnabar text-white text-xs font-medium shadow-card hover:bg-cinnabar-dark transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  刷新二维码
                </button>
              </div>
            )}
          </>
        )}

        {!qr && status === 'expired' && !errorMsg && (
          <div className="flex flex-col items-center gap-2 text-ink-400">
            <QrCode className="w-10 h-10" />
            <span className="text-2xs">点击下方按钮重新生成</span>
          </div>
        )}
      </div>

      {/* 状态文案 */}
      <div className="text-center min-h-[1.25rem]">
        {errorMsg ? (
          <p className="text-xs text-cinnabar">{errorMsg}</p>
        ) : statusInfo ? (
          <p className={`text-xs ${statusInfo.color}`}>{statusInfo.text}</p>
        ) : (
          <p className="text-xs text-ink-400">请使用飞书 App 扫码</p>
        )}
      </div>

      {/* 操作行:刷新(loading/new/scanned 状态隐藏) */}
      {status !== 'loading' && status !== 'expired' && status !== 'canceled' && (
        <button
          type="button"
          onClick={refreshQr}
          className="text-2xs text-ink-400 hover:text-cinnabar underline decoration-dotted underline-offset-4 transition-colors"
        >
          刷新二维码
        </button>
      )}
    </div>
  );
}
