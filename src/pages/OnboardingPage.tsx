// ============================================================
// 丹青有AI - 新手引导页(首次登录选职业身份 + 学习者画像)
// 设计语言:对齐 LoginPage(水墨晕染背景 + 朱印 Logo + 米白卡片)
//
// 业务流程(2026-08-16 诊断理念重构:新增二级选择):
//   1. 飞书 OAuth 首次登录成功 → AuthCallbackPage 跳转 /onboarding
//   2. 第一步:渲染 3 张职业卡片(学生 / 教师 / 院校管理员)
//   3. 选「学生」→ 第二步:学习者画像(艺术爱好者 / 零基础 / 美术生),
//      决定诊断默认模式(美术生 → 艺考诊断,其余 → 教学诊断)
//      选「教师/管理员」→ 直接进首页(画像与权限无关,可在设置页补选)
//
// 安全:
//   - 后端强制 "仅 role=student(默认)可自选一次",已选过的账户调用会 403
//   - 若用户已 onboarding(role≠student)直接访问本页,自动跳首页
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, GraduationCap, BookOpen, Building2, Check, Palette, Sparkles, Award } from 'lucide-react';
import LogoMark from '../components/LogoMark';
import { MpsBeianBadge } from '../components/MpsBeianBadge';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ToastProvider';
import { setUserRole, setLearnerProfile } from '../services/auth-sdk';
import { ApiError } from '../services/api';
import type { UserRole, LearnerProfile } from '../types/api-contract';

/** 职业身份选项配置 */
interface RoleOption {
  role: Exclude<UserRole, 'owner'>;
  icon: typeof GraduationCap;
  title: string;
  desc: string;
  /** 卡片主题色(对应 Tailwind 色板) */
  accent: 'cinnabar' | 'jade' | 'stone';
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'student',
    icon: GraduationCap,
    title: '学生',
    desc: '提交作业,获取 AI 即时诊断与教师反馈',
    accent: 'jade',
  },
  {
    role: 'teacher',
    icon: BookOpen,
    title: '教师',
    desc: '查看班级学生作品,批量评分与个性化指导',
    accent: 'cinnabar',
  },
  {
    role: 'admin',
    icon: Building2,
    title: '院校管理员',
    desc: '管理院系成员、订阅套餐与全局统计看板',
    accent: 'stone',
  },
];

/** 学习者画像选项配置(第二步,仅学生角色) */
interface LearnerOption {
  profile: LearnerProfile;
  icon: typeof Palette;
  title: string;
  desc: string;
  /** 诊断默认模式提示 */
  modeHint: string;
  accent: 'cinnabar' | 'jade' | 'stone';
}

const LEARNER_OPTIONS: LearnerOption[] = [
  {
    profile: 'hobbyist',
    icon: Palette,
    title: '艺术爱好者',
    desc: '有创作习惯,希望获得针对性提升建议',
    modeHint: '默认教学诊断',
    accent: 'jade',
  },
  {
    profile: 'beginner',
    icon: Sparkles,
    title: '零基础入门',
    desc: '刚开始接触艺术,想从兴趣出发稳步进阶',
    modeHint: '默认教学诊断',
    accent: 'stone',
  },
  {
    profile: 'artStudent',
    icon: Award,
    title: '美术生',
    desc: '备考联考/校考,需要客观分档与提分策略',
    modeHint: '默认艺考诊断',
    accent: 'cinnabar',
  },
];

/** 主题色 → Tailwind class 映射(动态拼接避免 purge) */
function accentClasses(accent: RoleOption['accent']): {
  border: string;
  bg: string;
  text: string;
  ring: string;
  hoverBorder: string;
} {
  switch (accent) {
    case 'cinnabar':
      return {
        border: 'border-cinnabar/40',
        bg: 'bg-cinnabar/5',
        text: 'text-cinnabar',
        ring: 'focus:ring-cinnabar/30',
        hoverBorder: 'hover:border-cinnabar',
      };
    case 'jade':
      return {
        border: 'border-jade/40',
        bg: 'bg-jade/5',
        text: 'text-jade',
        ring: 'focus:ring-jade/30',
        hoverBorder: 'hover:border-jade',
      };
    case 'stone':
      return {
        border: 'border-stone/40',
        bg: 'bg-stone/5',
        text: 'text-stone',
        ring: 'focus:ring-stone/30',
        hoverBorder: 'hover:border-stone',
      };
  }
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [selectedRole, setSelectedRole] = useState<RoleOption['role'] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /* 二级选择(2026-08-16):role 步骤选「学生」后进入 learner 步骤 */
  const [step, setStep] = useState<'role' | 'learner'>('role');
  const [selectedProfile, setSelectedProfile] = useState<LearnerProfile | null>(null);

  /* 守卫:已 onboarding(role≠student)的用户直接访问本页 → 跳首页 */
  useEffect(() => {
    if (user && user.role !== 'student') {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  /** 选择职业身份并提交 */
  const handleSelect = useCallback(
    async (role: RoleOption['role']) => {
      if (submitting) return;
      setSelectedRole(role);
      setSubmitting(true);
      try {
        await setUserRole(role);
        // 刷新 AuthContext 的 user 状态(role 已更新)
        await refreshUser();
        // 学生 → 进入学习者画像二级选择;教师/管理员 → 直接进首页
        if (role === 'student') {
          setSubmitting(false);
          setStep('learner');
          return;
        }
        toast.success('职业身份已设置', '正在进入丹青有AI...');
        // 短暂展示成功态后跳首页
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 600);
      } catch (err) {
        setSubmitting(false);
        setSelectedRole(null);
        if (err instanceof ApiError) {
          if (err.code === 2004) {
            // FORBIDDEN:已选过角色(后端业务规则)
            toast.error('已选择过职业身份', '如需修改请联系管理员');
            // 已 onboarding,跳首页
            setTimeout(() => navigate('/', { replace: true }), 1200);
          } else {
            // 其他业务错误(api.ts 已统一 Toast,此处仅兜底)
          }
        } else {
          toast.error('设置失败', '请检查网络后重试');
        }
      }
    },
    [submitting, refreshUser, toast, navigate]
  );

  /** 选择学习者画像并提交(第二步,仅学生) */
  const handleLearnerSelect = useCallback(
    async (profile: LearnerProfile) => {
      if (submitting) return;
      setSelectedProfile(profile);
      setSubmitting(true);
      try {
        await setLearnerProfile(profile);
        await refreshUser();
        toast.success('学习者画像已设置', '正在进入丹青有AI...');
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 600);
      } catch (err) {
        setSubmitting(false);
        setSelectedProfile(null);
        if (!(err instanceof ApiError)) {
          toast.error('设置失败', '请检查网络后重试');
        }
      }
    },
    [submitting, refreshUser, toast, navigate]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-rice-200 ink-texture px-4 py-8 relative overflow-hidden">
      {/* 装饰:水墨晕染圆(左上 + 右下,对齐 LoginPage) */}
      <div
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cinnabar/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-stone/5 blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-2xl">
        <div className="bg-rice-50/95 backdrop-blur-md border border-ink-900/8 rounded-xl shadow-modal p-8 sm:p-10">
          {step === 'role' ? (
            <>
              {/* 顶部:Logo + 标题 */}
              <div className="flex flex-col items-center gap-4 mb-8">
                <div className="scale-150 mb-2">
                  <LogoMark />
                </div>
                <div className="text-center mt-4">
                  <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 tracking-wide">
                    选择您的职业身份
                  </h1>
                  <p className="text-sm text-ink-500 mt-1.5 tracking-wider">
                    为了提供更精准的功能与权限,请选择您的身份
                  </p>
                  <p className="text-2xs text-ink-400 mt-1">
                    选择后仅可由管理员修改,请谨慎选择
                  </p>
                </div>
              </div>

              {/* 职业身份卡片 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {ROLE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const accent = accentClasses(option.accent);
                  const isSelected = selectedRole === option.role;
                  const isSubmittingThis = submitting && isSelected;
                  const isDisabled = submitting && !isSelected;

                  return (
                    <button
                      key={option.role}
                      type="button"
                      onClick={() => handleSelect(option.role)}
                      disabled={submitting}
                      className={[
                        'relative flex flex-col items-center gap-3 p-5 rounded-lg',
                        'bg-rice-100/80 border-2 transition-all duration-200 ease-out',
                        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-rice-50',
                        accent.ring,
                        // 默认态
                        'border-ink-900/8',
                        accent.hoverBorder,
                        'hover:shadow-card hover:-translate-y-0.5',
                        // 选中态
                        isSelected ? `${accent.border} ${accent.bg} shadow-card` : '',
                        // 禁用态(提交中其他卡片)
                        isDisabled ? 'opacity-50 cursor-not-allowed hover:translate-y-0 hover:shadow-none' : '',
                        // 提交中的当前卡片
                        isSubmittingThis ? 'cursor-wait' : 'cursor-pointer',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {/* 图标 */}
                      <div
                        className={`w-12 h-12 flex items-center justify-center rounded-full ${accent.bg} ${accent.text}`}
                      >
                        {isSubmittingThis ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : isSelected ? (
                          <Check className="w-6 h-6" />
                        ) : (
                          <Icon className="w-6 h-6" />
                        )}
                      </div>

                      {/* 标题 */}
                      <p className="font-serif text-base font-bold text-ink-900">
                        {option.title}
                      </p>

                      {/* 描述 */}
                      <p className="text-2xs text-ink-500 leading-relaxed text-center">
                        {option.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* 底部:稍后选择(跳过本次,直接进首页,role 保持 student) */}
              <div className="pt-6 border-t border-ink-900/8 text-center">
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  disabled={submitting}
                  className="text-xs text-ink-400 hover:text-cinnabar transition-colors underline decoration-dotted underline-offset-4 disabled:opacity-50"
                  title="跳过后将以学生身份进入,稍后可在个人设置中重新选择"
                >
                  稍后选择,先以学生身份进入
                </button>
              </div>
            </>
          ) : (
            <>
              {/* 第二步:学习者画像(仅学生角色) */}
              <div className="flex flex-col items-center gap-4 mb-8">
                <div className="scale-150 mb-2">
                  <LogoMark />
                </div>
                <div className="text-center mt-4">
                  <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 tracking-wide">
                    你目前的学习阶段
                  </h1>
                  <p className="text-sm text-ink-500 mt-1.5 tracking-wider">
                    这将决定作品诊断的默认方式与建议深度
                  </p>
                  <p className="text-2xs text-ink-400 mt-1">
                    之后可随时在「设置」中修改
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {LEARNER_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const accent = accentClasses(option.accent);
                  const isSelected = selectedProfile === option.profile;
                  const isSubmittingThis = submitting && isSelected;
                  const isDisabled = submitting && !isSelected;

                  return (
                    <button
                      key={option.profile}
                      type="button"
                      onClick={() => handleLearnerSelect(option.profile)}
                      disabled={submitting}
                      className={[
                        'relative flex flex-col items-center gap-3 p-5 rounded-lg',
                        'bg-rice-100/80 border-2 transition-all duration-200 ease-out',
                        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-rice-50',
                        accent.ring,
                        'border-ink-900/8',
                        accent.hoverBorder,
                        'hover:shadow-card hover:-translate-y-0.5',
                        isSelected ? `${accent.border} ${accent.bg} shadow-card` : '',
                        isDisabled ? 'opacity-50 cursor-not-allowed hover:translate-y-0 hover:shadow-none' : '',
                        isSubmittingThis ? 'cursor-wait' : 'cursor-pointer',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div
                        className={`w-12 h-12 flex items-center justify-center rounded-full ${accent.bg} ${accent.text}`}
                      >
                        {isSubmittingThis ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : isSelected ? (
                          <Check className="w-6 h-6" />
                        ) : (
                          <Icon className="w-6 h-6" />
                        )}
                      </div>
                      <p className="font-serif text-base font-bold text-ink-900">
                        {option.title}
                      </p>
                      <p className="text-2xs text-ink-500 leading-relaxed text-center">
                        {option.desc}
                      </p>
                      <p className={`text-2xs font-medium ${accent.text}`}>
                        {option.modeHint}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="pt-6 border-t border-ink-900/8 text-center">
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  disabled={submitting}
                  className="text-xs text-ink-400 hover:text-cinnabar transition-colors underline decoration-dotted underline-offset-4 disabled:opacity-50"
                  title="跳过后默认按教学诊断,可在设置中随时修改"
                >
                  稍后选择,先默认教学诊断进入
                </button>
              </div>
            </>
          )}
        </div>

        {/* 版权信息 */}
        <p className="text-center text-2xs text-ink-400 mt-6">
          © 2026 丹青有AI · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-600 transition-colors">陕ICP备2026023972号</a><MpsBeianBadge /> · <a href="mailto:2692963779@qq.com?subject=%E6%8A%95%E8%AF%89%E4%B8%BE%E6%8A%A5" className="hover:text-ink-600 transition-colors">投诉举报</a>
        </p>
      </div>
    </div>
  );
}
