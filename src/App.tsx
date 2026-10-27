import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import ErrorBoundary from './components/ErrorBoundary';
import PageSkeleton, { type PageSkeletonVariant } from './components/PageSkeleton';
import RouteTransition from './components/RouteTransition';
import { ToastProvider } from './components/ToastProvider';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/auth/RequireAuth';
import PermissionToast from './components/auth/PermissionToast';
import { useTheme } from './hooks/useTheme';
/* 鉴权相关页面懒加载(非首屏,按需加载以减小首屏 chunk) */
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
/* 首页直接加载(首屏优先级最高) */
import HomePage from './pages/HomePage';

/* 其他页面懒加载,按需打包 */
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));
/* AI 生成页(M-2 遗留接线,M4-T7 补 /generation 路由;含风格迁移三模式) */
const GenerationPage = lazy(() => import('./pages/GenerationPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const GrowthPage = lazy(() => import('./pages/GrowthPage'));
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'));
const StylesPage = lazy(() => import('./pages/StylesPage'));
const FusePage = lazy(() => import('./pages/FusePage'));
const EmotionPage = lazy(() => import('./pages/EmotionPage'));
const CanvasPage = lazy(() => import('./pages/CanvasPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ImageSearchPage = lazy(() => import('./pages/ImageSearchPage'));
/* 管理后台页面(RequireAdminRole 守卫,仅 admin/owner 可见) */
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
/* 临时预览页:一致性卡片模拟数据(本地验证用) */
const ConsistencyPreviewPage = lazy(() => import('./pages/admin/ConsistencyPreviewPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'));
const AdminTenantsPage = lazy(() => import('./pages/admin/AdminTenantsPage'));
/* 标注反馈看板(反馈闭环 Phase 5 批次②:数据飞轮) */
const AdminFeedbackPage = lazy(() => import('./pages/admin/AdminFeedbackPage'));
/* 教师工作台页面(RequireTeacherRole 守卫,teacher/admin/owner 可见) */
const TeacherStudentsPage = lazy(() => import('./pages/teacher/TeacherStudentsPage'));
const TeacherStudentDetailPage = lazy(() => import('./pages/teacher/TeacherStudentDetailPage'));
const TeacherDisputesPage = lazy(() => import('./pages/teacher/TeacherDisputesPage'));
/* 教师班级管理页面(RequireTeacherRole 守卫) */
const TeacherClassesPage = lazy(() => import('./pages/teacher/TeacherClassesPage'));
const TeacherClassDetailPage = lazy(() => import('./pages/teacher/TeacherClassDetailPage'));
const TeacherClassStudentWorksPage = lazy(() => import('./pages/teacher/TeacherClassStudentWorksPage'));
const TeacherClassReviewPage = lazy(() => import('./pages/teacher/TeacherClassReviewPage'));
/* 教师评分档案页面(RequireTeacherRole 守卫,双阶段反馈框架 Phase 2) */
const TeacherGradingProfilesPage = lazy(() => import('./pages/teacher/TeacherGradingProfilesPage'));
const TeacherGradingProfileEditPage = lazy(() => import('./pages/teacher/TeacherGradingProfileEditPage'));
const TeacherInsightsPage = lazy(() => import('./pages/teacher/TeacherInsightsPage'));
/* 学生加入班级页(所有登录用户可访问,仅外层 RequireAuth 守卫) */
const JoinClassPage = lazy(() => import('./pages/student/JoinClassPage'));
/* 我的班级(所有登录用户可访问:班级列表 + 班级空间) */
const MyClassesPage = lazy(() => import('./pages/student/MyClassesPage'));
const ClassSpacePage = lazy(() => import('./pages/student/ClassSpacePage'));
/* 报告预览页(报告导出:PDF 打印 + PNG 图片卡片) */
const ReportPreviewPage = lazy(() => import('./pages/report/ReportPreviewPage'));
/* 组织动态流(分享作品 + 评论互鉴,所有登录用户可访问) */
const OrgFeedPage = lazy(() => import('./pages/OrgFeedPage'));
import RequireAdminRole from './components/auth/RequireAdminRole';
import RequireTeacherRole from './components/auth/RequireTeacherRole';

/**
 * 受保护的业务布局(Header + Sidebar + Main + StatusBar)
 * 由 RequireAuth 包裹,未登录跳转 /login
 */
export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  /* 应用主题与界面密度(从 localStorage 读取,设置 data-theme/data-density) */
  useTheme();

  /* 全局快捷键:
   *   1-7 跳转模块、0 跳转设置、N 新建诊断、B 折叠侧栏、/ 打开命令面板
   *   Esc 关闭命令面板与通知面板(任何位置均可触发,不检查输入框)
   *   r/R 在分析页触发重新分析(analyze-reset)
   *   Ctrl/Cmd+Z 在分析页撤销到上传前(analyze-reset) */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      /* Esc:关闭命令面板与通知面板(不检查输入框状态,任何位置均可关闭弹窗) */
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('close-command-palette'));
        window.dispatchEvent(new CustomEvent('close-notification-panel'));
        return;
      }

      /* Ctrl/Cmd + Z:仅在分析页触发撤销到上传前(需检查修饰键,必须在通用修饰键早退之前处理) */
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        if (location.pathname === '/analyze') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('analyze-reset'));
        }
        return;
      }

      /* 以下快捷键:输入框中不触发,且忽略单独的修饰键 */
      if (isInInput) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const map: Record<string, string> = {
        h: '/',
        H: '/',
        '1': '/analyze',
        '2': '/materials',
        '3': '/styles',
        '4': '/fuse',
        '5': '/emotion',
        '6': '/history',
        '7': '/growth',
        '8': '/images',
        '9': '/org/feed',
        '0': '/settings',
      };
      const path = map[e.key];
      if (path) {
        e.preventDefault();
        navigate(path);
        return;
      }

      /* N:新建诊断 */
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        navigate('/analyze');
        return;
      }

      /* B:切换侧栏折叠状态(画布页 B 键用于切换笔刷,跳过避免冲突) */
      if (e.key === 'b' || e.key === 'B') {
        if (location.pathname === '/canvas') return;
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }

      /* R:仅在分析页触发重新分析(通过自定义事件通知 AnalysisPage 重置) */
      if (e.key === 'r' || e.key === 'R') {
        if (location.pathname === '/analyze') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('analyze-reset'));
        }
        return;
      }

      /* /:打开命令面板(通过自定义事件触发 Header 中的逻辑) */
      if (e.key === '/') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-command-palette'));
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, location.pathname]);

  /* 路由切换时关闭移动端侧栏 */
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  /* 按当前路由选择对应骨架屏变体,让懒加载 fallback 更贴合目标页面
     (此前所有路由都用 generic「正在准备工作台」,设置页会误导为工作台) */
  const routeSkeletonVariant: PageSkeletonVariant =
    location.pathname === '/settings' ? 'settings'
    : location.pathname === '/history' ? 'history'
    : location.pathname === '/analyze' ? 'analysis'
    : location.pathname === '/' ? 'home'
    : 'generic';

  return (
    <div className="h-screen flex flex-col bg-rice-200 overflow-hidden">
      {/* 顶部全局栏 */}
      <Header />

      <div className="flex-1 flex overflow-hidden">
        {/* 桌面端:固定侧栏(h-full 将 flex-1 高度传递给 aside,保证 Sidebar 内 nav 滚动生效) */}
        <div className="hidden md:block h-full">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((v) => !v)}
          />
        </div>

        {/* 移动端:抽屉式侧栏 */}
        {mobileSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <div
              className="absolute left-0 top-0 bottom-0 animate-slide-left"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar collapsed={false} onToggle={() => setMobileSidebarOpen(false)} />
            </div>
            <button
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-rice-50 text-ink-700 rounded-md shadow-overlay"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 主内容区 */}
        <main className="flex-1 overflow-y-auto scrollbar-thin relative">
          {/* 移动端侧栏触发按钮 */}
          <button
            className="md:hidden fixed top-16 left-2 z-30 w-9 h-9 flex items-center justify-center bg-rice-50 border border-ink-900/10 rounded-md shadow-card"
            onClick={() => setMobileSidebarOpen(true)}
            title="打开导航"
            aria-label="打开菜单"
          >
            <Menu className="w-4 h-4 text-ink-700" />
          </button>

          {/* 每个路由独立 ErrorBoundary + Suspense 骨架屏 + 路由淡入
              key=pathname 让路由切换时 ErrorBoundary 重新挂载,避免单个页面报错后所有页面都显示降级 UI;
              RouteTransition 在 ErrorBoundary 内部播放淡入动画(不影响错误边界/认证守卫逻辑) */}
          <ErrorBoundary key={location.pathname}>
            <RouteTransition locationKey={location.pathname}>
              <Suspense fallback={<PageSkeleton variant={routeSkeletonVariant} />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/analyze" element={<AnalysisPage />} />
                  {/* AI 生成(M4-T7 接线:与 AI 诊断同为创作工具核心入口,外层 RequireAuth 统一守卫) */}
                  <Route path="/generation" element={<GenerationPage />} />
                  <Route path="/materials" element={<MaterialsPage />} />
                  <Route path="/styles" element={<StylesPage />} />
                  <Route path="/fuse" element={<FusePage />} />
                  <Route path="/emotion" element={<EmotionPage />} />
                  <Route path="/canvas" element={<CanvasPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/growth" element={<GrowthPage />} />
                  <Route path="/images" element={<ImageSearchPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  {/* 管理后台(仅 admin/owner;RequireAdminRole 内部已处理无权限降级 UI) */}
                  <Route
                    path="/admin"
                    element={
                      <RequireAdminRole>
                        <AdminDashboardPage />
                      </RequireAdminRole>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <RequireAdminRole>
                        <AdminUsersPage />
                      </RequireAdminRole>
                    }
                  />
                  <Route
                    path="/admin/tenants"
                    element={
                      <RequireAdminRole>
                        <AdminTenantsPage />
                      </RequireAdminRole>
                    }
                  />
                  <Route
                    path="/admin/feedback"
                    element={
                      <RequireAdminRole>
                        <AdminFeedbackPage />
                      </RequireAdminRole>
                    }
                  />
                  {/* 教师工作台(teacher/admin/owner;RequireTeacherRole 内部已处理无权限降级 UI) */}
                  <Route
                    path="/teacher"
                    element={
                      <RequireTeacherRole>
                        <TeacherStudentsPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/students/:studentId"
                    element={
                      <RequireTeacherRole>
                        <TeacherStudentDetailPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/disputes"
                    element={
                      <RequireTeacherRole>
                        <TeacherDisputesPage />
                      </RequireTeacherRole>
                    }
                  />
                  {/* 教师班级管理(teacher/admin/owner) */}
                  <Route
                    path="/teacher/classes"
                    element={
                      <RequireTeacherRole>
                        <TeacherClassesPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/classes/:classId"
                    element={
                      <RequireTeacherRole>
                        <TeacherClassDetailPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/classes/:classId/students/:studentId/works"
                    element={
                      <RequireTeacherRole>
                        <TeacherClassStudentWorksPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/classes/:classId/students/:studentId/works/:analysisId/review"
                    element={
                      <RequireTeacherRole>
                        <TeacherClassReviewPage />
                      </RequireTeacherRole>
                    }
                  />
                  {/* 教师评分档案(双阶段反馈框架 Phase 2:列表 + 编辑,teacher/admin/owner) */}
                  <Route
                    path="/teacher/grading-profiles"
                    element={
                      <RequireTeacherRole>
                        <TeacherGradingProfilesPage />
                      </RequireTeacherRole>
                    }
                  />
                  <Route
                    path="/teacher/grading-profiles/:profileId"
                    element={
                      <RequireTeacherRole>
                        <TeacherGradingProfileEditPage />
                      </RequireTeacherRole>
                    }
                  />
                  {/* 教师教学画像(反馈闭环 Phase 5 批次④:本人画像 + 采纳历史) */}
                  <Route
                    path="/teacher/insights"
                    element={
                      <RequireTeacherRole>
                        <TeacherInsightsPage />
                      </RequireTeacherRole>
                    }
                  />
                  {/* 学生加入班级(所有登录用户可访问) */}
                  <Route path="/join-class" element={<JoinClassPage />} />
                  {/* 我的班级:列表 + 班级空间(所有登录用户可访问) */}
                  <Route path="/classes" element={<MyClassesPage />} />
                  <Route path="/classes/:classId" element={<ClassSpacePage />} />
                  <Route path="/report/:id" element={<ReportPreviewPage />} />
                  <Route path="/org/feed" element={<OrgFeedPage />} />
                </Routes>
              </Suspense>
            </RouteTransition>
          </ErrorBoundary>
        </main>
      </div>

      {/* 底部状态栏 */}
      <StatusBar />
    </div>
  );
}

/**
 * 应用根组件
 *
 * 路由结构:
 * - /login          公开路由(登录页)
 * - /onboarding     受保护路由(首次登录选职业身份,RequireAuth 守卫但不走 AppLayout)
 * - /*              受保护路由(RequireAuth 包裹 AppLayout)
 *
 * 注:/auth/feishu/callback 不在此处路由,由 main.tsx 检测 pathname 独立渲染
 * AuthCallbackPage(HashRouter 兼容方案,见 auth-design.md §1.2 步骤 5)
 *
 * /onboarding 设计:
 *   - 由 RequireAuth 守卫(必须已登录才能选角色)
 *   - 不走 AppLayout(无 Header/Sidebar/StatusBar,全屏引导)
 *   - OnboardingPage 内部守卫:若用户 role≠student(已 onboarding)自动跳首页
 */
function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        {/* 根 Suspense:覆盖懒加载的 LoginPage/RegisterPage/OnboardingPage。
            AppLayout 内部路由已有独立 Suspense(L188),互不干扰。 */}
        <Suspense fallback={<PageSkeleton variant="generic" />}>
          <Routes>
            {/* 公开路由:登录页 + 注册页(无需鉴权) */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* 临时公开预览路由:一致性卡片模拟数据预览(本地验证用,勿依赖) */}
            <Route path="/preview/consistency" element={<ConsistencyPreviewPage />} />

            {/* 受保护路由:新手引导(全屏,不走 AppLayout) */}
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />

            {/* 受保护路由:所有业务页面(RequireAuth 守卫) */}
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            />
          </Routes>
        </Suspense>

        {/* 权限不足提示(全局,所有路由可见;订阅 api.ts 的 403 事件) */}
        <PermissionToast />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
