// ============================================================
// 丹青有AI - 飞书 OAuth 回调页
// 对应设计:auth-design.md §1.2 步骤 5(HashRouter 兼容方案)
// ============================================================
//
// HashRouter 兼容说明:
// 飞书回调 URL 是 http://localhost:5173/auth/feishu/callback?code=xxx&state=xxx
// (不带 #),HashRouter 不会处理这种路径。
// 因此本页在 main.tsx 中独立渲染(不走 HashRouter),
// 处理完 code/state 后用 window.location.href 跳转到 /#/(首页),
// 让 HashRouter 接管。access_token 已存入 token-store(内存),
// AuthProvider 启动时检测到 token 后调 /auth/me 恢复登录态。

import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import LogoMark from '../components/LogoMark';
import { handleFeishuCallback } from '../services/auth-sdk';
import { ApiError } from '../services/api';
import type { FeishuCallbackQuery } from '../types/api-contract';

type CallbackStatus = 'loading' | 'success' | 'error';

interface ErrorInfo {
  title: string;
  desc: string;
}

/** 从当前 URL 解析飞书回调参数 */
function parseCallbackParams(): { query: FeishuCallbackQuery | null; error: string | null } {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error'); // 用户拒绝授权时飞书传 error=access_denied

  if (error) return { query: null, error };
  if (!code || !state) {
    return {
      query: null,
      error: 'missing_params',
    };
  }
  return { query: { code, state }, error: null };
}

/** 应用 base 路径(Vite 注入,/ 或 /app/) */
const APP_BASE = import.meta.env.BASE_URL;

/** 跳转到首页(HashRouter 兼容) */
function redirectToHome(): void {
  // 用 replace 避免后退回回调页
  // 路径随 vite base 自适应:/#/ (base=/) 或 /app/#/ (base=/app/)
  window.location.replace(`${APP_BASE}#/`);
}

/** 跳转到新手引导页(首次登录选职业身份) */
function redirectToOnboarding(): void {
  window.location.replace(`${APP_BASE}#/onboarding`);
}

/** 跳转到登录页 */
function redirectToLogin(): void {
  window.location.replace(`${APP_BASE}#/login`);
}

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<ErrorInfo>({
    title: '登录失败',
    desc: '请稍后重试',
  });
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    (async () => {
      const { query, error } = parseCallbackParams();

      // 用户拒绝授权
      if (error === 'access_denied') {
        setStatus('error');
        setErrorInfo({
          title: '授权已取消',
          desc: '您已取消飞书授权,请重新点击登录',
        });
        scheduleRedirectToLogin(1500);
        return;
      }

      // 参数缺失(state 校验失败 / 直接访问)
      if (error === 'missing_params' || !query) {
        setStatus('error');
        setErrorInfo({
          title: '回调参数缺失',
          desc: '未收到有效的授权码,请重新登录',
        });
        scheduleRedirectToLogin(1500);
        return;
      }

      // 调用后端处理 code/state
      try {
        const result = await handleFeishuCallback(query);
        setStatus('success');
        // 短暂展示成功态后跳转:
        //   - 首次登录(isFirstLogin=true)→ /onboarding 选职业身份
        //   - 非首次登录 → /#/(首页)
        const target = result.isFirstLogin ? redirectToOnboarding : redirectToHome;
        // 保留 100ms 让用户看到"登录成功"反馈即跳转(原 800ms 明显拖慢首屏)
        setTimeout(target, 100);
      } catch (err) {
        setStatus('error');
        if (err instanceof ApiError) {
          // 按错误码差异化提示(api-contract-v1.md §2.3)
          if (err.code === 4001) {
            setErrorInfo({
              title: '授权校验失败',
              desc: 'state 校验不通过,请重新登录',
            });
          } else if (err.code === 4002 || err.code === 4003) {
            setErrorInfo({
              title: '飞书服务异常',
              desc: '获取飞书用户信息失败,请稍后重试',
            });
          } else if (err.code === 4004) {
            setErrorInfo({
              title: '应用配置错误',
              desc: '飞书应用未正确配置,请联系管理员',
            });
          } else {
            setErrorInfo({
              title: '登录失败',
              desc: err.message,
            });
          }
        } else {
          setErrorInfo({
            title: '网络错误',
            desc: '请检查网络连接后重试',
          });
        }
        scheduleRedirectToLogin(1500);
      }
    })();
  }, []);

  /** 倒计时跳转登录页 */
  function scheduleRedirectToLogin(ms: number): void {
    setTimeout(redirectToLogin, ms);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-rice-200 ink-texture px-4">
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        {/* 朱印 Logo(参考 LogoMark 设计语言) */}
        <div className="relative">
          {/* 水墨晕染光晕(loading 态显示) */}
          {status === 'loading' && (
            <div className="absolute inset-0 rounded-lg bg-cinnabar/20 blur-xl animate-pulse-slow" />
          )}
          <div className="relative">
            <LogoMark />
          </div>
        </div>

        {/* 状态主体 */}
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <div className="relative w-12 h-12 flex items-center justify-center">
              {/* 旋转的青绿圆环(水墨晕染感) */}
              <svg
                className="w-12 h-12 animate-spin"
                viewBox="0 0 48 48"
                style={{ animationDuration: '2.4s' }}
                aria-hidden="true"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="#5b8c5a"
                  strokeWidth="2"
                  strokeDasharray="60 100"
                  strokeLinecap="round"
                  opacity="0.6"
                />
              </svg>
              <Loader2 className="absolute w-5 h-5 text-cinnabar animate-spin" />
            </div>
            <p className="font-serif text-lg text-ink-900">正在登录...</p>
            <p className="text-xs text-ink-400">正在与飞书完成身份验证</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-jade/10">
              <CheckCircle2 className="w-7 h-7 text-jade" />
            </div>
            <p className="font-serif text-lg text-ink-900">登录成功</p>
            <p className="text-xs text-ink-400">正在进入丹青有AI...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 animate-fade-in w-full">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-cinnabar/10">
              <AlertCircle className="w-7 h-7 text-cinnabar" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-serif text-lg text-ink-900">{errorInfo.title}</p>
              <p className="text-xs text-ink-500">{errorInfo.desc}</p>
            </div>
            <p className="text-2xs text-ink-400">1.5 秒后自动返回登录页</p>
            <button
              type="button"
              onClick={redirectToLogin}
              className="mt-2 h-9 px-4 rounded text-sm font-medium bg-rice-50 text-ink-700 border border-ink-900/10 hover:bg-rice-100 hover:border-cinnabar/30 transition-colors"
            >
              立即返回登录页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
