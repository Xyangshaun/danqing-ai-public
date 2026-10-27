// ============================================================
// AI 视觉分析类型定义
// 对应文档:.trae/documents/ai-integration-design.md §3 Prompt 工程设计
//
// 设计要点:
//   1. 严格 TypeScript,禁止 any;所有字段显式类型
//   2. AI 返回 JSON 经 Zod schema 校验,缺失字段用默认值填充
//   3. score_adjustments.delta 强制 clamp [-5, +5],防止恶意高分/低分
//   4. HybridAnalysisResult 扩展现有 AnalysisResult,保持向后兼容
//
// 类型层次:
//   AIVisionResult           - AI 视觉分析原始结果(语义层)
//   ScoreAdjustment          - 评分校准(维度级 + 整体级)
//   ProfessionalSuggestion   - (已移至 api-contract.ts,共享类型)
//   ReferenceArtwork         - (已移至 api-contract.ts,共享类型)
//   HybridAnalysisResult     - 混合分析结果(Jimp 客观 + AI 语义)
//   AIFailureReason          - (已移至 api-contract.ts,共享类型)
// ============================================================

import type {
  AnalysisResult,
  ArtType,
  ProfessionalSuggestion,
  ReferenceArtwork,
  AIFailureReason,
  AIInvocationMeta,
  HeritageCategory,
  ObjectiveChecksData,
  TierEstimate,
} from './api-contract.js';
import type { FeedbackMode } from './grading-profile.js';

// 重新导出共享类型(方便其他服务从 ai-analysis.ts 一站式导入)
export type {
  ProfessionalSuggestion,
  ReferenceArtwork,
  AIFailureReason,
  AIInvocationMeta,
  HeritageCategory,
  TierEstimate,
} from './api-contract.js';
export type { SuggestionLevel, SuggestionPriority } from './api-contract.js';

// ============ 评分校准类型 ============

/**
 * 维度级评分校准
 * delta 强制 clamp 到 [-5, +5],防止 AI 偏差过大
 */
export interface DimensionAdjustment {
  /** 维度名(需与 AnalysisResult.dimensions 中的维度对应) */
  dimension: string;
  /** 评分调整值,整数,范围 [-5, +5] */
  delta: number;
  /** 校准理由(基于视觉特征) */
  reason: string;
}

/**
 * 整体评分校准
 * 包含维度级 + 整体级调整
 */
export interface ScoreAdjustments {
  /** 维度级校准列表 */
  dimensionAdjustments: DimensionAdjustment[];
  /** 整体评分调整值,整数,范围 [-5, +5] */
  overallDelta: number;
  /** 整体校准理由 */
  overallReason: string;
}

// ============ 诊断模式类型(2026-08-16 诊断理念重构) ============

/**
 * 诊断模式
 *   - teaching 教学诊断:面向艺术爱好者/零基础,1对1老师口吻,
 *     完整度先行→画面关系→顺着作者风格给建议,分数弱化
 *   - exam 艺考诊断:面向美术生,按联考/校考科目标准客观分档评分
 */
export type DiagnosisMode = 'teaching' | 'exam';

/**
 * 艺考科目(仅 exam 模式有意义)
 *   - sketch 素描 / color 色彩 / quickSketch 速写
 */
export type ExamSubject = 'sketch' | 'color' | 'quickSketch';

/**
 * 艺考档位(联考五档制)
 *   A=一档(90-100) B=二档(80-89) C=三档(70-79) D=四档(60-69) E=五档(<60)
 */
export type ExamGradeBand = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * 艺考科目维度评分(单维度)
 */
export interface ExamSubjectScore {
  /** 科目维度名(如"造型与比例") */
  dimension: string;
  /** 维度得分(0-100) */
  score: number;
  /** 该维度评语(扣分依据) */
  comment: string;
}

/**
 * 艺考诊断结果(仅 exam 模式,AI 输出 exam_result 时非空)
 */
export interface ExamResult {
  /** 档位(A-E) */
  gradeBand: ExamGradeBand;
  /** 档位中文标签(如"二档(80-89)") */
  gradeLabel: string;
  /** 档位评定理由(100字内) */
  gradeReason: string;
  /** 科目维度评分列表 */
  subjectScores: ExamSubjectScore[];
  /** 扣分点(具体到画面位置) */
  deductionPoints: string[];
  /** 提分策略(升档训练路径) */
  improvementStrategy: string;
}

// ============ 深度分析增强类型(2026-08-17 阶段 A 新增) ============
// 对应文档:.trae/specs/analysis-and-heritage-enhancement/tasks.md 阶段 A
// 设计要点:
//   1. 全部新增字段为可选(?),保证旧数据/旧 prompt 返回结果向后兼容
//   2. 4 维度评分参与 overallScore 加权(权重按 evaluationStage 不同分配,阶段 C 实现)
//   3. scoreCriteria/issueMarkers 由 AI 输出经 Zod 校验,缺失时降级为空数组(阶段 B Task 5)
//   4. evaluationStage 切换 AI 评分参照系(联考级对标省联考,美院级对标八大美院,大师级对标美术史)

/**
 * 评价阶段(评分参照系档位)
 * 与 DiagnosisMode 配合使用,决定 AI 评分的对标参照系:
 *   teaching 模式(教学诊断,面向艺术爱好者/零基础):
 *     - enthusiast    爱好者级(对标入门审美标准,弱化分数)
 *     - intermediate  进阶级(对标系统训练中期水平)
 *     - advanced      资深级(对标成熟创作者水平)
 *   exam 模式(艺考诊断,面向美术生):
 *     - unified       联考级(对标省联考标准)
 *     - academy       美院级(对标八大美院校考标准)
 *     - master        大师级(对标美术史经典作品标准)
 * 缺省(null/undefined)时按 teaching+enthusiast 或 exam+unified 默认渲染
 */
export type EvaluationStage =
  // ---- teaching 模式档位 ----
  | 'enthusiast' // 爱好者级
  | 'intermediate' // 进阶级
  | 'advanced' // 资深级
  // ---- exam 模式档位 ----
  | 'unified' // 联考级
  | 'academy' // 美院级
  | 'master'; // 大师级

/**
 * 专业深度维度评分(单维度)
 * 4 维度:原创性与风格识别度 / 画面完整度与节奏感 / 情感表达与意境传达 / 技术完成度与工艺规范
 * 仅深度分析(AI 增强)结果返回,旧数据无此字段
 */
export interface DepthDimensionScore {
  /** 维度得分(0-100) */
  score: number;
  /** 维度分析(100 字内,要求引用画面具体证据,禁止模板化) */
  analysis: string;
  /** 改进建议(具体可操作) */
  suggestion: string;
}

/**
 * 标注参考引用(Phase 3 批次③:参考图混合方案第④层"参考")
 *
 * 由后端匹配引擎在管线尾后处理注入(AI 不生成——模型不知道卡片库存在,
 * 避免幻觉 ID);旧数据/AI 直出/本地快速分析无此字段=无参考(前端不渲染)。
 * kind 语义(反馈模式路由,spec §5.1):
 *   - step-guide:分步教学图卡(diagnosis 模式优先;弹层拉 /knowledge-cards/:id)
 *   - master-work:知识库/非遗作品对照(guidance 模式优先;跨域启发倾向)
 */
export interface IssueMarkerReference {
  /** 参考类型:step-guide=分步教学图卡 / master-work=知识库作品对照 */
  kind: 'step-guide' | 'master-work';
  /** 知识点卡片 ID(kind=step-guide 时必填;GET /api/v1/knowledge-cards/:id 拉详情) */
  cardId?: string;
  /** 知识库作品 ID(kind=master-work 时必填;artworks.json / heritage-works.json 的 id) */
  workId?: string;
  /** 一句话钩子(卡片上直接展示,如"颧骨三面分析步骤图"/"《星月夜》·冷暖对照") */
  teaser: string;
}

/**
 * 问题区域标注(Canvas 叠层用)
 * 坐标系为相对值(0-1),渲染时乘以图片实际宽高,实现响应式重映射
 *
 * 2026-09-03 Phase 1A 扩展(锚定卡片式标注):
 *   - 上限 3 → 8;新增 type(三级严重度含正向 highlight)/dimension(维度归属)/why(原理)/how(改法)
 *   - 新字段全部可选,旧数据(无新字段)由前端按 severity 兜底渲染,不阻断
 *
 * 2026-09-06 Phase 3 批次③扩展(第④层"参考"):
 *   - 新增 reference(可选;匹配引擎注入,见 IssueMarkerReference)
 */
export interface IssueMarker {
  /** 标注稳定 ID(Phase 4 批次①:管线尾注入的确定性短 hash——label+坐标+type;
   *  同内容同 ID(可跨分析去重统计);旧数据缺失=无 ID,消费侧(反馈/批注)用 markerIndex+快照兜底) */
  id?: string;
  /** 标注框左上角 x 坐标(相对值 0-1,左→右) */
  x: number;
  /** 标注框左上角 y 坐标(相对值 0-1,上→下) */
  y: number;
  /** 标注框宽度(相对值 0-1) */
  w: number;
  /** 标注框高度(相对值 0-1) */
  h: number;
  /** 问题标签(如"构图偏移""色调沉闷";highlight 类型时为亮点标签) */
  label: string;
  /** 严重程度:high=高(红虚线)/medium=中(黄实线)/low=低(蓝点线) */
  severity: 'high' | 'medium' | 'low';
  /** 改进提示(鼠标悬停气泡展示,具体可操作) */
  improvementHint: string;
  /** 标注类型:critical=关键问题 / suggestion=建议改进 / highlight=做得好(正向标注,绿色柔和高亮)
   *  可选:缺失时前端按 severity 映射(high→critical,low→highlight 兜底) */
  type?: 'critical' | 'suggestion' | 'highlight';
  /** 维度归属(如"构图""造型""明暗""色彩""空间";非遗类目为工艺维度,自由文本) */
  dimension?: string;
  /** 原理解释:为什么这是问题(60字内,教学价值核心) */
  why?: string;
  /** 改法:具体可操作步骤(60字内) */
  how?: string;
  /** 第④层"参考"(Phase 3):匹配引擎注入的卡片/作品引用;缺失=无参考 */
  reference?: IssueMarkerReference;
}

/**
 * 评分标准(单维度)
 * 描述每个维度的评分依据,支持评分面板展开展示(符合项/不符合项/证据)
 * 由 AI 输出,经 Zod 校验后透传到前端 ScoreCriteriaPanel 组件
 */
export interface ScoreCriteria {
  /** 维度名(需与 AnalysisResult.dimensions 中的维度对应) */
  dimension: string;
  /** 权重(0-1,各维度权重之和应为 1) */
  weight: number;
  /** 满分(可选,缺省 100) */
  maxScore?: number;
  /** 评级:excellent=优秀/good=良好/average=一般/poor=较差 */
  level: 'excellent' | 'good' | 'average' | 'poor';
  /** 已达成的评分要点(具体到画面特征) */
  metCriteria: string[];
  /** 未达成的评分要点(扣分依据) */
  unmetCriteria: string[];
  /** 评分证据(引用具体数值/位置/特征,用于去同质化) */
  evidence: string;
}

/**
 * 作品特征指纹(算法去同质化核心载体,Task 6.3)
 * 记录本次分析的关键客观特征快照,供:
 *   1. 注入 AI prompt 要求引用具体数值证据(防止模板化建议)
 *   2. 后续相似作品对比(本次指纹 vs 历史指纹差异度)
 *   3. 去同质化验证(两张不同作品的指纹应明显不同)
 *
 * 字段全部来自 Jimp 客观像素分析 + pHash 比对,AI 不参与生成(保证可复现/可审计)
 */
export interface FeatureFingerprint {
  /** pHash 感知哈希相似度(0-1,与名作库比对的最大相似度) */
  pHashSimilarity?: number;
  /** 最相似的名作信息(pHash 比对结果,无可比作品时为 null) */
  mostSimilarWork?: MostSimilarWorkForPrompt | null;
  /** 关键客观指标快照(注入 prompt 的指纹子集,用于 AI 引用证据) */
  metricsSnapshot: {
    /** 视觉重心 x(0-1) */
    focusX: number;
    /** 视觉重心 y(0-1) */
    focusY: number;
    /** 留白比例(0-1) */
    whitespaceRatio: number;
    /** 暖色比例(0-1) */
    warmRatio: number;
    /** 冷色比例(0-1) */
    coolRatio: number;
    /** 平均亮度(0-255) */
    avgLuminance: number;
    /** 平均饱和度(0-100) */
    avgSaturation: number;
    /** 纹理复杂度(0-1) */
    textureComplexity: number;
    /** 边缘密度(0-1) */
    edgeDensity: number;
    /** 黄金分割评分(0-100,可选) */
    goldenRatioScore?: number;
    /** 色彩和谐度评分(0-100,可选) */
    harmonyScore?: number;
    /** 方向一致性(0-1,可选,笔触/形体方向统一程度) */
    directionCoherence?: number;
    /** 笔触能量/张力(0-1,可选) */
    strokeEnergy?: number;
  };
  /** 指纹生成时间戳(ISO 8601) */
  generatedAt: string;
}

// ============ 专业改进建议类型 ============
// SuggestionLevel / SuggestionPriority / ProfessionalSuggestion
// 已移至 api-contract.ts 作为 API 契约共享类型,此处不再重复定义

// ============ 参考案例类型 ============
// ReferenceArtwork 已移至 api-contract.ts 作为 API 契约共享类型

// ============ AI 视觉分析结果(语义层) ============

/**
 * AI 视觉分析结果
 * 由 GLM-4V 模型返回,经 Zod schema 校验后的结构化结果
 *
 * 字段说明:
 *   - semanticTheme       主题与意境理解(50-100字)
 *   - styleRecognition    风格识别(如"印象派条件色处理")
 *   - professionalSuggestions  专业改进建议(数组,每条含操作+案例+练习)
 *   - scoreAdjustments    评分校准(维度级 + 整体级,delta ±5)
 *   - referenceArtworks   参考案例推荐
 */
/**
 * 作品有效性校验结果(AI 第一步识别画面实际内容)
 * 防止用户误传表情包/照片/网图时 AI 强行套用维度"正常分析"
 */
export interface ArtworkCheck {
  /** match=确认为对应类型作品;mismatch=非作品图片(表情包/随手拍/网图等);uncertain=无法确定 */
  status: 'match' | 'mismatch' | 'uncertain';
  /** 画面实际内容描述(如"表情包""风景照片""素描习作") */
  actualType: string;
  /** 判断依据 */
  reason: string;
  /** 图片来源识别:来自哪一类渠道(网络表情包/随手拍摄照片/影视动漫截图/AI生成图等)(2026-08-16 新增,旧数据无) */
  sourceIdentification?: string;
  /** 作品来历分析:原图可能出处、画面特征线索(水印/画风/清晰度)、推断依据(2026-08-16 新增) */
  provenanceAnalysis?: string;
  /** 二创判断:derivative=在他人原图上有再创作痕迹;transfer=原样搬运无创作成分;uncertain=无法判断(2026-08-16 新增) */
  derivativeJudgment?: 'derivative' | 'transfer' | 'uncertain';
  /** 二创判断说明:再创作部分与程度,或搬运判断依据(2026-08-16 新增) */
  derivativeNote?: string;
}

export interface AIVisionResult {
  /** 作品有效性校验(AI 识别画面实际内容后输出;旧数据无此字段) */
  artworkCheck?: ArtworkCheck;
  /** 画面整体描述:主题、构图、色调、第一印象(100-150字) */
  visualDescription: string;
  /** 构图分析:结构、视觉重心、空间层次、问题定位(150-200字) */
  composition: string;
  /** 色彩分析:色调、冷暖关系、和谐度、问题定位(150-200字) */
  color: string;
  /** 技法分析:笔触/材质/工艺表现、问题定位(150-200字) */
  technique: string;
  /** 主题与意境理解(兼容旧字段) */
  semanticTheme: string;
  /** 风格识别(兼容旧字段) */
  styleRecognition: string;
  /** 专业改进建议(数组,每条含操作+案例+练习三要素;
   *  阶段 2 深度分析额外填充 aestheticPrinciple/masterReference/aestheticCultivation) */
  professionalSuggestions: ProfessionalSuggestion[];
  /** 评分校准(维度级 + 整体级,delta 强制 clamp ±5)。
   *  @deprecated 2026-09-04 批次④:prompt 已停止索取 delta,AI 改输出绝对分(overallScore/dimensionScores);
   *  merge 不再应用 delta;字段与解析保留仅为旧响应兼容(score-trace 历史证据同理) */
  scoreAdjustments: ScoreAdjustments;
  /** AI 绝对综合评分(0-100;批次④直采——替代"Jimp 假分底 + delta"派生模式) */
  overallScore?: number;
  /** AI 各标准维度绝对分(0-100;dimension 为中文维度名,merge 按关键词模糊匹配覆盖维度分) */
  dimensionScores?: Array<{ dimension: string; score: number }>;
  /** 参考案例推荐(美术史作品) */
  referenceArtworks: ReferenceArtwork[];
  /** 艺考诊断结果(仅 exam 模式且 AI 输出 exam_result 时非空) */
  examResult?: ExamResult;
  // ---- 深度分析增强字段(2026-08-17 阶段 A 新增;全部可选,旧数据/旧 prompt 无) ----
  /** 评价阶段(评分参照系档位;透传到 HybridAnalysisResult 顶层便于直接读取) */
  evaluationStage?: EvaluationStage;
  /** 原创性与风格识别度(0-100 + 100字分析 + 建议) */
  originalityAndStyle?: DepthDimensionScore;
  /** 画面完整度与节奏感(0-100 + 100字分析 + 建议) */
  completenessAndRhythm?: DepthDimensionScore;
  /** 情感表达与意境传达(0-100 + 100字分析 + 建议) */
  emotionAndMood?: DepthDimensionScore;
  /** 技术完成度与工艺规范(0-100 + 100字分析 + 建议) */
  craftsmanship?: DepthDimensionScore;
  /** 评分标准(各维度权重/评级/符合项/不符合项/证据;支持评分面板展开) */
  scoreCriteria?: ScoreCriteria[];
  /** 问题区域标注(1-3 个,相对坐标 0-1;前端 Canvas 叠层渲染) */
  issueMarkers?: IssueMarker[];
  // ---- 2026-08-18 三层美学洞察卡片(阶段 2 深度分析解锁;整体报告级,非单条建议级) ----
  /** 整体审美洞察卡片:美学原理/名作借鉴/审美培养三层折叠展示
   *  (仅阶段 2 AI 深度分析填充;阶段 1 不传 → 前端隐藏卡片) */
  aestheticInsight?: AestheticInsight;
  // ---- 2026-08-18 非遗文化解读三层(仅 artType=heritage 且 阶段 2 解锁) ----
  /** 非遗文化解读:纹样寓意/传统美学逻辑/老师傅经验三部分
   *  (artType≠heritage 时不传;阶段 1 不传) */
  heritageCulturalContext?: HeritageCulturalContext;
  // ---- Phase 2 批次④:档位估算(AI 深度分析时输出,可选) ----
  /** 档位估算(AI 按 grade_tier_estimate 自主估算解析产物;与联考 examResult.gradeBand 独立,
   *  merge 层缺省时按档案 tierMapping 对综合分换算兜底) */
  tierEstimate?: TierEstimate;
}

// ==================== 2026-08-18 新增:A 模块 三层美学洞察卡片 ====================

/** 整体审美洞察卡片(报告级;用户点「AI 深度」解锁)
 *  结构:AestheticInsightCard.tsx 折叠三层:
 *    层1 aestheticPrincipleSummary  → 美学原理(为什么这样画更好)
 *    层2 masterpieceConnection      → 名作借鉴(名作+作者+如何内化)
 *    层3 cultivationTakeaway       → 审美培养(本次练习训练了什么判断力)
 *  注:单条建议级别的三层在 ProfessionalSuggestion.{aestheticPrinciple,masterReference,aestheticCultivation}
 */
export interface AestheticInsight {
  /** 层1 美学原理(整体):用一段形式美法则话语总结这幅画最核心的审美原理。
   *  例:「这幅静物画的核心审美原理是"疏密对比与视觉受力平衡"——
   *  你把 3 件物品都摆在画面下半段,上半段留空,是上下疏密对比;
   *  但 3 件物品集中在左侧 1/4,造成右侧留白过多的"左倾",
   *  这就是受力不平衡,与"画面如天平"的形式美法则相背。」 */
  aestheticPrincipleSummary: string;
  /** 层2 名作借鉴(整体):1-2 幅名家作品,具体说明你这幅画可借鉴它们什么。
   *  例:「建议重点观察 2 幅:①莫兰迪《静物》系列中"物品团块化+空气留白"处理:
   *  他从不让每件物品各自"独立发光",而是把 3-4 件合并成一个整体几何形,
   *  让气息能在物体之间流动,这就是"呼吸感"。②塞尚《圣维克多山》对色块受力
   *  分布的平衡意识:山体右移后,前景的树干往左压,形成动态中的平衡。」 */
  masterpieceConnection: string;
  /** 层3 审美培养(整体):解释本次练习训练了哪项审美判断能力。
   *  例:「这次练习训练的是「整体观察与受力平衡预判力」。
   *  记住一个口诀:画完问 3 个问题——①如果画面是天平会往哪倒?
   *  ②如果画面是音乐会不会有乐器同时独奏的"太满"?
   *  ③视线停留 3 秒后会看哪里、能不能走完整张画?
   *  每一次画完都先做这 3 问,再动笔改,你就能从"只会抄对象"进化到"能经营画面"。」 */
  cultivationTakeaway: string;
}

// ==================== 2026-08-18 新增:A 模块 非遗文化解读三层 ====================

/** 非遗文化解读(仅 artType='heritage' 且阶段 2 解锁)
 *  三层:纹样寓意 → 传统美学逻辑 → 老师傅经验/口传心授
 *  对应 HeritageCulturalContextPanel.tsx
 */
export interface HeritageCulturalContext {
  /** 层1 纹样寓意:作品中出现的非遗产纹样(剪纸/刺绣/瓷器)各自有什么文化寓意
   *  例:「你剪的这组纹样中 ①蝙蝠 = "遍福"谐音,福临门;②牡丹 = 富贵花开,
   *  ③万字纹回形边 = 富贵不到头、连绵不绝;把这三种纹样放在一起,
   *  是民间"福寿双全、富贵绵长"的经典组合,常用于春节窗花与嫁妆绣品。」 */
  patternSymbolism: string;
  /** 层2 传统美学逻辑:非遗这门手艺背后的一整套审美体系(不是技法)
   *  例:「扬州剪纸的传统美学逻辑有 3 条——①"满而不堵":窗花题材一定要铺满整张纸,
   *  但线条之间留气口,让光能透过去,这叫"通气";②"对称求稳":
   *  绝大多数经典窗花用对折剪,追求左右镜像对称——因为民间审美里"对称=圆满=吉祥";
   *  ③"阳剪为形、阴剪为魂":线条连着的阳剪定造型,镂空的阴剪造韵律,一阴一阳谓之道。」 */
  traditionalAesthetic: string;
  /** 层3 老师傅经验/口传心授:这门手艺老艺人传下来的口诀、经验、审美判断
   *  ——不是评分,是一个从业 40 年的老师傅会怎么说。
   *  例:「剪了 40 年的王老会对你说:"姑娘啊,你这把蝙蝠剪得很灵动,
   *  但翅膀尖 3 处都断了——记住口诀叫'走线如流水,落脚如钉钉'。
   *  大轮廓要一刀走到底,不能有碎线;碎线多了,福气就接不上。
   *  再练对折剪时先别急着动剪,先在纸上用指甲划出'暗线',
   *  心里有数再下剪,这一步叫'胸有成竹'。"」 */
  masterWisdom: string;
}

// ============ AI 调用元信息 ============
// AIInvocationMeta 已移至 api-contract.ts 作为 API 契约共享类型

// ============ 混合分析结果 ============

/**
 * 混合分析结果
 * 扩展现有 AnalysisResult,追加 AI 语义增强字段
 *
 * 合并策略(对应 ai-integration-design.md §2.2):
 *   - Jimp 成功 + AI 成功 → 合并增强(score_adjustments 微调 ±5)
 *   - Jimp 成功 + AI 失败 → 仅 Jimp(aiEnhanced=false, aiFailureReason 记录原因)
 *   - Jimp 失败 + AI 成功 → AI 提供主结果 + Jimp fallback 兜底
 *   - Jimp 失败 + AI 失败 → 空回退(理论上不会触发)
 *
 * 向后兼容:现有 AnalysisResult 字段全部保留,新增字段为可选
 */
export interface HybridAnalysisResult extends AnalysisResult {
  /** 是否经过 AI 增强(true 表示 AI 成功合并) */
  aiEnhanced: boolean;
  /** 作品有效性校验(AI 增强成功且有识别结果时非空) */
  artworkCheck?: ArtworkCheck;
  /** AI 视觉分析结果(aiEnhanced=true 时非空) */
  aiVisionResult: AIVisionResult | null;
  /** AI 调用元信息(始终非空,记录调用情况) */
  aiMeta: AIInvocationMeta;
  // ---- 深度分析增强字段(2026-08-17 阶段 A 新增;顶层冗余,覆盖 aiVisionResult 同名字段,便于直接读取) ----
  /** 评价阶段(评分参照系档位;取自 aiVisionResult.evaluationStage 的冗余拷贝) */
  evaluationStage?: EvaluationStage;
  /** 评分标准(取自 aiVisionResult.scoreCriteria 的冗余拷贝) */
  scoreCriteria?: ScoreCriteria[];
  /** 问题区域标注(取自 aiVisionResult.issueMarkers 的冗余拷贝) */
  issueMarkers?: IssueMarker[];
  /** 作品特征指纹(Task 6.3;Jimp 客观指标 + pHash 比对快照,供去同质化与历史对比) */
  featureFingerprint?: FeatureFingerprint;
  // ---- 2026-08-18 新增(顶层冗余,供 HistoryPage/详情页直接读取,无需穿透 aiVisionResult) ----
  /** 整体审美洞察卡片(报告级,仅阶段 2 深度分析填充) */
  aestheticInsight?: AestheticInsight;
  /** 非遗文化解读三层(仅 artType=heritage 且 阶段 2 填充) */
  heritageCulturalContext?: HeritageCulturalContext;
  /** 档位估算(Phase 2 批次④;AI 自主估算优先,缺省按档案 tierMapping 对综合分换算;前端诚实性徽章) */
  tierEstimate?: TierEstimate;
  // ---- Phase 3 批次④新增(落库持久化,前端消费) ----
  /** 反馈模式(predictFeedbackMode 产物;guidance 时前端反馈区尾部渲染"跨域启发"协同区块,
   *  并驱动标注参考注入的作品优先路由——见批次③ injectMarkerReferences) */
  feedbackMode?: FeedbackMode;
}

// ============ AI 视觉分析请求参数 ============

/**
 * AI 视觉分析请求参数
 */
export interface AIVisionRequest {
  /** 图片 URL(已上传 CDN)或本地文件路径 */
  imageSource: string;
  /** 作品类型 */
  artType: ArtType;
  /** Jimp 客观像素数据(注入 prompt 供 AI 校准参考) */
  jimpMetrics?: JimpMetricsForPrompt;
  /** 作品标题(可选,注入 prompt 上下文) */
  title?: string;
  /** 备注(可选,如教师布置的作业要求) */
  remark?: string;
  /** 诊断模式(默认 teaching;exam 时需配合 examSubject) */
  diagnosisMode?: DiagnosisMode;
  /** 艺考科目(仅 diagnosisMode='exam' 时注入 prompt) */
  examSubject?: ExamSubject;
  // ---- 深度分析增强字段(2026-08-17 阶段 A 新增;可选) ----
  /** 评价阶段(评分参照系档位;注入 prompt 切换评分对标参照系,缺省按 diagnosisMode 默认) */
  evaluationStage?: EvaluationStage;
  /** 非遗类目(仅 artType='heritage' 时有效:papercut=剪纸/embroidery=刺绣/porcelain=瓷器) */
  heritageCategory?: HeritageCategory;
  // ---- 2026-08-18 修复"深度分析总是失败"新增 ----
  /** 请求级超时覆盖(毫秒):
   *  - 阶段 1 分析(3s SLA):不传 → 用 cfg.aiApiTimeout(2500ms)
   *  - 阶段 2 AI 增强:传 cfg.aiEnhanceTimeout(15000ms)——深度 Prompt 更长,需 8-15s
   *  - 阶段 3 问题分析:传 cfg.aiQaTimeout(60000ms) */
  customTimeoutMs?: number;
  /** 请求级最大输出 tokens 覆盖:
   *  深度分析需返回 4维度+scoreCriteria+issueMarkers+美学原理层,
   *  2048 可能仍不够截断 → 默认 4096,阶段 1 不传保持 2048。 */
  customMaxTokens?: number;
  // ---- Phase 2 批次③ 反馈策略引擎新增(2026-09-06);可选,缺省=现状行为向后兼容 ----
  /** 反馈模式(注入层预判结果;由评分档案策略引擎推导,teaching/exam 两模式通用) */
  feedbackMode?: FeedbackMode;
  /** 标注预算(按反馈模式参数化;缺省走 DEEP_ANALYSIS_PROMPT_BLOCK 通用基线 3-8 个) */
  markerBudget?: MarkerBudget;
}

/**
 * 标注预算(Phase 2 批次③ 策略引擎)
 * 按 feedbackMode 参数化 issue_markers 数量与 critical 上限(spec §4.2):
 *   - diagnosis(诊断模式):min 6 / max 10 / criticalMax 10(critical 为主,不额外限)
 *   - guidance(引导模式):min 2 / max 4 / criticalMax 1(suggestion+highlight 为主,
 *     超量 critical 后处理降级为 suggestion,防高水平用户被过度纠错)
 */
export interface MarkerBudget {
  /** 最少标注数(prompt 指令层约束) */
  min: number;
  /** 最多标注数(后处理截断硬上限) */
  max: number;
  /** critical 类型上限(超出部分后处理降级为 suggestion) */
  criticalMax: number;
}

/**
 * 饱和度三级分布(低/中/高比例)
 */
export interface SaturationDistributionForPrompt {
  /** 低饱和比例(0-1) */
  low: number;
  /** 中饱和比例(0-1) */
  mid: number;
  /** 高饱和比例(0-1) */
  high: number;
}

/**
 * 最相似作品信息(pHash 比对结果)
 */
export interface MostSimilarWorkForPrompt {
  /** 作品名称 */
  title: string;
  /** 艺术家 */
  artist: string;
}

/**
 * Jimp 客观像素数据(注入 AI prompt 供校准参考)
 * 这些字段已由 analysis-engine.service.ts 计算得出
 *
 * Phase A 新增字段:构图/色彩/笔触/原创性高级指标,均为可选字段,缺失时有合理默认值
 */
export interface JimpMetricsForPrompt {
  /** 视觉重心坐标(0-1) */
  focusX: number;
  focusY: number;
  /** 留白比例(0-1) */
  whitespaceRatio: number;
  /** 暖色比例(0-1) */
  warmRatio: number;
  /** 冷色比例(0-1) */
  coolRatio: number;
  /** 主色调(中文名,如"鲜艳红色") */
  dominantColor: string;
  /** 平均亮度(0-255) */
  avgLuminance: number;
  /** 平均饱和度(0-100) */
  avgSaturation: number;
  /** 对比度等级 */
  contrast: 'high' | 'medium' | 'low';
  /** 纹理复杂度(0-1) */
  textureComplexity: number;
  /** 边缘密度(0-1) */
  edgeDensity: number;

  // ============ Phase A 新增字段(构图类) ============

  /** 黄金分割评分(0-100),Phase A 新增 */
  goldenRatioScore?: number;
  /** 三分法评分(0-100),Phase A 新增 */
  ruleOfThirdsScore?: number;
  /** 引导线方向(0-180度),Phase A 新增 */
  leadingLineDirection?: number;
  /** 引导线强度(0-1),Phase A 新增 */
  leadingLineStrength?: number;

  // ============ Phase A 新增字段(色彩类) ============

  /** 色彩和谐度评分(0-100),Phase A 新增 */
  harmonyScore?: number;
  /** 色彩和谐类型(如'complementary'互补/'analogous'邻近/'triadic'三色等),Phase A 新增 */
  harmonyType?: string;
  /** 饱和度三级分布(低/中/高比例),Phase A 新增 */
  saturationDistribution?: SaturationDistributionForPrompt;

  // ============ Phase A 新增字段(笔触/纹理/方向类) ============

  /** 方向一致性(0-1),笔触/排版/形体/线条方向的统一程度,Phase A 新增 */
  directionCoherence?: number;
  /** 笔触能量/张力(0-1),Phase A 新增 */
  strokeEnergy?: number;
  /** 主导方向(0-180度),Phase A 新增 */
  dominantDirection?: number;

  // ============ Phase A 新增字段(原创性类) ============

  /** pHash感知哈希相似度(0-1),Phase A 新增 */
  pHashSimilarity?: number;
  /** 最相似的名作信息(pHash比对结果),无可比作品时为 null,Phase A 新增 */
  mostSimilarWork?: MostSimilarWorkForPrompt | null;

  // ============ Phase 1B 新增字段(客观画面检测,2026-09-03) ============

  /** 客观画面检测聚合(画面灰/对比度/饱和度/构图重心,附判定结论);
   *  注入 prompt 作 OBJECTIVE_DATA 段,让 AI 的黑白灰判断从"目测"变"有据"。
   *  旧记录无此字段 → prompt 段优雅跳过 */
  objectiveChecks?: ObjectiveChecksData;
}

// ============ 默认值工厂 ============

/**
 * 构造 AI 失败时的默认元信息
 * 用于 fallback 路径,保证 HybridAnalysisResult 结构完整
 */
export function createFailureAIMeta(
  reason: AIFailureReason,
  durationMs: number,
  model: string,
): AIInvocationMeta {
  return {
    aiSuccess: false,
    aiDurationMs: durationMs,
    aiFailureReason: reason,
    aiModel: model,
    aiInvokedAt: new Date().toISOString(),
  };
}

/**
 * 构造 AI 禁用时的默认元信息
 * 用于 AI_ENABLED=false 场景
 */
export function createDisabledAIMeta(model: string): AIInvocationMeta {
  return {
    aiSuccess: false,
    aiDurationMs: 0,
    aiFailureReason: 'AI_DISABLED',
    aiModel: model,
    aiInvokedAt: new Date().toISOString(),
  };
}
