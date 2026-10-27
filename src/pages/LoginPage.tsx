// ============================================================
// 丹青有AI - 登录页(Tab 式)
// 设计语言:成熟品牌官网感,水墨晕染背景,朱砂红 CTA
// Tab:账号登录(主,邮箱+密码) | 飞书登录(跳转授权页)
// 注:飞书 passport QR create API 不存在(404),改为跳转登录方式
// ============================================================

import { useState, useCallback, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Zap, BookOpen, Loader2, Mail, Lock, AlertCircle, Smartphone } from 'lucide-react';
import LogoMark from '../components/LogoMark';
import { MpsBeianBadge } from '../components/MpsBeianBadge';
import FeishuLoginButton from '../components/auth/FeishuLoginButton';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ToastProvider';
import { loginAccount } from '../services/auth-sdk';
import { ApiError } from '../services/api';
import type { FeishuCallbackResponse } from '../types/api-contract';

type TabKey = 'account' | 'feishu';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'account', label: '账号登录' },
  { key: 'feishu', label: '飞书登录' },
];

/** 价值主张小图标列表 */
const valueProps: { icon: typeof Shield; title: string; desc: string }[] = [
  { icon: Zap, title: '3 秒诊断', desc: 'AI 即时分析构图、色彩、技法' },
  { icon: BookOpen, title: '专业维度', desc: '美院规范术语,非空泛反馈' },
  { icon: Shield, title: '多形态支持', desc: '绘画、设计、产品、雕塑四类' },
];

export default function LoginPage() {
  const { skipLogin, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('account');

  // 账号登录表单
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** 统一登录后处理:set user/tenant + 跳首页 */
  const handleLoginSuccess = useCallback(
    (data: FeishuCallbackResponse) => {
      login(data);
      // 首次登录引导(可选);当前直接跳首页
      navigate('/', { replace: true });
    },
    [login, navigate]
  );

  /** 账号登录表单提交 */
  const handleAccountLogin = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;
      setFormError(null);

      if (!email.trim()) {
        setFormError('请输入邮箱');
        return;
      }
      if (!password) {
        setFormError('请输入密码');
        return;
      }
      // 简易邮箱格式校验(后端会再做 Zod 校验)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFormError('邮箱格式不正确');
        return;
      }

      setSubmitting(true);
      try {
        const result = await loginAccount(email.trim(), password);
        toast.success('登录成功', `欢迎回来,${result.user.name}`);
        handleLoginSuccess(result);
      } catch (err) {
        if (err instanceof ApiError) {
          // 业务错误:差异化提示
          if (err.code === 1002 || err.code === 2001) {
            setFormError('邮箱或密码错误');
          } else if (err.code === 9005) {
            setFormError('登录过于频繁,请稍后再试');
          } else if (err.code === 1003) {
            setFormError('该账号已被锁定,请联系管理员');
          } else {
            setFormError(err.message);
          }
        } else {
          setFormError('网络异常,请稍后重试');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, submitting, toast, handleLoginSuccess]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-rice-200 ink-texture px-4 py-8 relative overflow-hidden">
      {/* 装饰:水墨晕染圆(左上 + 右下) */}
      <div
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cinnabar/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-stone/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* 主体卡片 */}
      <div className="relative w-full max-w-md">
        <div className="bg-rice-50/95 backdrop-blur-md border border-ink-900/8 rounded-xl shadow-modal p-8 sm:p-10">
          {/* 顶部:Logo + 标题 */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="scale-150 mb-2">
              <LogoMark />
            </div>
            <div className="text-center mt-4">
              <h1 className="font-serif text-3xl font-bold text-ink-900 tracking-wide">
                丹青有AI
              </h1>
              <p className="text-sm text-ink-500 mt-1.5 tracking-wider">
                高校艺术教育 AI 作业诊断系统
              </p>
            </div>
          </div>

          {/* 价值主张 */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {valueProps.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-md bg-rice-100 border border-ink-900/4 text-center"
                >
                  <Icon className="w-5 h-5 text-cinnabar" />
                  <p className="text-2xs font-medium text-ink-800">{item.title}</p>
                  <p className="text-2xs text-ink-400 leading-tight">{item.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Tab 切换 */}
          <div className="flex border-b border-ink-900/10 mb-6">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={[
                    'flex-1 py-2.5 text-sm font-medium transition-colors relative',
                    active
                      ? 'text-cinnabar'
                      : 'text-ink-500 hover:text-ink-700',
                  ].join(' ')}
                >
                  {tab.label}
                  {/* 下划线指示器 */}
                  {active && (
                    <span className="absolute bottom-[-1px] left-1/4 right-1/4 h-0.5 bg-cinnabar rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab 内容 */}
          {activeTab === 'account' ? (
            <form onSubmit={handleAccountLogin} className="flex flex-col gap-4" noValidate>
              {/* 邮箱 */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-email" className="text-xs text-ink-700">
                  邮箱
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    disabled={submitting}
                    className="w-full h-11 pl-9 pr-3 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60"
                  />
                </div>
              </div>

              {/* 密码 */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="text-xs text-ink-700">
                  密码
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 8 位,含大小写字母和数字"
                    disabled={submitting}
                    className="w-full h-11 pl-9 pr-3 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60"
                  />
                </div>
              </div>

              {/* 表单错误 */}
              {formError && (
                <div className="flex items-center gap-1.5 text-xs text-cinnabar" role="alert">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* 提交 */}
              <button
                type="submit"
                disabled={submitting}
                className="h-11 w-full inline-flex items-center justify-center gap-2 rounded-md bg-cinnabar text-white text-sm font-medium shadow-card hover:bg-cinnabar-dark hover:shadow-card-hover active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-cinnabar/40 focus:ring-offset-2 focus:ring-offset-rice-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  '登录'
                )}
              </button>

              {/* 注册链接 */}
              <p className="text-center text-2xs text-ink-500 mt-1">
                还没有账号?
                <Link
                  to="/register"
                  className="ml-1 text-cinnabar hover:text-cinnabar-dark underline decoration-dotted underline-offset-4 transition-colors"
                >
                  立即注册
                </Link>
              </p>
            </form>
          ) : (
            // 飞书登录 Tab — 跳转授权页方式(passport QR API 不存在,改为跳转登录)
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="w-16 h-16 rounded-full bg-cinnabar/8 flex items-center justify-center mb-1">
                <Smartphone className="w-8 h-8 text-cinnabar" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-ink-800 mb-1.5">使用飞书账号登录</p>
                <p className="text-2xs text-ink-500 leading-relaxed max-w-xs">
                  点击下方按钮将跳转飞书授权页,授权后自动返回本站完成登录。
                  <br />
                  适合已登录飞书桌面端或网页端的环境。
                </p>
              </div>
              <FeishuLoginButton size="lg" block />
              <p className="text-2xs text-ink-400 mt-1">
                未安装飞书?请先访问
                <a
                  href="https://www.feishu.cn/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-cinnabar hover:text-cinnabar-dark underline decoration-dotted underline-offset-4 transition-colors"
                >
                  飞书下载页
                </a>
              </p>
            </div>
          )}

          {/* 服务协议提示 */}
          <p className="text-center text-2xs text-ink-400 mt-5">
            登录即代表同意服务协议与隐私政策
          </p>

          {/* 跳过登录(仅开发模式) */}
          {import.meta.env.DEV && (
            <div className="mt-3 text-center">
              <button
                onClick={skipLogin}
                className="text-xs text-ink-400 hover:text-cinnabar transition-colors underline decoration-dotted underline-offset-4"
                title="后端未启动时可跳过登录直接体验"
              >
                跳过登录,直接体验
              </button>
            </div>
          )}

          {/* 底部:返回官网(整页跳转至官网首页;?skipIntro=1 跳过开屏动画。
              注意不能用 <Link to="/">:应用 / 路由被 RequireAuth 守卫,未登录会被弹回 /login 形成死循环) */}
          <div className="mt-6 pt-6 border-t border-ink-900/8 text-center">
            <a
              href="/?skipIntro=1"
              className="text-xs text-ink-500 hover:text-cinnabar transition-colors"
              title="返回官网首页"
            >
              返回官网
            </a>
          </div>
        </div>

        {/* 版权信息 */}
        <p className="text-center text-2xs text-ink-400 mt-6">
          © 2026 丹青有AI · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-600 transition-colors">陕ICP备2026023972号</a><MpsBeianBadge /> · <a href="mailto:2692963779@qq.com?subject=%E6%8A%95%E8%AF%89%E4%B8%BE%E6%8A%A5" className="hover:text-ink-600 transition-colors">投诉举报</a>
        </p>
      </div>
    </div>
  );
}
