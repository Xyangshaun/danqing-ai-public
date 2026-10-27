// 图片生成服务
// 默认调用后端 /api/v1/generation 真实 AI 图像生成(sync 模式)。
//
// 失败策略(2026-08-09 改造):
//   - 用户主动触发的生成(情绪画布/灵感嫁接):失败抛出 ImageGenerationError,
//     由页面显示明确错误原因 + 重试入口,不再静默回退占位图
//     (旧行为导致"等一分钟拿到假占位图"的体验事故)
//   - 被动浏览的示例素材(风格示例/课堂素材):保留占位图兜底,避免浏览场景大面积报错
//   - Mock 模式(localStorage 'danqing-ai-use-api' = false)行为不变,始终返回占位图
//
// 注:历史上 generateImage 返回 `trae-api-cn.mchost.guru` IDE 内部 URL,
// 该 URL 仅在 Trae IDE 沙箱内可用,部署到生产后无法访问。

import { placeholderImage } from './placeholderImage';
import { request, ApiError } from './api';
import { ErrorCode, type CreateGenerationResponse } from '../types/api-contract';
import {
  getEmotionByName,
  buildEmotionPrompt,
  aspectToSize,
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
} from './emotionLibrary';

let useExternalApi = true;
let apiKey = '';

export function setUseExternalApi(value: boolean) {
  useExternalApi = value;
  localStorage.setItem('danqing-ai-use-api', JSON.stringify(value));
}

export function getUseExternalApi(): boolean {
  const stored = localStorage.getItem('danqing-ai-use-api');
  if (stored) {
    try {
      useExternalApi = JSON.parse(stored) === true;
    } catch {
      useExternalApi = false;
    }
  }
  return useExternalApi;
}

export function setApiKey(key: string) {
  apiKey = key;
  localStorage.setItem('danqing-ai-api-key', key);
}

export function getApiKey(): string {
  const stored = localStorage.getItem('danqing-ai-api-key');
  if (stored) {
    apiKey = stored;
  }
  return apiKey;
}

export interface StylePreset {
  id: string;
  name: string;
  color: string;
  demoPrompt: string;
  description: string;
  origin: string;
  features: string[];
}

async function getStyleDemoImage(styleId: string): Promise<string> {
  const prompts: Record<string, string> = {
    ink: 'chinese ink wash painting mountain landscape misty clouds traditional brushwork',
    qinglv: 'chinese qinglv shanshui painting blue green mountains golden river traditional mineral pigments',
    cinnabar: 'chinese cinnabar red painting traditional new year folk art paper cutting style vibrant red',
    gold: 'chinese jinbi shanshui painting golden mountains gilt outlines royal court style luxurious',
    jade: 'chinese jade green painting lotus pond zen minimal elegant jadeite color palette serene',
    purple: 'chinese forbidden city purple imperial painting palace architecture majestic royal purple gold',
  };
  return generateImage(prompts[styleId] || 'chinese traditional painting', 'portrait_4_3', { placeholderOnError: true });
}

const stylePresets: StylePreset[] = [
  {
    id: 'ink',
    name: '水墨',
    color: '#1a1a1a',
    demoPrompt: 'chinese ink wash painting mountain landscape misty clouds traditional brushwork',
    description: '中国传统水墨画，以墨为色，浓淡干湿尽显东方神韵',
    origin: '始于唐代，盛于宋元',
    features: ['水墨晕染', '留白意境', '浓淡干湿'],
  },
  {
    id: 'qinglv',
    name: '青绿山水',
    color: '#2e5fa1',
    demoPrompt: 'chinese qinglv shanshui painting blue green mountains golden river traditional mineral pigments',
    description: '青绿山水，以石青石绿为主色，金碧辉煌',
    origin: '隋唐传承，敦煌壁画',
    features: ['青绿设色', '金碧辉煌', '装饰性强'],
  },
  {
    id: 'cinnabar',
    name: '朱砂',
    color: '#c41e3a',
    demoPrompt: 'chinese cinnabar red painting traditional new year folk art paper cutting style vibrant red',
    description: '朱砂红，吉祥喜庆，传统年画常用色',
    origin: '民间艺术代表',
    features: ['朱红主调', '吉祥寓意', '热烈奔放'],
  },
  {
    id: 'gold',
    name: '金碧',
    color: '#d4af37',
    demoPrompt: 'chinese jinbi shanshui painting golden mountains gilt outlines royal court style luxurious',
    description: '金碧山水，泥金勾勒，富丽堂皇',
    origin: '唐代李思训首创',
    features: ['泥金描线', '富丽堂皇', '皇家气象'],
  },
  {
    id: 'jade',
    name: '翡翠',
    color: '#3d8b7b',
    demoPrompt: 'chinese jade green painting lotus pond zen minimal elegant jadeite color palette serene',
    description: '翡翠色调，清雅脱俗，蕴含东方禅意',
    origin: '明清文人画',
    features: ['翠绿清雅', '禅意悠远', '生机盎然'],
  },
  {
    id: 'purple',
    name: '紫禁',
    color: '#6b3fa0',
    demoPrompt: 'chinese forbidden city purple imperial painting palace architecture majestic royal purple gold',
    description: '紫禁色调，神秘高贵，故宫建筑灵感',
    origin: '明清宫廷艺术',
    features: ['紫气东来', '高贵神秘', '宫廷气象'],
  },
];

const emotionPresets = [
  { id: 'lonely', name: '孤独', color: '#4a5568' },
  { id: 'hope', name: '希望', color: '#d4af37' },
  { id: 'calm', name: '宁静', color: '#2e5fa1' },
  { id: 'joy', name: '喜悦', color: '#c41e3a' },
  { id: 'melancholy', name: '忧伤', color: '#5a6b8a' },
  { id: 'passion', name: '激情', color: '#e74c3c' },
];

const scenePresets = [
  { id: 'mountain', name: '山水' },
  { id: 'flower', name: '花卉' },
  { id: 'bird', name: '花鸟' },
  { id: 'figure', name: '人物' },
  { id: 'architecture', name: '建筑' },
  { id: 'stilllife', name: '静物' },
];

function buildPrompt(keywords: string, style: string, scene: string): string {
  const styleMap: Record<string, string> = {
    realistic: 'realistic painting',
    illustration: 'digital illustration',
    watercolor: 'watercolor painting',
    ink: 'chinese ink painting',
    oil: 'oil painting',
  };
  return `${styleMap[style] || 'painting'} of ${scene} with ${keywords}, high quality, detailed`;
}

export async function generateClassMaterial(
  keywords: string,
  style: string,
  scene: string
): Promise<string[]> {
  const prompt = buildPrompt(keywords, style, scene);

  // 并行生成 4 张参考素材,避免顺序等待(每张真实 AI 约 50-70s)
  // 素材浏览场景:失败回退占位图,不阻断浏览
  const tasks = Array.from({ length: 4 }, (_, i) =>
    generateImage(`${prompt} variant ${i + 1}`, 'landscape_4_3', { placeholderOnError: true })
  );
  return Promise.all(tasks);
}

/**
 * 将前端 size 标识映射为后端 aspect 枚举
 */
function mapSizeToAspect(size: string): 'portrait' | 'landscape' | 'square' {
  if (size === 'portrait' || size === 'portrait_4_3') return 'portrait';
  if (size === 'landscape' || size === 'landscape_4_3') return 'landscape';
  return 'square';
}

/**
 * 调用后端真实 AI 图像生成(sync 模式,立即返回结果)
 *
 * 失败行为由 opts.placeholderOnError 决定:
 *   - false(默认):抛出 ImageGenerationError(带 reason,页面据此展示原因+重试)
 *   - true:回退本地 SVG 占位图(仅用于风格示例/课堂素材等被动浏览场景)
 */
/** AI 图像生成失败原因分类 */
export type ImageGenerationFailureReason =
  | 'disabled'     // 生成功能未开放(后端 feature flag 关闭,403)
  | 'timeout'      // 前端总超时(默认 100s 未响应)
  | 'quota'        // 配额/限流(429/6106 等)
  | 'unavailable'  // 服务异常/网络错误/未返回图片
  | 'unknown';

/** AI 图像生成错误(reason 供 UI 差异化展示) */
export class ImageGenerationError extends Error {
  readonly reason: ImageGenerationFailureReason;
  constructor(reason: ImageGenerationFailureReason, message: string) {
    super(message);
    this.name = 'ImageGenerationError';
    this.reason = reason;
  }
}

export interface GenerateImageOptions {
  /** 失败时回退占位图(默认 false = 抛 ImageGenerationError) */
  placeholderOnError?: boolean;
  /** 前端总超时(默认 100s;后端 GLM 链路约 50-70s,留缓冲) */
  timeoutMs?: number;
}

/** generateImage 默认前端超时:覆盖后端 AI 链路 50-70s + 网络缓冲 */
const DEFAULT_GENERATE_TIMEOUT_MS = 100_000;

/** 将底层错误映射为 ImageGenerationError(差异化 reason) */
function toImageGenerationError(err: unknown): ImageGenerationError {
  if (err instanceof ImageGenerationError) return err;
  if (err instanceof ApiError) {
    if (err.code === ErrorCode.FORBIDDEN) {
      return new ImageGenerationError('disabled', 'AI 图像生成功能暂未开放,请联系管理员开启');
    }
    if (err.code === ErrorCode.RATE_LIMITED || err.code === ErrorCode.ANALYSIS_QUOTA_EXCEEDED) {
      return new ImageGenerationError('quota', err.message || '请求过于频繁,请稍后再试');
    }
    if (err.message.includes('请求超时')) {
      return new ImageGenerationError('timeout', 'AI 生成超时,请重试');
    }
    return new ImageGenerationError('unavailable', err.message || 'AI 服务暂不可用');
  }
  const msg = err instanceof Error ? err.message : '未知错误';
  return new ImageGenerationError('unknown', msg);
}

export async function generateImage(
  prompt: string,
  size: string = 'square',
  opts: GenerateImageOptions = {},
): Promise<string> {
  // Mock 模式(测试脚本/演示验证):直接返回占位图,不消耗 GLM 额度
  // 开关:localStorage 'danqing-ai-use-api' = false(通过 getUseExternalApi 实时读取,
  //   支持 Playwright addInitScript 注入);可选人工延迟 'danqing-ai-mock-delay' (毫秒),
  //   用于模拟真实生成时长以验证 loading 进度/阶段文案循环
  if (!getUseExternalApi()) {
    const mockDelay = Number(localStorage.getItem('danqing-ai-mock-delay') ?? 0);
    if (mockDelay > 0) {
      await new Promise((r) => setTimeout(r, mockDelay));
    }
    return placeholderImage(prompt, {
      size: size as Parameters<typeof placeholderImage>[1] extends { size?: infer S } ? S : never,
      title: prompt.slice(0, 12),
    });
  }

  try {
    const res = await request<CreateGenerationResponse>('/generation', {
      method: 'POST',
      body: {
        inputType: 'text',
        prompt,
        artType: 'painting',
        aspect: mapSizeToAspect(size),
        count: 1,
        sync: true,
      },
      timeoutMs: opts.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
      // 静默:错误统一由调用方页面以错误卡片形式呈现,不弹全局 Toast
      silent: true,
    });

    if (res.images && res.images.length > 0 && res.images[0].imageUrl) {
      return res.images[0].imageUrl;
    }

    throw new ImageGenerationError('unavailable', '后端未返回生成图片');
  } catch (err) {
    if (!opts.placeholderOnError) {
      throw toImageGenerationError(err);
    }
    console.warn('[imageService] 真实 AI 生成失败,回退到占位图:', err);
    return placeholderImage(prompt, {
      size: size as Parameters<typeof placeholderImage>[1] extends { size?: infer S } ? S : never,
      title: prompt.slice(0, 12),
    });
  }
}

export async function applyStyle(imageUrl: string, styleId: string): Promise<string> {
  const style = stylePresets.find(s => s.id === styleId);
  if (!style) return imageUrl;

  const prompt = `transform this artwork into ${style.name} chinese painting style, ${style.name} color palette`;
  return generateImage(prompt, 'square', { placeholderOnError: true });
}

export async function fuseImages(): Promise<string> {
  const prompt = `combine these two artworks into a harmonious new composition, creative fusion`;
  return generateImage(prompt, 'landscape_4_3', { placeholderOnError: true });
}

/**
 * 生成情绪画布(P1 升级)
 * 支持双情绪配比 / 生成参数(画幅·密度·笔触·留白) / 自定义色板,
 * prompt 由 emotionLibrary.buildEmotionPrompt 统一构建。
 *
 * 逐张上屏(2026-08-09):
 *   - 3 张并行请求,每张完成立即触发 onImageReady(url, index, total),
 *     页面可即时渲染,感知速度从"等 3 倍时长"降为"等 1 倍时长"
 *   - 汇总用 Promise.allSettled:全部失败抛首个 ImageGenerationError;
 *     部分成功返回成功项(按原始顺序),由页面提示部分失败
 */
export interface EmotionCanvasProgress {
  /** 每张完成时回调(index 为原始序号 0..total-1) */
  onImageReady?: (url: string, index: number, total: number) => void;
}

export async function generateEmotionCanvas(
  emotion: string,
  progress?: EmotionCanvasProgress,
): Promise<string[]> {
  /* 解析情绪表达式:'宁静' 或 '宁静-忧伤'(兼容旧调用方) */
  const [primaryName, secondaryName] = emotion.split(/[-+]/).map((s) => s.trim());
  const primary = getEmotionByName(primaryName);
  const secondary = secondaryName ? getEmotionByName(secondaryName) : null;

  /* 读取调用方暂存的画板配置(由 EmotionPage 在调用前写入 sessionStorage) */
  let ratio = 0.7;
  let intensity = 0.6;
  let params: GenerationParams = { ...DEFAULT_GENERATION_PARAMS };
  try {
    const raw = sessionStorage.getItem('danqing-emotion-gen-config');
    if (raw) {
      const cfg = JSON.parse(raw);
      if (typeof cfg.ratio === 'number') ratio = cfg.ratio;
      if (typeof cfg.intensity === 'number') intensity = cfg.intensity;
      if (cfg.params && typeof cfg.params === 'object') params = { ...params, ...cfg.params };
    }
  } catch {
    /* 配置解析失败时使用默认值 */
  }

  const basePrompt = buildEmotionPrompt(primary, secondary, ratio, params, intensity);
  const size = aspectToSize(params.aspect);
  const total = 3;

  // 并行生成 3 张情绪画布,每张完成立即回调(逐张上屏)
  const tasks = Array.from({ length: total }, (_, i) =>
    generateImage(`${basePrompt} variant ${i + 1}`, size).then((url) => {
      progress?.onImageReady?.(url, i, total);
      return url;
    })
  );

  const settled = await Promise.allSettled(tasks);
  const urls: string[] = [];
  let firstError: unknown = null;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      urls.push(r.value);
    } else if (!firstError) {
      firstError = r.reason;
    }
  }
  if (urls.length === 0) {
    throw toImageGenerationError(firstError);
  }
  return urls;
}

export { stylePresets, emotionPresets, scenePresets, getStyleDemoImage };
