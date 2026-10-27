import { useEffect, useState, type ReactNode } from 'react';
import {
  X, Download, Bookmark, Share2, Check, Columns2, ImageIcon, RefreshCw,
} from 'lucide-react';
import { useToast } from './ToastProvider';

/** 结果工作台条目(情绪画布/灵感嫁接共用) */
export interface WorkshopItem {
  id: string;
  url: string;
  /** 主标题,如「方案 1」「宁静 · 1」 */
  title: string;
  /** 副标题,如「水墨写意 · 元素融合」 */
  subtitle?: string;
  /** 预构建的分享文案 */
  shareText: string;
}

interface ResultWorkshopProps {
  open: boolean;
  onClose: () => void;
  items: WorkshopItem[];
  /** 打开时默认选中索引 */
  initialIndex?: number;
  /** 主题色(徽标/强调) */
  accentColor?: string;
  /** 收藏到素材库 */
  onSave: (item: WorkshopItem) => Promise<void> | void;
  /** 微调面板(由页面注入,直接绑定页面状态) */
  tweakPanel?: ReactNode;
  /** 点击「应用并重新生成」:组件会先关闭再回调 */
  onRegenerate?: () => void;
}

/**
 * 生成结果工作台:变体对比 + 收藏 + 分享 + 微调重生成
 * 情绪画布与灵感嫁接共用,条目通过 WorkshopItem 归一化
 */
export default function ResultWorkshop({
  open,
  onClose,
  items,
  initialIndex = 0,
  accentColor = '#c53030',
  onSave,
  tweakPanel,
  onRegenerate,
}: ResultWorkshopProps) {
  const toast = useToast();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState(0);
  const [compareB, setCompareB] = useState(1);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  /* 打开时重置选中 */
  useEffect(() => {
    if (open) {
      setActiveIndex(Math.min(initialIndex, Math.max(0, items.length - 1)));
      setCompareA(0);
      setCompareB(Math.min(1, Math.max(0, items.length - 1)));
      setCompareMode(false);
    }
  }, [open, initialIndex, items.length]);

  /* ESC 关闭 + 锁定背景滚动 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const active = items[activeIndex] ?? null;

  const handleDownload = (item: WorkshopItem) => {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = `danqing-${item.id}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = async (item: WorkshopItem) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(item);
      toast.success('已保存到素材库', item.title);
    } catch (err) {
      console.error('保存到素材库失败:', err);
      toast.error('保存失败', '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async (item: WorkshopItem) => {
    try {
      await navigator.clipboard.writeText(item.shareText);
      setCopied(true);
      toast.success('分享文案已复制', '粘贴即可分享给好友');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败', '请检查浏览器剪贴板权限');
    }
  };

  const thumbStrip = (selected: number, onPick: (i: number) => void, size: string) => (
    <div className="flex gap-2 overflow-x-auto py-1">
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => onPick(i)}
          aria-label={`选择 ${item.title}`}
          className={`flex-shrink-0 ${size} rounded-lg overflow-hidden border-2 transition-all ${
            selected === i ? 'border-cinnabar ring-2 ring-cinnabar/30' : 'border-transparent hover:border-ink-300'
          }`}
        >
          <img src={item.url} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );

  const actionButtons = (item: WorkshopItem) => (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => handleDownload(item)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-ink-900 text-rice-100 rounded-lg hover:bg-cinnabar transition-all"
      >
        <Download className="w-4 h-4" />
        下载
      </button>
      <button
        onClick={() => handleSave(item)}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border-2 border-cinnabar/40 text-cinnabar rounded-lg hover:bg-cinnabar hover:text-white transition-all disabled:opacity-50"
      >
        <Bookmark className="w-4 h-4" />
        收藏
      </button>
      <button
        onClick={() => handleShare(item)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border-2 border-ink-200 text-ink-700 rounded-lg hover:border-cinnabar hover:text-cinnabar transition-all"
      >
        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Share2 className="w-4 h-4" />}
        {copied ? '已复制' : '分享'}
      </button>
    </div>
  );

  if (!open || items.length === 0) return null;

  return (
    <div
      className="fixed inset-0 bg-ink-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-rice-50 rounded-2xl overflow-hidden max-w-6xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h3 className="font-serif text-lg font-bold text-ink-900">结果工作台</h3>
            <span className="text-xs text-ink-400">共 {items.length} 张</span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 1 && (
              <button
                onClick={() => setCompareMode((v) => !v)}
                aria-label={compareMode ? '切换到单张查看' : '切换到对比查看'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all ${
                  compareMode
                    ? 'bg-cinnabar text-white'
                    : 'bg-rice-100 text-ink-600 hover:bg-rice-200'
                }`}
              >
                {compareMode ? <ImageIcon className="w-4 h-4" /> : <Columns2 className="w-4 h-4" />}
                {compareMode ? '单张查看' : '对比查看'}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="p-2 hover:bg-rice-100 rounded-full transition-all"
            >
              <X className="w-5 h-5 text-ink-700" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {compareMode && items.length > 1 ? (
            /* ---------- 对比模式:双栏各带缩略图条 ---------- */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: 'A', index: compareA, setIndex: setCompareA },
                { label: 'B', index: compareB, setIndex: setCompareB },
              ].map(({ label, index, setIndex }) => {
                const item = items[index];
                if (!item) return null;
                return (
                  <div key={label} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
                        style={{ backgroundColor: accentColor }}
                      >
                        {label}
                      </span>
                      <p className="text-sm font-medium text-ink-700 truncate">{item.title}</p>
                      {item.subtitle && (
                        <span className="text-xs text-ink-400 truncate">{item.subtitle}</span>
                      )}
                    </div>
                    <div className="bg-ink-900 rounded-xl overflow-hidden flex items-center justify-center min-h-[240px]">
                      <img
                        src={item.url}
                        alt={item.title}
                        className="w-full max-h-[420px] object-contain"
                      />
                    </div>
                    {thumbStrip(index, setIndex, 'w-12 h-12')}
                    {actionButtons(item)}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ---------- 单张模式 ---------- */
            active && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="px-3 py-1 text-xs rounded-full text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    {active.title}
                  </span>
                  {active.subtitle && (
                    <span className="px-3 py-1 text-xs rounded-full bg-rice-100 text-ink-600">
                      {active.subtitle}
                    </span>
                  )}
                </div>
                <div className="bg-ink-900 rounded-xl overflow-hidden flex items-center justify-center min-h-[300px]">
                  <img
                    src={active.url}
                    alt={active.title}
                    className="w-full max-h-[520px] object-contain"
                  />
                </div>
                {items.length > 1 && thumbStrip(activeIndex, setActiveIndex, 'w-16 h-16')}
                {actionButtons(active)}
              </div>
            )
          )}

          {/* ---------- 微调重生成(页面注入) ---------- */}
          {tweakPanel && onRegenerate && (
            <div className="border-t border-ink-100 pt-4">
              <p className="text-sm font-medium text-ink-700 mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-cinnabar" />
                参数微调 · 重新生成
              </p>
              {tweakPanel}
              <div className="mt-4 text-center">
                <button
                  onClick={() => {
                    onClose();
                    onRegenerate();
                  }}
                  className="inline-flex items-center gap-2 px-8 py-2.5 text-white rounded-xl transition-all transform hover:scale-105 shadow-card"
                  style={{ backgroundColor: accentColor }}
                >
                  <RefreshCw className="w-4 h-4" />
                  应用并重新生成
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
