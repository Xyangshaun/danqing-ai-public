// ============================================================
// 丹青有AI - 注册页
// 设计语言:与 LoginPage 一致(水墨晕染 + 朱砂红 CTA)
// 流程:邮箱 + 密码 + 确认密码 + 姓名 → registerAccount → 自动登录跳首页
// ============================================================

import { useState, useCallback, useMemo, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Shield, Zap, BookOpen, Loader2, Mail, Lock, User, AlertCircle, CheckCircle2,
} from 'lucide-react';
import LogoMark from '../components/LogoMark';
import { MpsBeianBadge } from '../components/MpsBeianBadge';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ToastProvider';
import { registerAccount } from '../services/auth-sdk';
import { ApiError } from '../services/api';

/** 价值主张小图标列表 */
const valueProps: { icon: typeof Shield; title: string; desc: string }[] = [
  { icon: Zap, title: '3 秒诊断', desc: 'AI 即时分析构图、色彩、技法' },
  { icon: BookOpen, title: '专业维度', desc: '美院规范术语,非空泛反馈' },
  { icon: Shield, title: '多形态支持', desc: '绘画、设计、产品、雕塑四类' },
];

/** 密码强度等级(简易启发式,非安全建议) */
function getPasswordStrength(pwd: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (!pwd) return { level: 0, label: '' };
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  const level = score >= 4 ? 3 : score >= 3 ? 2 : 1;
  const label = level === 3 ? '强' : level === 2 ? '中' : '弱';
  return { level: level as 1 | 2 | 3, label };
}

export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const validate = useCallback((): string | null => {
    if (!name.trim()) return '请输入姓名';
    if (name.trim().length > 64) return '姓名最长 64 字符';
    if (!email.trim()) return '请输入邮箱';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '邮箱格式不正确';
    if (password.length < 8) return '密码至少 8 位';
    if (!/[A-Z]/.test(password)) return '密码必须包含大写字母';
    if (!/[a-z]/.test(password)) return '密码必须包含小写字母';
    if (!/\d/.test(password)) return '密码必须包含数字';
    if (password.length > 128) return '密码最长 128 位';
    if (confirmPassword !== password) return '两次输入的密码不一致';
    return null;
  }, [name, email, password, confirmPassword]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;

      const err = validate();
      setFormError(err);
      if (err) return;

      setSubmitting(true);
      try {
        const result = await registerAccount(email.trim(), password, name.trim());
        // 注册成功 → 自动登录(后端已返回 access_token + Cookie 已写入)
        login(result);
        toast.success('注册成功', `欢迎加入丹青有AI,${result.user.name}`);
        navigate('/', { replace: true });
      } catch (err_) {
        if (err_ instanceof ApiError) {
          // 业务错误差异化提示
          if (err_.code === 1001 || err_.code === 4001) {
            setFormError('该邮箱已被注册,请直接登录');
          } else if (err_.code === 9005) {
            setFormError('注册过于频繁,请稍后再试');
          } else if (err_.code === 1003) {
            setFormError('账号已被锁定,请联系管理员');
          } else {
            setFormError(err_.message);
          }
        } else {
          setFormError('网络异常,请稍后重试');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, validate, email, password, name, login, navigate, toast]
  );

  const strengthColor = strength.level === 3 ? 'bg-jade' : strength.level === 2 ? 'bg-gold-dark' : 'bg-cinnabar';

  return (
    <div className="min-h-screen flex items-center justify-center bg-rice-200 ink-texture px-4 py-8 relative overflow-hidden">
      <div
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cinnabar/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-stone/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md">
        <div className="bg-rice-50/95 backdrop-blur-md border border-ink-900/8 rounded-xl shadow-modal p-8 sm:p-10">
          {/* 顶部:Logo + 标题 */}
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="scale-150 mb-2">
              <LogoMark />
            </div>
            <div className="text-center mt-4">
              <h1 className="font-serif text-3xl font-bold text-ink-900 tracking-wide">
                创建账号
              </h1>
              <p className="text-sm text-ink-500 mt-1.5 tracking-wider">
                开启 AI 艺术作业诊断之旅
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

          {/* 注册表单 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {/* 姓名 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-name" className="text-xs text-ink-700">
                姓名
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入真实姓名"
                  maxLength={64}
                  disabled={submitting}
                  className="w-full h-11 pl-9 pr-3 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60"
                />
              </div>
            </div>

            {/* 邮箱 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-email" className="text-xs text-ink-700">
                邮箱
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  maxLength={128}
                  disabled={submitting}
                  className="w-full h-11 pl-9 pr-3 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60"
                />
              </div>
            </div>

            {/* 密码 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-password" className="text-xs text-ink-700">
                密码
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位,含大小写字母和数字"
                  maxLength={128}
                  disabled={submitting}
                  className="w-full h-11 pl-9 pr-3 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60"
                />
              </div>
              {/* 密码强度指示器 */}
              {password && (
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 flex gap-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={[
                          'h-1 flex-1 rounded-full transition-colors',
                          i <= strength.level ? strengthColor : 'bg-ink-900/10',
                        ].join(' ')}
                      />
                    ))}
                  </div>
                  <span className="text-2xs text-ink-400 w-4">{strength.label}</span>
                </div>
              )}
            </div>

            {/* 确认密码 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-confirm" className="text-xs text-ink-700">
                确认密码
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  id="register-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  maxLength={128}
                  disabled={submitting}
                  className={[
                    'w-full h-11 pl-9 pr-9 rounded-md bg-rice-100 border border-ink-900/10 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-cinnabar focus:bg-rice-50 focus:ring-1 focus:ring-cinnabar/30 transition-colors disabled:opacity-60',
                  ].join(' ')}
                />
                {/* 一致性指示 */}
                {confirmPassword && (
                  <CheckCircle2
                    className={[
                      'absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4',
                      confirmPassword === password ? 'text-jade' : 'text-ink-300',
                    ].join(' ')}
                  />
                )}
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
                  注册中...
                </>
              ) : (
                '创建账号'
              )}
            </button>

            {/* 登录链接 */}
            <p className="text-center text-2xs text-ink-500 mt-1">
              已有账号?
              <Link
                to="/login"
                className="ml-1 text-cinnabar hover:text-cinnabar-dark underline decoration-dotted underline-offset-4 transition-colors"
              >
                返回登录
              </Link>
            </p>
          </form>

          {/* 服务协议提示(链接官网法律页面,公安备案/网信办合规要求注册流程可直达) */}
          <p className="text-center text-2xs text-ink-400 mt-5">
            注册即代表同意
            <a href="https://danqing.site/terms" target="_blank" rel="noopener noreferrer" className="underline decoration-ink-400/40 underline-offset-2 hover:text-cinnabar transition-colors">服务协议</a>
            与
            <a href="https://danqing.site/privacy" target="_blank" rel="noopener noreferrer" className="underline decoration-ink-400/40 underline-offset-2 hover:text-cinnabar transition-colors">隐私政策</a>
          </p>

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

        <p className="text-center text-2xs text-ink-400 mt-6">
          © 2026 丹青有AI · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-600 transition-colors">陕ICP备2026023972号</a><MpsBeianBadge /> · <a href="mailto:2692963779@qq.com?subject=%E6%8A%95%E8%AF%89%E4%B8%BE%E6%8A%A5" className="hover:text-ink-600 transition-colors">投诉举报</a>
        </p>
      </div>
    </div>
  );
}
