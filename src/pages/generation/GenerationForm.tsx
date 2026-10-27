// ============================================================
// 生成入口表单组件(M2-T7,M4-T6 扩展三模式)
// ------------------------------------------------------------
// 负责生成参数采集:
//   - 输入来源切换:text 文字提示词 / sketch 草稿图上传 /
//     style 风格迁移(M4-T6:参考图 + 新画面内容描述)
//   - prompt 输入(text 模式必填)
//   - sketch 图上传预览(sketch 模式必填,FileReader 转 dataURL)
//   - style 风格参考图上传(style 模式必填,读取后经 canvas 压缩
//     最长边≤1280/JPEG 0.85/透明铺白底再入 state)+ 新画面内容
//     描述 textarea(映射 prompt 字段),三模式输入互不干扰
//   - artType 作品类型(绘画/设计/产品/雕塑)
//   - aspect 尺寸(portrait/landscape/square)
//   - count 生成数量(1-4)
//   - prefill 预填(报告页"以此风格生成练习"跳转,真源 §7.3):
//     仅作挂载初始值,幂等无害,用户可切换模式/替换参考图
// 校验通过后回调 onSubmit(values),由页面层发起 createGeneration。
// ============================================================

import { useState, useRef } from 'react';
import {
  Type, ImagePlus, Brush, PenTool, Box, Layers,
  Loader2, Wand2, Trash2, Palette,
} from 'lucide-react';
import type { ArtType } from '../../types/api-contract';
import type { GenerationInputType } from '../../types/api-contract';
import { useToast } from '../../components/ToastProvider';
import { compressImage } from '../../utils/imageCompress';

/* 作品类型选项(与四类创意形式一一对应) */
const ART_TYPE_OPTIONS: { id: ArtType; label: string; icon: typeof Brush }[] = [
  { id: 'painting', label: '绘画', icon: Brush },
  { id: 'design', label: '设计', icon: PenTool },
  { id: 'product', label: '产品设计', icon: Box },
  { id: 'sculpture', label: '雕塑', icon: Layers },
];

/* 尺寸选项 */
const ASPECT_OPTIONS: { id: 'portrait' | 'landscape' | 'square'; label: string }[] = [
  { id: 'portrait', label: '竖版' },
  { id: 'landscape', label: '横版' },
  { id: 'square', label: '方形' },
];

/* 生成数量可选值(1-4) */
const COUNT_OPTIONS = [1, 2, 3, 4];

/** 表单提交时携带的完整生成参数 */
export interface GenerationFormValues {
  inputType: GenerationInputType;
  /** text 模式=画面描述 / style 模式=新画面内容描述(均映射请求体 prompt 字段) */
  prompt: string;
  sketchImageUrl: string;
  /** 风格参考图(style 模式,压缩后 dataURL 或 prefill http URL;M4-T6) */
  styleImageUrl: string;
  artType: ArtType;
  aspect: 'portrait' | 'landscape' | 'square';
  count: number;
}

/**
 * 风格迁移预填(报告页"以此风格生成练习"跳转协议,真源 §7.3)
 * 仅作为挂载初始值注入,幂等无害;用户可切换模式/替换参考图
 */
export interface GenerationFormPrefill {
  inputType: 'style';
  /** 风格参考图(http URL 直接作预览与提交值,不压缩) */
  styleImageUrl?: string;
  /** 同步作品类型 */
  artType?: ArtType;
}

interface GenerationFormProps {
  /** 提交中(禁用按钮,避免重复提交) */
  submitting: boolean;
  /** 校验通过后回调生成参数 */
  onSubmit: (values: GenerationFormValues) => void;
  /** 风格迁移预填(仅挂载初始值生效;M4-T8 报告页入口跳转传入) */
  prefill?: GenerationFormPrefill | null;
}

/**
 * 生成入口表单
 * @param props 见 GenerationFormProps
 */
export default function GenerationForm({ submitting, onSubmit, prefill }: GenerationFormProps) {
  const toast = useToast();

  /* 表单本地状态(prefill 仅作初始值:模式锁定 style、参考图预载、artType 同步) */
  const [inputType, setInputType] = useState<GenerationInputType>(prefill?.inputType ?? 'text');
  const [prompt, setPrompt] = useState('');
  const [sketchImageUrl, setSketchImageUrl] = useState('');
  /* style 模式:内容描述独立于 text 模式的 prompt(切换互不干扰) */
  const [stylePrompt, setStylePrompt] = useState('');
  const [styleImageUrl, setStyleImageUrl] = useState(prefill?.styleImageUrl ?? '');
  const [artType, setArtType] = useState<ArtType>(prefill?.artType ?? 'painting');
  const [aspect, setAspect] = useState<'portrait' | 'landscape' | 'square'>('square');
  const [count, setCount] = useState(1);
  /* 草稿图文件名(用于展示) */
  const [sketchName, setSketchName] = useState('');
  /* 风格参考图文件名(用于展示;prefill http URL 无文件名) */
  const [styleName, setStyleName] = useState('');
  /* 风格参考图处理中(FileReader 读取 + canvas 压缩) */
  const [styleProcessing, setStyleProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  /* 读取草稿图为 dataURL 并预览 */
  const handleSketchChange = (file: File | undefined | null) => {
    if (!file) return;
    // 仅接受图片类型
    if (!file.type.startsWith('image/')) {
      toast.error('格式不支持', '请选择图片文件(JPEG/PNG/WebP)');
      return;
    }
    // 大小限制 10MB(与后端 FILE_TOO_LARGE 一致)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('文件过大', '草稿图最大支持 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSketchImageUrl(typeof reader.result === 'string' ? reader.result : '');
      setSketchName(file.name);
    };
    reader.onerror = () => toast.error('读取失败', '无法读取该图片文件');
    reader.readAsDataURL(file);
  };

  /* 清空已选草稿图 */
  const clearSketch = () => {
    setSketchImageUrl('');
    setSketchName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * 读取风格参考图 → canvas 压缩(最长边≤1280 / JPEG 0.85 / 透明铺白底)后入 state
   * 交互对齐 sketch 模式:image/* 校验、10MB 原图上限、预览/清空
   */
  const handleStyleChange = async (file: File | undefined | null) => {
    if (!file) return;
    // 仅接受图片类型
    if (!file.type.startsWith('image/')) {
      toast.error('格式不支持', '请选择图片文件(JPEG/PNG/WebP)');
      return;
    }
    // 原图大小限制 10MB(压缩在读取后进行)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('文件过大', '风格参考图最大支持 10MB');
      return;
    }
    setStyleProcessing(true);
    try {
      // 读取(FileReader)+ canvas 压缩均内聚在 compressImage 内
      const compressed = await compressImage(file);
      setStyleImageUrl(compressed);
      setStyleName(file.name);
    } catch {
      toast.error('处理失败', '无法处理该图片，请更换图片后重试');
    } finally {
      setStyleProcessing(false);
    }
  };

  /* 清空已选风格参考图 */
  const clearStyle = () => {
    setStyleImageUrl('');
    setStyleName('');
    if (styleFileInputRef.current) styleFileInputRef.current.value = '';
  };

  /* 校验 + 提交 */
  const handleSubmit = () => {
    // 输入来源切换为 text:校验提示词非空
    if (inputType === 'text' && !prompt.trim()) {
      toast.error('请输入提示词', '文字生成模式需要一段描述画面的提示词');
      return;
    }
    // 输入来源切换为 sketch:校验草稿图已选
    if (inputType === 'sketch' && !sketchImageUrl) {
      toast.error('请上传草稿图', '草图生成模式需要先上传一张草稿图');
      return;
    }
    // 输入来源切换为 style:校验参考图与内容描述(§7.2 一键全自动)
    if (inputType === 'style') {
      if (!styleImageUrl) {
        toast.error('请上传风格参考图', '风格迁移模式需要先上传一幅参考作品');
        return;
      }
      if (!stylePrompt.trim()) {
        toast.error('请输入新画面内容描述', '描述希望以该风格创作的新画面内容');
        return;
      }
    }
    onSubmit({
      inputType,
      prompt: inputType === 'style' ? stylePrompt.trim() : prompt.trim(),
      sketchImageUrl,
      styleImageUrl,
      artType,
      aspect,
      count,
    });
  };

  return (
    <div className="bg-rice-50 border border-ink-900/8 rounded-lg shadow-subtle overflow-hidden">
      {/* 卡片标题 */}
      <div className="px-6 pt-6 pb-4 border-b border-ink-900/8">
        <h2 className="font-serif text-xl font-bold text-ink-900">AI 生成</h2>
        <p className="text-sm text-ink-500 mt-1">
          输入文字提示词、上传草稿图或以大师作品风格迁移，生成专属参考作品
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* 输入来源切换(三模式:文字 / 草稿图 / 风格迁移) */}
        <div>
          <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
            输入来源
          </p>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setInputType('text')}
              className={`flex items-center justify-center gap-2 px-3 py-3 rounded-md border text-sm font-medium transition-colors ${
                inputType === 'text'
                  ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                  : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
              }`}
            >
              <Type className="w-4 h-4 flex-shrink-0" />
              文字提示词
            </button>
            <button
              type="button"
              onClick={() => setInputType('sketch')}
              className={`flex items-center justify-center gap-2 px-3 py-3 rounded-md border text-sm font-medium transition-colors ${
                inputType === 'sketch'
                  ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                  : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
              }`}
            >
              <ImagePlus className="w-4 h-4 flex-shrink-0" />
              上传草稿图
            </button>
            <button
              type="button"
              onClick={() => setInputType('style')}
              className={`flex items-center justify-center gap-2 px-3 py-3 rounded-md border text-sm font-medium transition-colors ${
                inputType === 'style'
                  ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                  : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
              }`}
            >
              <Palette className="w-4 h-4 flex-shrink-0" />
              风格迁移
            </button>
          </div>
        </div>

        {/* 文字提示词 */}
        {inputType === 'text' && (
          <div>
            <label className="block text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
              画面描述 <span className="text-cinnabar">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="例如：水墨山水，云雾缭绕，青绿点缀，留白意境，笔触写意……"
              className="w-full px-3 py-2.5 rounded-md border border-ink-900/10 bg-rice-100 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar/40"
            />
            <p className="text-xs text-ink-400 mt-1">
              描述越具体，生成效果越贴近预期。可包含风格、元素、色彩、技法等关键词。
            </p>
          </div>
        )}

        {/* 草稿图上传 */}
        {inputType === 'sketch' && (
          <div>
            <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
              草稿图 <span className="text-cinnabar">*</span>
            </p>
            {sketchImageUrl ? (
              <div className="relative">
                <img
                  src={sketchImageUrl}
                  alt="草稿图预览"
                  className="w-full max-h-64 object-contain rounded-md border border-ink-900/10 bg-rice-100"
                />
                <button
                  type="button"
                  onClick={clearSketch}
                  className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-ink-900/60 text-rice-100 rounded-md hover:bg-ink-900/80 transition-colors"
                  aria-label="移除草稿图"
                  title="移除草稿图"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                {sketchName && (
                  <p className="text-xs text-ink-500 mt-1">{sketchName}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-36 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-ink-900/15 bg-rice-100 text-ink-500 hover:border-cinnabar/40 hover:text-cinnabar hover:bg-cinnabar/5 transition-colors"
              >
                <ImagePlus className="w-6 h-6" />
                <span className="text-sm">点击上传草稿图</span>
                <span className="text-xs text-ink-400">支持 JPEG/PNG/WebP，最大 10MB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleSketchChange(e.target.files?.[0])}
            />
          </div>
        )}

        {/* 风格迁移:参考图上传 + 新画面内容描述(M4-T6) */}
        {inputType === 'style' && (
          <div className="space-y-4">
            {/* 风格参考图上传(对齐 sketch 交互,读取后追加 canvas 压缩) */}
            <div>
              <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
                风格参考图 <span className="text-cinnabar">*</span>
              </p>
              {styleImageUrl ? (
                <div className="relative">
                  <img
                    src={styleImageUrl}
                    alt="风格参考图预览"
                    className="w-full max-h-64 object-contain rounded-md border border-ink-900/10 bg-rice-100"
                  />
                  <button
                    type="button"
                    onClick={clearStyle}
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-ink-900/60 text-rice-100 rounded-md hover:bg-ink-900/80 transition-colors"
                    aria-label="移除风格参考图"
                    title="移除风格参考图"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {styleName && (
                    <p className="text-xs text-ink-500 mt-1">{styleName}</p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={styleProcessing}
                  onClick={() => styleFileInputRef.current?.click()}
                  className="w-full h-36 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-ink-900/15 bg-rice-100 text-ink-500 hover:border-cinnabar/40 hover:text-cinnabar hover:bg-cinnabar/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {styleProcessing ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <Palette className="w-6 h-6" />
                  )}
                  <span className="text-sm">
                    {styleProcessing ? '正在处理图片…' : '点击上传风格参考图'}
                  </span>
                  <span className="text-xs text-ink-400">
                    支持 JPEG/PNG/WebP，最大 10MB，上传后自动压缩
                  </span>
                </button>
              )}
              <input
                ref={styleFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleStyleChange(e.target.files?.[0])}
              />
            </div>

            {/* 新画面内容描述(映射请求体 prompt 字段) */}
            <div>
              <label className="block text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
                新画面内容描述 <span className="text-cinnabar">*</span>
              </label>
              <textarea
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                rows={4}
                placeholder="例如：一位戴草帽的少女站在麦田边"
                className="w-full px-3 py-2.5 rounded-md border border-ink-900/10 bg-rice-100 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar/40"
              />
              {/* 预期管理(版权合规,真源 §6.2) */}
              <p className="text-xs text-ink-400 mt-1">
                AI 将学习参考图的风格语言（笔触/色彩/构图/手法）创作新内容，非原作复刻
              </p>
            </div>
          </div>
        )}

        {/* 作品类型 */}
        <div>
          <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
            作品类型
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ART_TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = artType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setArtType(opt.id)}
                  className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-md border text-xs font-medium transition-colors ${
                    active
                      ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                      : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 尺寸 + 数量 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
              生成尺寸
            </p>
            <div className="flex gap-2">
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAspect(opt.id)}
                  className={`flex-1 px-2 py-2 rounded-md border text-xs font-medium transition-colors ${
                    aspect === opt.id
                      ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                      : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider mb-2">
              生成数量
            </p>
            <div className="flex gap-2">
              {COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`flex-1 px-2 py-2 rounded-md border text-xs font-medium transition-colors ${
                    count === n
                      ? 'border-cinnabar bg-cinnabar/5 text-cinnabar ring-1 ring-cinnabar/20'
                      : 'border-ink-900/10 bg-rice-100 text-ink-600 hover:border-ink-900/20'
                  }`}
                >
                  {n} 张
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 提交按钮 */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full h-12 flex items-center justify-center gap-2 rounded bg-cinnabar text-white text-sm font-medium hover:bg-cinnabar-dark active:bg-cinnabar-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              正在提交…
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              开始生成
            </>
          )}
        </button>
      </div>
    </div>
  );
}
