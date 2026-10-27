/// <reference types="vite/client" />
import { Component, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import {
  AlertTriangle, RefreshCw, Home, Bug, ImageOff, WifiOff, Copy, Check,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from './ToastProvider';

/** 错误变体:根据 error.message 关键词判定,提供差异化图标与文案 */
type ErrorVariant = 'image' | 'network' | 'default';

interface VariantConfig {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}

/** 网络错误关键词优先判定(更具体),其次图片资源,最后默认 */
const VARIANT_CONFIG: Record<ErrorVariant, VariantConfig> = {
  network: {
    icon: WifiOff,
    title: '网络连接出现问题',
    desc: '无法连接到服务器,请检查网络后重试,或返回首页继续操作。',
  },
  image: {
    icon: ImageOff,
    title: '图片加载出现问题',
    desc: '部分图片资源暂时无法显示,可以尝试重新加载,或检查素材链接是否有效。',
  },
  default: {
    icon: AlertTriangle,
    title: '页面出现了问题',
    desc: '这个模块暂时无法正常显示,可以尝试重新加载,或返回首页继续操作。',
  },
};

function detectVariant(error: Error): ErrorVariant {
  const msg = error.message || '';
  if (/fetch|network/i.test(msg)) return 'network';
  if (/img|image|load/i.test(msg)) return 'image';
  return 'default';
}

interface Props {
  children: ReactNode;
  /** 自定义降级 UI,不传则用默认 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * 自定义重试回调:点击"重试"按钮时调用,调用后会 reset 内部 error state。
   * 不传时,重试仅 reset error state(让子组件重新渲染)。
   * "刷新页面"按钮始终调用 window.location.reload(不通过此回调)。
   */
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 错误边界:捕获子组件渲染/生命周期异常,避免整页白屏。
 * 用法:<ErrorBoundary><Page/></ErrorBoundary>
 *       <ErrorBoundary onRetry={() => refetch()}><Page/></ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* 上报到控制台/可扩展为远程监控 */
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  /** 重试:先调用外部 onRetry(若有),再 reset 内部 error state */
  handleRetry = () => {
    if (typeof this.props.onRetry === 'function') {
      try {
        this.props.onRetry();
      } catch (err) {
        /* onRetry 自身抛错也不应阻塞 reset,记录日志即可 */
        console.error('[ErrorBoundary] onRetry threw', err);
      }
    }
    this.reset();
  };

  render() {
    const { hasError, error } = this.state;
    if (!hasError || !error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return <DefaultFallback error={error} onRetry={this.handleRetry} />;
  }
}

/* 默认降级 UI:与生态软件风格一致 */
function DefaultFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const isDev = import.meta.env.DEV;
  /* 根据错误信息判定变体:图片资源 / 网络 / 默认,提供差异化图标与文案 */
  const variant = detectVariant(error);
  const cfg = VARIANT_CONFIG[variant];
  const Icon = cfg.icon;
  /* 生产环境显示友好文案;开发环境显示真实 error.message */
  const displayMessage = isDev ? error.message : cfg.desc;

  return (
    <div className="h-full flex items-center justify-center p-6 bg-rice-200">
      <div className="max-w-[480px] w-full bg-rice-50 border border-cinnabar/20 rounded-lg shadow-overlay overflow-hidden animate-slide-up">
        {/* 顶部色带 */}
        <div className="h-1.5 bg-gradient-to-r from-cinnabar to-cinnabar-dark" />

        <div className="p-6">
          {/* 图标(随变体切换) */}
          <div className="w-12 h-12 bg-cinnabar/10 rounded-full flex items-center justify-center mb-4">
            <Icon className="w-6 h-6 text-cinnabar" />
          </div>

          {/* 标题与描述(随变体切换) */}
          <h2 className="font-serif text-lg font-bold text-ink-900 mb-2">
            {cfg.title}
          </h2>
          <p className="text-sm text-ink-500 mb-4">
            {displayMessage}
          </p>

          {/* 错误详情(仅开发态) */}
          {isDev && (
            <details className="mb-4 bg-rice-100 border border-ink-900/8 rounded-md p-3 group">
              <summary className="cursor-pointer flex items-center gap-2 text-xs font-medium text-ink-600">
                <Bug className="w-3.5 h-3.5" />
                开发者信息
              </summary>
              <pre className="mt-2 text-2xs font-mono text-cinnabar whitespace-pre-wrap break-all">
                {error.name}: {error.message}
                {error.stack && '\n\n' + error.stack}
              </pre>
            </details>
          )}

          {/* 操作区:重试(主) + 刷新页面(次) + 复制错误信息(幽灵) */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                aria-label="重试加载"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cinnabar/40"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                aria-label="刷新整个页面"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 bg-rice-100 hover:bg-rice-200 text-ink-700 border border-ink-900/10 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink-900/15"
              >
                <Home className="w-3.5 h-3.5" />
                刷新页面
              </button>
            </div>
            {/* 复制错误信息:用于把详细错误发给开发者排查 */}
            <CopyErrorButton error={error} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* 复制错误信息按钮:用 navigator.clipboard.writeText,失败时 Toast 提示(不使用 alert) */
function CopyErrorButton({ error }: { error: Error }) {
  /* 复制状态:用于切换按钮文案与图标(已复制时显示对勾) */
  const [copied, setCopied] = useState(false);
  /* 注意:ErrorBoundary 是 class 组件,默认降级 UI 是其子函数组件,
   * 此处 useToast 必须在 ToastProvider 内调用——App.tsx 已保证 ToastProvider 在最外层。 */
  const toast = useToast();

  const handleCopy = async () => {
    /* 拼接错误信息:name + message + stack(若有) */
    const payload = [
      `Error: ${error.name}`,
      `Message: ${error.message}`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      error.stack ? `\nStack:\n${error.stack}` : '',
    ].join('\n');

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(payload);
      } else {
        /* 降级方案:用临时 textarea + document.execCommand('copy')(老浏览器) */
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      toast.success('错误信息已复制', '可粘贴发送给开发者以便排查');
      /* 1.5s 后恢复按钮文案 */
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[ErrorBoundary] copy failed', err);
      /* 项目硬约束:禁止 alert,统一用 Toast 通知 */
      toast.error('复制失败', '请手动选择错误详情中的文本进行复制');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="复制错误信息"
      className="inline-flex items-center justify-center gap-1.5 h-8 text-ink-500 hover:text-ink-700 hover:bg-ink-900/5 rounded-md text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink-900/15"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-jade" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? '已复制' : '复制错误信息'}
    </button>
  );
}

/* 提供"返回首页"链接的便捷导出(向后兼容:旧版 DefaultFallback 内嵌的 Link 已移除,
 * 业务方如需"返回首页"行为可在外部 fallback 中使用 <Link to="/" />) */
export function BackHomeLink({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center justify-center gap-1.5 h-9 bg-rice-100 hover:bg-rice-200 text-ink-700 border border-ink-900/10 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink-900/15 ${className}`}
    >
      <Home className="w-3.5 h-3.5" />
      返回首页
    </Link>
  );
}
