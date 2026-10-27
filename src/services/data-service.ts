// ============================================================
// 丹青有AI - 统一数据服务层
// ------------------------------------------------------------
// 设计目标:
//   1. 抽象数据来源(API / LocalStorage),业务页面只调用 dataService.*
//      不再直接读写 localStorage,也不再直接 fetch 后端
//   2. 已登录(hasAccessToken)走后端 API;未登录或 API 失败回退 LocalStorage
//      保证未登录用户体验不退化
//   3. 现有 mockData.ts 公开函数保持签名不变,内部委托给本模块,
//      实现零破坏迁移(各页面按需切换)
//
// 对应文档:
//   - .trae/documents/api-contract-v1.md §3.5 AI 分析相关类型
//   - src/types/api-contract.ts(只读同步副本)
//
// 严格 TypeScript:禁止 any,所有 props 显式类型
// ============================================================

import type {
  AnalysisResult,
  HistoryRecord,
  GrowthData,
  ArtType,
  HeritageCategory,
  EvaluationStage,
  ScoreCriteria,
  IssueMarker,
  DepthDimensionScore,
  DiagnosisMode,
  ExamSubject,
  ProfessionalSuggestion,
} from '../types';
import type {
  ListAnalysesResponse,
  AnalysisDetail,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  GetAnalysisResponse,
} from '../types/api-contract';
import { hasAccessToken } from './token-store';
import { get, post, del, batchDeleteAnalyses as apiBatchDeleteAnalyses } from './api';
import type {
  BatchDeleteAnalysesResponse,
} from './api';
import {
  saveToHistory as lsSaveToHistory,
  getHistory as lsGetHistory,
  getAnalysisResult as lsGetAnalysisResult,
  generateGrowthDataFromHistory as lsGenerateGrowthData,
} from './mockData';

/* ============================================================
 * 1. 通用类型与常量
 * ============================================================ */

/** LocalStorage key 集中管理(单一真相源) */
export const LS_KEYS = {
  history: 'danqing-ai-history',
  favorites: 'artwork-favorites',
  savedMaterials: 'danqing-ai-saved-materials',
  emotionPalette: 'danqing-ai-emotion-palette',
  settings: 'danqing-ai-settings',
  /** 主题独立键:便于 App.tsx 启动时同步读取,避免 settings 整对象解析延迟 */
  theme: 'danqing-ai-theme',
  /** 界面密度独立键:同上 */
  density: 'danqing-ai-density',
  /** 运行模式(本地/云端/自动)独立键:用于跨组件同步 */
  onlineMode: 'danqing-ai-online-mode',
} as const;

/** 收藏操作结果 */
export interface FavoriteToggleResult {
  /** 操作后的收藏状态(true=已收藏) */
  favorited: boolean;
  /** 操作后的完整收藏 ID 列表 */
  favorites: string[];
}

/** 嫁接保存的素材记录 */
export interface SavedMaterial {
  id: string;
  imageUrl: string;
  title: string;
  createdAt: string;
  source: 'fuse' | 'emotion' | 'material';
  /**
   * 非遗类目标记(Phase F 新增,可选):
   * 仅当该素材由「非遗纹样」参与灵感嫁接生成时携带,
   * 供 HistoryPage 灵感作品分类下显示非遗徽章。
   * 旧记录无此字段,缺失时不渲染非遗标记(向后兼容)。
   */
  heritageCategory?: HeritageCategory;
}

/** 情绪画板色板 */
export interface EmotionPalette {
  emotion: string;
  colorPalette: string[];
  intensity: number;
  createdAt: string;
}

/** 用户设置(前端本地偏好,非 UserProfile) */
export interface UserSettings {
  theme: 'rice' | 'ink' | 'auto';
  density: 'compact' | 'comfortable' | 'spacious';
  notifications: {
    analysis: boolean;
    growth: boolean;
    system: boolean;
  };
  cloudSync: {
    enabled: boolean;
    autoSync: boolean;
    multiDevice: boolean;
  };
  privacy: {
    anonymousAnalytics: boolean;
    localFirst: boolean;
    twoFactor: boolean;
  };
}

/** 默认设置(首次访问) */
const DEFAULT_SETTINGS: UserSettings = {
  theme: 'rice',
  density: 'comfortable',
  notifications: { analysis: true, growth: true, system: false },
  cloudSync: { enabled: true, autoSync: true, multiDevice: false },
  privacy: { anonymousAnalytics: true, localFirst: true, twoFactor: false },
};

/* ============================================================
 * 2. 数据服务接口
 * ============================================================ */

/**
 * 统一数据服务接口
 * 所有业务页面通过此接口访问数据,不直接接触 localStorage / fetch
 */
export interface IDataService {
  /** 当前数据源标识(用于调试与 UI 提示) */
  readonly source: 'api' | 'local';

  /* ---------- 分析历史 ---------- */
  /** 获取分析历史列表(可选过滤参数) */
  getAnalysisHistory(query?: HistoryQuery): Promise<HistoryRecord[]>;
  /** 保存分析结果到历史 */
  saveAnalysis(result: AnalysisResult): Promise<void>;
  /** 获取单条分析详情(包含完整维度) */
  getAnalysisDetail(id: string): Promise<AnalysisResult | null>;
  /** 清空分析历史 */
  clearAnalysisHistory(): Promise<void>;
  /**
   * 批量删除分析记录(跨端批删一致性 P-06)
   * 调用服务端 POST /analyses/batch-delete(已登录)或本地 LocalStorage(未登录)
   * @param ids 待删除 ID 列表(最多 100 条)
   * @returns 服务端逐条结果;失败时抛出 ApiError,由调用方在页面层做回滚
   */
  batchDeleteAnalyses(ids: string[]): Promise<BatchDeleteAnalysesResponse>;

  /* ---------- 成长数据 ---------- */
  /** 获取成长曲线数据(由历史聚合) */
  getGrowthData(): Promise<GrowthData[]>;

  /* ---------- 收藏(素材库) ---------- */
  /** 获取收藏作品 ID 列表 */
  getFavorites(): Promise<string[]>;
  /** 切换收藏状态 */
  toggleFavorite(id: string): Promise<FavoriteToggleResult>;

  /* ---------- 嫁接保存的素材 ---------- */
  /** 获取已保存的嫁接素材 */
  getSavedMaterials(): Promise<SavedMaterial[]>;
  /** 保存一条嫁接素材 */
  saveSavedMaterial(item: Omit<SavedMaterial, 'id' | 'createdAt'>): Promise<SavedMaterial>;
  /** 删除一条已保存素材 */
  removeSavedMaterial(id: string): Promise<void>;

  /* ---------- 情绪画板 ---------- */
  /** 获取最近一次保存的情绪色板 */
  getEmotionPalette(): Promise<EmotionPalette | null>;
  /** 保存情绪色板 */
  saveEmotionPalette(palette: Omit<EmotionPalette, 'createdAt'>): Promise<EmotionPalette>;

  /* ---------- 用户设置(本地偏好) ---------- */
  /** 获取用户设置 */
  getSettings(): Promise<UserSettings>;
  /** 保存用户设置(部分更新) */
  saveSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
}

/** 历史查询参数(前端友好版本,内部转 ListAnalysesQuery) */
export interface HistoryQuery {
  artType?: ArtType;
  /** 限制返回条数,默认 50 */
  limit?: number;
  /** 起始日期(ISO 8601) */
  startDate?: string;
  /** 结束日期(ISO 8601) */
  endDate?: string;
}

/* ============================================================
 * 3. LocalStorage 实现(默认回退)
 * ============================================================ */

/**
 * LocalStorage 数据服务
 * 保持与原 mockData.ts 完全一致的行为,作为未登录或 API 失败时的兜底
 */
class LocalDataService implements IDataService {
  readonly source = 'local' as const;

  /* ---------- 分析历史 ---------- */
  async getAnalysisHistory(_query?: HistoryQuery): Promise<HistoryRecord[]> {
    // LocalStorage 模式不支持服务端筛选,直接返回全部(由调用方前端过滤)
    return lsGetHistory();
  }

  async saveAnalysis(result: AnalysisResult): Promise<void> {
    lsSaveToHistory(result);
  }

  async getAnalysisDetail(id: string): Promise<AnalysisResult | null> {
    return lsGetAnalysisResult(id);
  }

  async clearAnalysisHistory(): Promise<void> {
    try {
      localStorage.removeItem(LS_KEYS.history);
    } catch {
      /* localStorage 不可用(隐私模式),忽略 */
    }
  }

  async batchDeleteAnalyses(ids: string[]): Promise<BatchDeleteAnalysesResponse> {
    // 未登录模式:直接从 LocalStorage 剔除选中记录
    const list = await lsGetHistory();
    const idSet = new Set(ids);
    const kept = list.filter((r) => r.id && !idSet.has(r.id));
    // 计算实际删除数(仅存在于本地的 id 才算删除成功)
    const presentIds = list.map((r) => r.id);
    const presentSet = new Set(presentIds);
    try {
      localStorage.setItem(LS_KEYS.history, JSON.stringify(kept));
    } catch {
      /* localStorage 写入失败,忽略(仅保留内存态由页面层处理) */
    }
    // 逐条返回结果:存在的 id 删除成功;不存在的返回失败原因
    const items = ids.map((id) =>
      presentSet.has(id)
        ? { id, deleted: true }
        : { id, deleted: false, error: '记录不存在' }
    );
    return {
      total: ids.length,
      deleted: items.filter((i) => i.deleted).length,
      failedCount: items.filter((i) => !i.deleted).length,
      items,
    };
  }

  /* ---------- 成长数据 ---------- */
  async getGrowthData(): Promise<GrowthData[]> {
    return lsGenerateGrowthData();
  }

  /* ---------- 收藏 ---------- */
  async getFavorites(): Promise<string[]> {
    try {
      const raw = localStorage.getItem(LS_KEYS.favorites);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async toggleFavorite(id: string): Promise<FavoriteToggleResult> {
    const list = await this.getFavorites();
    const set = new Set(list);
    let favorited: boolean;
    if (set.has(id)) {
      set.delete(id);
      favorited = false;
    } else {
      set.add(id);
      favorited = true;
    }
    const next = Array.from(set);
    try {
      localStorage.setItem(LS_KEYS.favorites, JSON.stringify(next));
    } catch {
      /* localStorage 写入失败,忽略 */
    }
    return { favorited, favorites: next };
  }

  /* ---------- 嫁接保存素材 ---------- */
  async getSavedMaterials(): Promise<SavedMaterial[]> {
    try {
      const raw = localStorage.getItem(LS_KEYS.savedMaterials);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveSavedMaterial(
    item: Omit<SavedMaterial, 'id' | 'createdAt'>
  ): Promise<SavedMaterial> {
    const list = await this.getSavedMaterials();
    const full: SavedMaterial = {
      ...item,
      id: `${item.source}-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    list.unshift(full);
    try {
      localStorage.setItem(LS_KEYS.savedMaterials, JSON.stringify(list));
    } catch {
      /* localStorage 写入失败,忽略 */
    }
    return full;
  }

  async removeSavedMaterial(id: string): Promise<void> {
    const list = await this.getSavedMaterials();
    const next = list.filter((m) => m.id !== id);
    try {
      localStorage.setItem(LS_KEYS.savedMaterials, JSON.stringify(next));
    } catch {
      /* localStorage 写入失败,忽略 */
    }
  }

  /* ---------- 情绪画板 ---------- */
  async getEmotionPalette(): Promise<EmotionPalette | null> {
    try {
      const raw = localStorage.getItem(LS_KEYS.emotionPalette);
      if (!raw) return null;
      return JSON.parse(raw) as EmotionPalette;
    } catch {
      return null;
    }
  }

  async saveEmotionPalette(
    palette: Omit<EmotionPalette, 'createdAt'>
  ): Promise<EmotionPalette> {
    const full: EmotionPalette = {
      ...palette,
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(LS_KEYS.emotionPalette, JSON.stringify(full));
    } catch {
      /* localStorage 写入失败,忽略 */
    }
    return full;
  }

  /* ---------- 用户设置 ---------- */
  async getSettings(): Promise<UserSettings> {
    try {
      const raw = localStorage.getItem(LS_KEYS.settings);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<UserSettings>;
      // 与默认值合并,避免老数据缺字段
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
        cloudSync: { ...DEFAULT_SETTINGS.cloudSync, ...parsed.cloudSync },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy },
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const next: UserSettings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
      cloudSync: { ...current.cloudSync, ...patch.cloudSync },
      privacy: { ...current.privacy, ...patch.privacy },
    };
    try {
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(next));
    } catch {
      /* localStorage 写入失败,忽略 */
    }
    return next;
  }
}

/* ============================================================
 * 4. API 实现(已登录时使用)
 * ============================================================ */

/**
 * API 数据服务
 *
 * 注意:
 *  - 后端 /analyses 列表项(AnalysisListItem)只含 overallScore,
 *    不含 dimension1/2/3Score,故 HistoryRecord 的三个维度分数需在
 *    详情接口或前端聚合时补齐;此处列表用 0 占位,详情走 getAnalysisDetail
 *  - 收藏 / 嫁接素材 / 情绪色板 / 用户设置 暂无后端接口,
 *    全部走 LocalStorage(由 _local 委托)
 */
class ApiDataService implements IDataService {
  readonly source = 'api' as const;

  /** 内部 LocalStorage 兜底(用于无后端接口的能力) */
  private readonly fallback = new LocalDataService();

  /* ---------- 分析历史 ---------- */
  async getAnalysisHistory(query?: HistoryQuery): Promise<HistoryRecord[]> {
    try {
      const apiQuery: Record<string, string | number | boolean | undefined | null> = {
        page: 1,
        pageSize: query?.limit ?? 50,
        artType: query?.artType,
        startDate: query?.startDate,
        endDate: query?.endDate,
      };
      const resp = await get<ListAnalysesResponse>('/analyses', apiQuery);
      return resp.items.map((item) => this.listItemToHistoryRecord(item));
    } catch {
      // API 失败(网络/超时/业务错误),回退 LocalStorage
      return this.fallback.getAnalysisHistory(query);
    }
  }

  async saveAnalysis(result: AnalysisResult): Promise<void> {
    // 后端通过 POST /analyses 创建分析任务;此处仅当同步模式成功时落库
    // 注意:现有 AnalysisPage 流程先本地 saveToHistory 再可能调用本方法,
    //       为避免重复落库,本方法在 API 不可用时静默回退到 LocalStorage
    try {
      const body: CreateAnalysisRequest = {
        artType: result.artType,
        imageUrl: result.imageUrl,
      };
      await post<CreateAnalysisResponse>('/analyses', body, { silent: true });
      // 后端已记录,无需再写 LocalStorage
    } catch {
      // API 失败,回退 LocalStorage(保证用户不丢数据)
      await this.fallback.saveAnalysis(result);
    }
  }

  async getAnalysisDetail(id: string): Promise<AnalysisResult | null> {
    try {
      const detail = await get<GetAnalysisResponse>(`/analyses/${id}`, undefined, {
        silent: true,
      });
      return this.detailToAnalysisResult(detail);
    } catch {
      // API 失败,回退 LocalStorage(mockData 的 getAnalysisResult 会重新生成)
      return this.fallback.getAnalysisDetail(id);
    }
  }

  async clearAnalysisHistory(): Promise<void> {
    // 已登录:先调用后端 DELETE /analyses/:id 逐条删除服务端记录,
    // 再清空本地缓存(保证 API 模式下服务端数据同步清除)
    try {
      const resp = await get<ListAnalysesResponse>('/analyses', {
        page: 1,
        pageSize: 200,
      });
      // 并发删除,单条失败不阻塞整体(allSettled 静默处理)
      await Promise.allSettled(
        resp.items.map((item) =>
          del<unknown>(`/analyses/${item.id}`, { silent: true })
        )
      );
    } catch {
      // 列表拉取失败(网络/超时),仅清本地缓存兜底
    } finally {
      // 同步清空本地缓存(API 模式下本地可能仍有旧数据)
      await this.fallback.clearAnalysisHistory();
    }
  }

  async batchDeleteAnalyses(ids: string[]): Promise<BatchDeleteAnalysesResponse> {
    // 已登录:调用服务端批删接口 POST /analyses/batch-delete
    //  - 乐观更新 + 回滚由页面层(HistoryPage)负责:先本地剔除选中项,
    //    请求抛错(网络/超时/业务错误)则回滚恢复
    //  - 任一 deleted=false 时,由调用方依据 items 逐条 toast error
    //  - 成功后由调用方重新拉取(getAnalysisHistory)以服务端为准,
    //    等价于契约要求的 invalidateQueries(['analyses'])
    return apiBatchDeleteAnalyses(ids);
  }

  /* ---------- 成长数据 ---------- */
  async getGrowthData(): Promise<GrowthData[]> {
    // 后端无独立成长数据接口,前端基于历史聚合
    // 已登录时从 API 拉历史再聚合,失败则回退 mockData 逻辑
    try {
      const history = await this.getAnalysisHistory({ limit: 50 });
      if (history.length === 0) {
        return this.fallback.getGrowthData();
      }
      return this.aggregateGrowthFromHistory(history);
    } catch {
      return this.fallback.getGrowthData();
    }
  }

  /* ---------- 收藏(暂无后端接口,走 LocalStorage) ---------- */
  async getFavorites(): Promise<string[]> {
    return this.fallback.getFavorites();
  }
  async toggleFavorite(id: string): Promise<FavoriteToggleResult> {
    return this.fallback.toggleFavorite(id);
  }

  /* ---------- 嫁接保存素材(暂无后端接口,走 LocalStorage) ---------- */
  async getSavedMaterials(): Promise<SavedMaterial[]> {
    return this.fallback.getSavedMaterials();
  }
  async saveSavedMaterial(
    item: Omit<SavedMaterial, 'id' | 'createdAt'>
  ): Promise<SavedMaterial> {
    return this.fallback.saveSavedMaterial(item);
  }
  async removeSavedMaterial(id: string): Promise<void> {
    return this.fallback.removeSavedMaterial(id);
  }

  /* ---------- 情绪画板(暂无后端接口,走 LocalStorage) ---------- */
  async getEmotionPalette(): Promise<EmotionPalette | null> {
    return this.fallback.getEmotionPalette();
  }
  async saveEmotionPalette(
    palette: Omit<EmotionPalette, 'createdAt'>
  ): Promise<EmotionPalette> {
    return this.fallback.saveEmotionPalette(palette);
  }

  /* ---------- 用户设置(本地偏好,走 LocalStorage) ---------- */
  async getSettings(): Promise<UserSettings> {
    return this.fallback.getSettings();
  }
  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    return this.fallback.saveSettings(patch);
  }

  /* ---------- 内部工具 ---------- */

  /** AnalysisListItem -> HistoryRecord(三维度分数暂用 0 占位) */
  private listItemToHistoryRecord(
    item: ListAnalysesResponse['items'][number]
  ): HistoryRecord {
    return {
      id: item.id,
      imageUrl: item.imageUrl,
      createdAt: item.createdAt,
      artType: item.workType,
      /* 批次②:保留 null(无评分基础检测)而非造 0 分,由 UI 层显示"—" */
      overallScore: item.overallScore,
      dimension1Score: 0,
      dimension2Score: 0,
      dimension3Score: 0,
    };
  }

  /**
   * AnalysisDetail -> AnalysisResult(合并详情字段 + 结果字段)
   *
   * detail.result 类型为 api-contract 的 AnalysisResult(精简版,仅 artType/dimensions/
   * originality/overallScore)。后端实际返回的 JSON 已包含阶段 D 深度分析字段
   * (aiEnhanced/evaluationStage/scoreCriteria/issueMarkers/4 深度维度/heritageCategory
   * /aiVisionResult/diagnosisMode 等),此处用类型断言安全提取并透传,避免修改只读的
   * api-contract 类型声明(对齐 AnalysisPage extractReferenceArtworks 同款断言模式)。
   */
  private detailToAnalysisResult(detail: AnalysisDetail): AnalysisResult | null {
    if (!detail.result) return null;
    const raw = detail.result as unknown as {
      aiEnhanced?: boolean;
      evaluationStage?: EvaluationStage;
      scoreCriteria?: ScoreCriteria[];
      issueMarkers?: IssueMarker[];
      originalityAndStyle?: DepthDimensionScore;
      completenessAndRhythm?: DepthDimensionScore;
      emotionAndMood?: DepthDimensionScore;
      craftsmanship?: DepthDimensionScore;
      aiVisionResult?: AnalysisResult['aiVisionResult'];
      diagnosisMode?: DiagnosisMode;
      examSubject?: ExamSubject | null;
      heritageCategory?: HeritageCategory;
      professionalSuggestions?: ProfessionalSuggestion[];
      artworkCheck?: AnalysisResult['artworkCheck'];
      cacheHit?: boolean;
      jimpDurationMs?: number;
      aiDurationMs?: number;
      scoreTrace?: AnalysisResult['scoreTrace'];
      rubricSummary?: AnalysisResult['rubricSummary'];
    };
    return {
      id: detail.id,
      imageUrl: detail.imageUrl,
      createdAt: detail.createdAt,
      artType: detail.result.artType,
      dimensions: detail.result.dimensions,
      originality: detail.result.originality,
      overallScore: detail.result.overallScore,
      aiEnhanced: raw.aiEnhanced,
      evaluationStage: raw.evaluationStage,
      scoreCriteria: raw.scoreCriteria,
      issueMarkers: raw.issueMarkers,
      originalityAndStyle: raw.originalityAndStyle,
      completenessAndRhythm: raw.completenessAndRhythm,
      emotionAndMood: raw.emotionAndMood,
      craftsmanship: raw.craftsmanship,
      aiVisionResult: raw.aiVisionResult,
      diagnosisMode: raw.diagnosisMode,
      examSubject: raw.examSubject,
      heritageCategory: raw.heritageCategory,
      professionalSuggestions: raw.professionalSuggestions,
      artworkCheck: raw.artworkCheck,
      cacheHit: raw.cacheHit,
      jimpDurationMs: raw.jimpDurationMs,
      aiDurationMs: raw.aiDurationMs,
      scoreTrace: raw.scoreTrace,
      rubricSummary: raw.rubricSummary,
    };
  }

  /** 从历史记录聚合成长数据(复用 mockData 同款算法) */
  private aggregateGrowthFromHistory(history: HistoryRecord[]): GrowthData[] {
    const sorted = [...history].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const grouped = new Map<string, HistoryRecord[]>();
    for (const r of sorted) {
      const d = new Date(r.createdAt);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }
    const data: GrowthData[] = [];
    for (const [dateStr, records] of grouped) {
      data.push({
        date: dateStr,
        dimension1: Math.round(
          records.reduce((s, r) => s + r.dimension1Score, 0) / records.length
        ),
        dimension2: Math.round(
          records.reduce((s, r) => s + r.dimension2Score, 0) / records.length
        ),
        dimension3: Math.round(
          records.reduce((s, r) => s + r.dimension3Score, 0) / records.length
        ),
        /* 批次②:仅对有评分记录求均值,该日无评分则得 0 */
        overall: (() => {
          const scored = records.filter((r) => r.overallScore != null);
          return scored.length > 0
            ? Math.round(scored.reduce((s, r) => s + (r.overallScore ?? 0), 0) / scored.length)
            : 0;
        })(),
      });
    }
    return data.slice(-14);
  }
}

/* ============================================================
 * 5. 工厂与单例
 * ============================================================ */

let currentService: IDataService | null = null;

/**
 * 获取当前数据服务
 *
 * 选择策略:
 *   - hasAccessToken() === true -> ApiDataService(已登录)
 *   - 否则 -> LocalDataService(未登录)
 *
 * 注意:每次调用都会重新判断登录态,确保登录/登出后立即切换数据源
 */
export function getDataService(): IDataService {
  if (currentService && currentService.source === 'api' && hasAccessToken()) {
    return currentService;
  }
  if (currentService && currentService.source === 'local' && !hasAccessToken()) {
    return currentService;
  }
  // 状态变化,重建实例
  currentService = hasAccessToken()
    ? new ApiDataService()
    : new LocalDataService();
  return currentService;
}

/** 强制重置数据服务(测试或登出时使用) */
export function resetDataService(): void {
  currentService = null;
}

/* ============================================================
 * 6. 便捷导出:常用方法直调
 * ============================================================ */

/** 获取分析历史 */
export const getAnalysisHistory = (query?: HistoryQuery): Promise<HistoryRecord[]> =>
  getDataService().getAnalysisHistory(query);

/** 保存分析结果 */
export const saveAnalysis = (result: AnalysisResult): Promise<void> =>
  getDataService().saveAnalysis(result);

/** 获取分析详情 */
export const getAnalysisDetail = (id: string): Promise<AnalysisResult | null> =>
  getDataService().getAnalysisDetail(id);

/** 清空分析历史 */
export const clearAnalysisHistory = (): Promise<void> =>
  getDataService().clearAnalysisHistory();

/** 批量删除分析记录(P-06 跨端批删一致性)
 * 乐观更新 + 回滚由页面层实现:先本地剔除选中项,失败则回滚恢复 */
export const batchDeleteAnalyses = (ids: string[]): Promise<BatchDeleteAnalysesResponse> =>
  getDataService().batchDeleteAnalyses(ids);

/** 获取成长数据 */
export const getGrowthData = (): Promise<GrowthData[]> =>
  getDataService().getGrowthData();

/** 获取收藏列表 */
export const getFavorites = (): Promise<string[]> =>
  getDataService().getFavorites();

/** 切换收藏 */
export const toggleFavorite = (id: string): Promise<FavoriteToggleResult> =>
  getDataService().toggleFavorite(id);

/** 获取已保存素材 */
export const getSavedMaterials = (): Promise<SavedMaterial[]> =>
  getDataService().getSavedMaterials();

/** 保存素材 */
export const saveSavedMaterial = (
  item: Omit<SavedMaterial, 'id' | 'createdAt'>
): Promise<SavedMaterial> => getDataService().saveSavedMaterial(item);

/** 删除已保存素材 */
export const removeSavedMaterial = (id: string): Promise<void> =>
  getDataService().removeSavedMaterial(id);

/** 获取情绪色板 */
export const getEmotionPalette = (): Promise<EmotionPalette | null> =>
  getDataService().getEmotionPalette();

/** 保存情绪色板 */
export const saveEmotionPalette = (
  palette: Omit<EmotionPalette, 'createdAt'>
): Promise<EmotionPalette> => getDataService().saveEmotionPalette(palette);

/** 获取用户设置 */
export const getSettings = (): Promise<UserSettings> =>
  getDataService().getSettings();

/** 保存用户设置 */
export const saveSettings = (patch: Partial<UserSettings>): Promise<UserSettings> =>
  getDataService().saveSettings(patch);
