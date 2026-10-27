// ============================================================
// AI 图像生成页面(M2-T7,M4-T6 扩展风格迁移)
// ------------------------------------------------------------
// 页面编排(状态机):
//   form → generating → result(成功) / failed(失败)
//
// 交互流程:
//   1. form:展示生成入口表单(GenerationForm),采集参数并校验
//   2. submitting:调 createGeneration,进入 generating
//   3. generating:每 2s 轮询 getGeneration(taskId),直到
//      status=success → result / status=failed → failed
//   4. result:展示生成图(GenerationResult)+ 风格拆解卡
//      (StyleAnalysisCard,style 任务),一键诊断(占位)
//   5. failed:展示 failureReason + 重试(GenerationFailed),
//      styleAnalysis 非空时拆解卡保留展示(两阶段落库)
//
// M4-T6 增量:
//   - style 模式:表单值透传 styleImageUrl + prompt(新画面内容描述)
//   - styleAnalysis:轮询每帧消费 GET 响应(两阶段落库可能在
//     processing 中途到达),终态注入结果/失败视图
//   - prefill(真源 §7.3 报告页跳转协议消费端):挂载时读取
//     location.state.prefill(state 优先)与 query 兜底
//     (?styleImageUrl=<http URL>&artType=<artType>),注入表单;
//     预填幂等无害,不做清除,用户可切换模式/替换参考图
//
// 配额/限流:捕获 ApiError,按错误码 6101(配额超限)/6106(限流)
// 给用户差异化友好提示;其余(含 styleTransfer 开关关闭的
// 403 FORBIDDEN 2004)走统一错误 toast,无需特判。
//
// 轮询安全:setInterval 存 ref,组件卸载/状态变更时清理,避免泄漏。
// ============================================================

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Wand2 } from 'lucide-react';
import { ApiError } from '../services/api';
import {
  createGeneration,
  getGeneration,
  GENERATION_QUOTA_EXCEEDED,
  GENERATION_RATE_LIMITED,
  type ArtType,
  type GeneratedImage,
  type GenerationStatus,
  type StyleAnalysis,
} from '../services/generationService';
import { useToast } from '../components/ToastProvider';
import GenerationForm, {
  type GenerationFormValues,
  type GenerationFormPrefill,
} from './generation/GenerationForm';
import GenerationLoading from './generation/GenerationLoading';
import GenerationResult from './generation/GenerationResult';
import GenerationFailed from './generation/GenerationFailed';

/* 页面步骤状态机 */
type Step = 'form' | 'generating' | 'result' | 'failed';

/** 轮询间隔(毫秒),按计划 §8 建议 1-2s,取 2s */
const POLL_INTERVAL_MS = 2000;

/** artType 合法枚举(生成侧仅四类;契约 ArtType 另含第五类 heritage,经下方映射兜底) */
const ART_TYPES: readonly ArtType[] = ['painting', 'design', 'product', 'sculpture'] as const;

/**
 * heritage(遗产/传统工艺)→ 生成侧最近画种映射。
 * 偏差登记 #3 修复(2026-09-30):分析侧契约 ArtType 含第五类 heritage,
 * 报告页"以此风格生成练习"预填 artType='heritage' 此前被 parseArtType
 * 丢弃,画种回落默认绘画;现映射为 design(工艺美术取向)兜底,用户可改选。
 */
const HERITAGE_ART_TYPE_FALLBACK: ArtType = 'design';

/** location.state 可能的形状(报告页 navigate 写入 prefill,真源 §7.3) */
interface GenerationLocationState {
  prefill?: {
    inputType?: unknown;
    styleImageUrl?: unknown;
    artType?: unknown;
  };
}

/** http(s) URL 校验(query 兜底仅接受 http URL 形式,state 可携带 dataURL) */
function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value.trim());
}

/** 未知值 → 合法 ArtType(heritage 映射兜底;不合法返回 undefined) */
function parseArtType(value: unknown): ArtType | undefined {
  if (value === 'heritage') return HERITAGE_ART_TYPE_FALLBACK;
  return typeof value === 'string' && (ART_TYPES as readonly string[]).includes(value)
    ? (value as ArtType)
    : undefined;
}

/**
 * 解析风格迁移预填(真源 §7.3):
 *   - location.state.prefill 优先(M4-T8 报告页"以此风格生成练习"跳转,
 *     styleImageUrl 可为 http URL 或 dataURL)
 *   - query 兜底:/generation?styleImageUrl=<http URL>&artType=<artType>
 *     (仅 http URL 形式,供外链/刷新场景)
 *   - 无任何 style 信号时返回 null(常规进入,默认 text 模式)
 */
function resolvePrefill(location: {
  state: unknown;
  search: string;
}): GenerationFormPrefill | null {
  let styleImageUrl: string | undefined;
  let artType: ArtType | undefined;
  let hasStyleSignal = false;

  /* 1) location.state.prefill */
  const state = location.state as GenerationLocationState | null;
  if (state && typeof state.prefill === 'object' && state.prefill !== null) {
    if (state.prefill.inputType === 'style') hasStyleSignal = true;
    if (typeof state.prefill.styleImageUrl === 'string' && state.prefill.styleImageUrl.trim()) {
      styleImageUrl = state.prefill.styleImageUrl.trim();
    }
    artType = parseArtType(state.prefill.artType);
  }

  /* 2) query 兜底(仅 http URL;state 已有值时 state 优先) */
  const params = new URLSearchParams(location.search);
  const queryUrl = params.get('styleImageUrl');
  if (isHttpUrl(queryUrl)) {
    hasStyleSignal = true;
    if (!styleImageUrl) styleImageUrl = queryUrl.trim();
  }
  const queryArtType = parseArtType(params.get('artType'));
  if (!artType && queryArtType) artType = queryArtType;

  if (!hasStyleSignal) return null;
  return { inputType: 'style', styleImageUrl, artType };
}

/**
 * AI 图像生成页面
 */
export default function GenerationPage() {
  const toast = useToast();
  const location = useLocation();

  /* 风格迁移预填(§7.3:state 优先/query 兜底;幂等无害,仅作表单初始值) */
  const prefill = useMemo(
    () => resolvePrefill({ state: location.state, search: location.search }),
    [location.state, location.search],
  );

  /* 步骤状态机 */
  const [step, setStep] = useState<Step>('form');
  /* 生成中当前状态(驱动 loading 文案) */
  const [genStatus, setGenStatus] = useState<GenerationStatus>('pending');
  /* 轮询计数(loading 进度感知) */
  const [pollCount, setPollCount] = useState(0);
  /* 生成成功结果 */
  const [images, setImages] = useState<GeneratedImage[]>([]);
  /* 是否降级 */
  const [usedFallback, setUsedFallback] = useState(false);
  /* 风格拆解(style 任务两阶段落库产物,生图失败也可能非空;M4-T6) */
  const [styleAnalysis, setStyleAnalysis] = useState<StyleAnalysis | null>(null);
  /* 失败原因 */
  const [failureReason, setFailureReason] = useState<string | null>(null);
  /* 当前任务 ID(轮询目标) */
  const taskIdRef = useRef<string | null>(null);
  /* 轮询定时器 */
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* 清理轮询定时器 */
  const clearPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /* 卸载时清理定时器,避免内存泄漏 */
  useEffect(() => clearPolling, [clearPolling]);

  /* 回到表单态(重试/重新生成/取消) */
  const handleBackToForm = useCallback(() => {
    clearPolling();
    setStep('form');
    setPollCount(0);
    setImages([]);
    setStyleAnalysis(null);
    setFailureReason(null);
    setUsedFallback(false);
    setGenStatus('pending');
  }, [clearPolling]);

  /**
   * 轮询生成任务,直到 success/failed
   * @param taskId 生成任务 ID
   */
  const startPolling = useCallback(
    (taskId: string) => {
      taskIdRef.current = taskId;
      setGenStatus('pending');
      setPollCount(0);

      const poll = async () => {
        if (!taskIdRef.current) return;
        try {
          const res = await getGeneration(taskIdRef.current);
          setUsedFallback(res.usedFallback);
          // 两阶段落库(§2.6 D-1):拆解可能在 processing 中途到达,每帧消费
          setStyleAnalysis(res.styleAnalysis ?? null);
          if (res.status === 'pending' || res.status === 'processing') {
            setGenStatus(res.status);
            return; // 继续下一轮
          }
          // 终态:停止轮询
          clearPolling();
          if (res.status === 'success') {
            setImages(res.images ?? []);
            setStep('result');
          } else {
            setFailureReason(res.failureReason);
            setStep('failed');
          }
        } catch (err) {
          // 轮询失败:停止轮询并回到表单,提示用户重试(避免无限轮询)
          clearPolling();
          handleApiError(err);
          setStep('form');
        }
      };

      pollTimerRef.current = setInterval(() => {
        setPollCount((c) => c + 1);
        void poll();
      }, POLL_INTERVAL_MS);
    },
    [clearPolling, handleApiError]
  );

  /* 首次立即查一次(缩短等待),再启动定时轮询 */
  const startPollingWithImmediate = useCallback(
    (taskId: string) => {
      startPolling(taskId);
      // 立即执行一次查询,不必等首个 2s 间隔
      void (async () => {
        if (!taskId) return;
        try {
          const res = await getGeneration(taskId);
          setUsedFallback(res.usedFallback);
          setStyleAnalysis(res.styleAnalysis ?? null);
          if (res.status === 'success') {
            clearPolling();
            setImages(res.images ?? []);
            setStep('result');
          } else if (res.status === 'failed') {
            clearPolling();
            setFailureReason(res.failureReason);
            setStep('failed');
          } else {
            setGenStatus(res.status);
          }
        } catch {
          /* 首次查询失败,交由定时轮询兜底 */
        }
      })();
    },
    [startPolling, clearPolling]
  );

  /* 配额/限流差异化错误提示 */
  function handleApiError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === GENERATION_QUOTA_EXCEEDED) {
        toast.error('生成配额已用完', '本月生成次数已达上限，请升级订阅后继续');
        return;
      }
      if (err.code === GENERATION_RATE_LIMITED) {
        toast.error('操作过于频繁', '生成接口限流中，请稍后再试');
        return;
      }
      toast.error('生成失败', err.message);
      return;
    }
    toast.error('生成失败', err instanceof Error ? err.message : '请稍后重试');
  }

  /* 表单提交 → 创建生成任务 */
  const handleSubmit = async (values: GenerationFormValues) => {
    try {
      const res = await createGeneration({
        inputType: values.inputType,
        // text=画面描述 / style=新画面内容描述(均映射 prompt 字段;M4-T6)
        prompt: values.inputType === 'text' || values.inputType === 'style'
          ? values.prompt
          : undefined,
        sketchImageUrl: values.inputType === 'sketch' ? values.sketchImageUrl : undefined,
        // style:压缩后 dataURL(本地上传)或 http URL(prefill 预填,不压缩)
        styleImageUrl: values.inputType === 'style' ? values.styleImageUrl : undefined,
        artType: values.artType,
        aspect: values.aspect,
        count: values.count,
      });

      // 同步模式直接返回终态(契约 CreateGenerationResponse 不含 styleAnalysis,
      // 拆解仅在 GET 轮询响应中消费;前端默认异步模式不受影响)
      if (res.status === 'success') {
        setImages(res.images ?? []);
        setStep('result');
        return;
      }
      if (res.status === 'failed') {
        setFailureReason('生成任务创建失败');
        setStep('failed');
        return;
      }

      // 异步模式:进入生成中并轮询
      setStep('generating');
      startPollingWithImmediate(res.taskId);
    } catch (err) {
      handleApiError(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-cinnabar/10">
          <Wand2 className="w-5 h-5 text-cinnabar" />
        </div>
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">AI 生成</h1>
          <p className="text-sm text-ink-500">
            由文字、草稿或大师作品风格迁移生成专属参考作品，一键进入诊断闭环
          </p>
        </div>
      </div>

      {/* 步骤内容 */}
      {step === 'form' && (
        <GenerationForm submitting={false} onSubmit={handleSubmit} prefill={prefill} />
      )}
      {step === 'generating' && (
        <GenerationLoading status={genStatus} pollCount={pollCount} onCancel={handleBackToForm} />
      )}
      {step === 'result' && (
        <GenerationResult
          images={images}
          usedFallback={usedFallback}
          styleAnalysis={styleAnalysis}
          onRegenerate={handleBackToForm}
        />
      )}
      {step === 'failed' && (
        <GenerationFailed
          failureReason={failureReason}
          styleAnalysis={styleAnalysis}
          onRetry={handleBackToForm}
        />
      )}
    </div>
  );
}
