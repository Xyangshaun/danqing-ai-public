// ============================================================
// 模板降级建议库(离线建议)
// 对应文档:Phase B5 - 离线建议库实现
//
// @deprecated 2026-09-05 批次③:本库已下线(不再注入分析结果)——
//   阈值触发的模板建议对所有作品输出同样话术,违背 spec §5b"不做万能模板话术"与
//   去同质化硬约束;降级路径改为只展示客观检测(createFallbackAIVisionResult 返回空建议)。
//   文件与测试保留供规则参考/未来"客观指标触发的具体数值提示"再利用,勿新增调用。
//
// 职责(历史):
//   1. 当 AI 不可用/超时/返回格式错误时,基于 JimpMetricsForPrompt 客观指标
//      通过阈值规则触发离线模板建议
//   2. 为四类作品(painting/design/product/sculpture)分别提供维度对应的建议规则
//   3. 每条建议必须包含具体数值证据,禁止空泛反馈
//   4. 输出 ProfessionalSuggestion[] 数组,最多 5 条,按优先级排序
//
// 降级策略(批次③后):
//   - AI 成功 → 使用 AI 返回的专业建议(aiEnhanced=true)
//   - AI 失败 → 无建议,仅客观检测数据(aiEnhanced=false)
//
// 维度名映射(中文通用维度名):
//   painting  → 构图/色彩/笔触/原创性
//   design    → 视觉层次/排版/色彩/原创性
//   product   → 形态/材质/功能/原创性
//   sculpture → 空间/形体/材质/原创性
// ============================================================

import type { ArtType } from '../types/api-contract.js';
import type {
  AIVisionResult,
  JimpMetricsForPrompt,
  ProfessionalSuggestion,
  SuggestionLevel,
  SuggestionPriority,
} from '../types/ai-analysis.js';

// ============================================================
// 1. 模板建议规则接口
// ============================================================

/**
 * 模板建议规则
 * 每条规则定义一个触发条件 + 对应建议内容
 * 当 condition(metrics) 返回 true 时,该规则被触发
 */
export interface TemplateSuggestionRule {
  /** 规则唯一标识 */
  id: string;
  /** 维度名(中文通用维度名:构图/色彩/笔触/排版/形态/材质/空间/形体/原创性等) */
  dimension: string;
  /** 触发条件:基于 Jimp 指标判断是否需要该建议 */
  condition: (metrics: JimpMetricsForPrompt) => boolean;
  /** 生成证据文本:必须引用具体数值(如"留白比例58%,超过45%阈值") */
  evidence: (metrics: JimpMetricsForPrompt) => string;
  /** 具体操作建议:可为固定字符串或根据指标动态生成 */
  operation: string | ((metrics: JimpMetricsForPrompt) => string);
  /** 参考案例(美术史/设计史/产品设计经典/雕塑名作) */
  reference: string;
  /** 练习路径 */
  practice: string;
  /** 优先级:high=必改基础问题/medium=提升建议/low=亮点或探讨 */
  priority: 'high' | 'medium' | 'low';
}

// ============================================================
// 2. 工具函数
// ============================================================

/**
 * 优先级 → SuggestionLevel 映射
 * high(必改问题) → poor(差,需重点改进)
 * medium(提升建议) → average(中,有提升空间)
 * low(亮点/探讨) → good(良,已较好可优化)
 */
function priorityToLevel(priority: SuggestionPriority): SuggestionLevel {
  switch (priority) {
    case 'high':
      return 'poor';
    case 'medium':
      return 'average';
    case 'low':
      return 'good';
  }
}

/**
 * 安全获取 operation(支持字符串或函数)
 */
function resolveOperation(
  op: string | ((metrics: JimpMetricsForPrompt) => string),
  metrics: JimpMetricsForPrompt,
): string {
  return typeof op === 'function' ? op(metrics) : op;
}

/**
 * 格式化百分比(0-1 → xx.x%)
 */
function pct(val: number, digits = 0): string {
  return `${(val * 100).toFixed(digits)}%`;
}

// ============================================================
// 3. 绘画类(painting)规则集
//    维度:构图/色彩/笔触/原创性
// ============================================================

const PAINTING_RULES: TemplateSuggestionRule[] = [
  // ---------- 构图类 ----------
  {
    id: 'painting-comp-whitespace-high',
    dimension: '构图',
    priority: 'high',
    condition: (m) => m.whitespaceRatio > 0.45,
    evidence: (m) => `留白比例${pct(m.whitespaceRatio, 1)},超过45%阈值,画面空旷缺乏实体支撑`,
    operation: (m) =>
      `将留白比例从${pct(m.whitespaceRatio, 1)}压缩至25%-35%区间,通过增加前景/中景层次填充画面`,
    reference: '范宽《溪山行旅图》——以山为主体、留白仅占顶端1/5',
    practice: '练习"计白当黑"法则,对同一静物做满构图变体速写3幅,留白控制在30%以内',
  },
  {
    id: 'painting-comp-whitespace-low',
    dimension: '构图',
    priority: 'medium',
    condition: (m) => m.whitespaceRatio < 0.20,
    evidence: (m) => `留白比例仅${pct(m.whitespaceRatio, 1)},不足20%,画面堵塞缺少呼吸空间`,
    operation: (m) =>
      `将留白比例从${pct(m.whitespaceRatio, 1)}增加至25%-35%,通过拉开主次关系、增加虚实层次释放空间`,
    reference: '马远《寒江独钓图》——大面积留白烘托孤寂意境',
    practice: '临摹马远"一角式"构图,体会留白与实体的虚实对比',
  },
  {
    id: 'painting-comp-focus-offset-right',
    dimension: '构图',
    priority: 'high',
    condition: (m) => m.focusX > 0.7,
    evidence: (m) => `视觉重心位于(${m.focusX.toFixed(2)}, ${m.focusY.toFixed(2)}),X偏移量过大,重心偏右`,
    operation: (m) =>
      `将主体重心从X=${m.focusX.toFixed(2)}向左移至0.55-0.65区间,接近黄金分割点0.618`,
    reference: '达·芬奇《蒙娜丽莎》——主体位于画面偏右黄金分割位',
    practice: '用九宫格辅助线做构图练习,主体置于右/左三分线交点上',
  },
  {
    id: 'painting-comp-focus-offset-left',
    dimension: '构图',
    priority: 'high',
    condition: (m) => m.focusX < 0.3,
    evidence: (m) => `视觉重心位于(${m.focusX.toFixed(2)}, ${m.focusY.toFixed(2)}),X偏移量过大,重心偏左`,
    operation: (m) =>
      `将主体重心从X=${m.focusX.toFixed(2)}向右移至0.35-0.45区间,平衡左右视觉重量`,
    reference: '德拉克洛瓦《自由引导人民》——主体偏左但右侧旗帜延展平衡画面',
    practice: '做4幅同一静物的构图变体,分别将主体置于左/中/右/黄金分割位,体会视觉重量分布',
  },
  {
    id: 'painting-comp-golden-ratio-low',
    dimension: '构图',
    priority: 'medium',
    condition: (m) => (m.goldenRatioScore ?? 65) < 50,
    evidence: (m) => `黄金分割评分仅${Math.round(m.goldenRatioScore ?? 0)}分,低于50分阈值,主体位置偏离经典构图法则`,
    operation: () => '调整主体位置至黄金分割点(0.618, 0.618)附近,或使用三分法将主体置于交叉点',
    reference: '米勒《拾穗者》——人物群像精准落在黄金分割网格上',
    practice: '使用黄金分割螺旋线临摹3幅经典油画,标注关键元素位置',
  },
  {
    id: 'painting-comp-leading-line-weak',
    dimension: '构图',
    priority: 'medium',
    condition: (m) => (m.leadingLineStrength ?? 0.5) < 0.2,
    evidence: (m) => `引导线强度仅${(m.leadingLineStrength ?? 0).toFixed(2)},低于0.2阈值,画面缺乏视觉引导路径`,
    operation: () => '增加透视线、边缘线或物体排列方向作为引导线,将视线引向画面主体',
    reference: '霍贝玛《米德尔哈尼斯的林荫道》——强烈透视引导线直向画面深处',
    practice: '做5幅一点透视/两点透视风景速写,强化引导线训练',
  },

  // ---------- 色彩类 ----------
  {
    id: 'painting-color-warm-excessive',
    dimension: '色彩',
    priority: 'high',
    condition: (m) => m.warmRatio > 0.70,
    evidence: (m) => `暖色占比${pct(m.warmRatio)},超过70%阈值,画面缺乏冷色平衡,易产生燥热感`,
    operation: (m) =>
      `将暖色比例从${pct(m.warmRatio)}降至55%-65%,在暗部/阴影/远处增加冷色(蓝灰/紫灰)形成冷暖对比`,
    reference: '莫奈《印象·日出》——暖色日光与冷色水面雾气形成微妙冷暖平衡',
    practice: '对一幅全暖调作品做冷色变体练习,在阴影和反光处加入冷色',
  },
  {
    id: 'painting-color-cool-excessive',
    dimension: '色彩',
    priority: 'high',
    condition: (m) => m.coolRatio > 0.70,
    evidence: (m) => `冷色占比${pct(m.coolRatio)},超过70%阈值,画面缺乏暖色点缀,易显灰暗阴冷`,
    operation: (m) =>
      `将冷色比例从${pct(m.coolRatio)}降至55%-65%,在受光面/高光/主体处加入暖色(橙黄/红棕)点睛`,
    reference: '梵高《星月夜》——大面积蓝紫冷调中,暖黄色星月与柏树形成强对比',
    practice: '对一幅全冷调作品做暖色变体练习,在光源和重点处加入暖色对比',
  },
  {
    id: 'painting-color-saturation-too-high',
    dimension: '色彩',
    priority: 'medium',
    condition: (m) => m.avgSaturation > 75,
    evidence: (m) => `平均饱和度${m.avgSaturation.toFixed(0)}/100,超过75阈值,色彩过于鲜艳缺乏层次`,
    operation: () => '降低整体饱和度至40-60区间,加入灰调/中性色丰富色彩层次,使用"降纯"手法',
    reference: '莫兰迪静物系列——低饱和度灰调色彩形成雅致和谐',
    practice: '用24色油画棒做高饱和→低饱和渐变练习,学习灰调混合',
  },
  {
    id: 'painting-color-saturation-too-low',
    dimension: '色彩',
    priority: 'medium',
    condition: (m) => m.avgSaturation < 20,
    evidence: (m) => `平均饱和度仅${m.avgSaturation.toFixed(0)}/100,低于20,画面灰闷缺乏色彩张力`,
    operation: () => '在主体/受光面/视觉焦点处提高饱和度至50-70,形成"灰中见纯"的色彩节奏',
    reference: '柯罗《孟特芳丹的回忆》——整体灰调中人物红衣形成高饱和焦点',
    practice: '在灰调底色上做3处高饱和点练习,训练色彩焦点布置',
  },
  {
    id: 'painting-color-harmony-low',
    dimension: '色彩',
    priority: 'high',
    condition: (m) => (m.harmonyScore ?? 65) < 50,
    evidence: (m) => `色彩和谐度评分${Math.round(m.harmonyScore ?? 0)}分,低于50分阈值,配色缺乏统一调性`,
    operation: () => '确定一个主色调占画面60%以上,使用邻近色/互补色搭配方案,避免多色等比出现',
    reference: '维米尔《戴珍珠耳环的少女》——蓝黄互补配色,色调高度统一',
    practice: '做6种配色方案练习(单色/邻近/互补/三角色/分裂互补/四色),每种画小色稿',
  },
  {
    id: 'painting-color-saturation-imbalance',
    dimension: '色彩',
    priority: 'low',
    condition: (m) => {
      const d = m.saturationDistribution;
      if (!d) return false;
      return d.low > 0.70 || d.mid > 0.70 || d.high > 0.70;
    },
    evidence: (m) => {
      const d = m.saturationDistribution!;
      const dominant = d.low > 0.7 ? '低饱和' : d.high > 0.7 ? '高饱和' : '中饱和';
      const val = d.low > 0.7 ? d.low : d.high > 0.7 ? d.high : d.mid;
      return `饱和度分布不均,${dominant}区域占比${pct(val)},超过70%,缺少层次变化`;
    },
    operation: () => '调整饱和度分布为"低40%/中35%/高25%"的金字塔结构,高饱和集中在视觉焦点',
    reference: '塞尚《圣维克多山》——饱和度从前到后递减,形成空间纵深',
    practice: '做色彩饱和度层次练习:前景高饱和→中景中饱和→远景低饱和',
  },

  // ---------- 笔触类 ----------
  {
    id: 'painting-brush-direction-incoherent',
    dimension: '笔触',
    priority: 'high',
    condition: (m) => (m.directionCoherence ?? 0.5) < 0.30,
    evidence: (m) => `方向一致性仅${(m.directionCoherence ?? 0).toFixed(2)},低于0.30阈值,笔触方向杂乱无章`,
    operation: () => '统一主笔触方向(建议跟随物体形体走向),局部可变化但主方向需占60%以上',
    reference: '塞尚《静物》——笔触方向跟随苹果/桌布形体走向,高度统一',
    practice: '用单一方向笔触完成一幅静物素描,体会笔触与形体的关系',
  },
  {
    id: 'painting-brush-energy-low',
    dimension: '笔触',
    priority: 'medium',
    condition: (m) => (m.strokeEnergy ?? 0.5) < 0.20,
    evidence: (m) => `笔触能量仅${(m.strokeEnergy ?? 0).toFixed(2)},低于0.20阈值,笔触缺乏力度对比与张力`,
    operation: () => '增加笔触轻重/快慢/粗细对比:主体处笔触明确有力,背景处松动虚化,形成节奏',
    reference: '伦勃朗自画像——厚堆笔触表现面部高光,薄涂处理暗部背景',
    practice: '做笔触张力练习:同一物体用3种力度(轻/中/重)各画一遍,体会力度变化',
  },
  {
    id: 'painting-brush-texture-too-simple',
    dimension: '笔触',
    priority: 'low',
    condition: (m) => m.textureComplexity < 0.20,
    evidence: (m) => `纹理复杂度仅${m.textureComplexity.toFixed(2)},低于0.20,肌理表现过于单一`,
    operation: () => '丰富笔触肌理:通过干扫/厚堆/点彩/刮擦等多种技法增加画面质感层次',
    reference: '弗洛伊德肖像画——厚重肌理堆叠出皮肤/衣物的真实质感',
    practice: '做肌理练习:用画刀/笔杆/布团等工具在同一画面制造5种以上肌理',
  },

  // ---------- 原创性类 ----------
  {
    id: 'painting-orig-similarity-high',
    dimension: '原创性',
    priority: 'high',
    condition: (m) => m.pHashSimilarity !== undefined && m.pHashSimilarity > 0.5,
    evidence: (m) => {
      const simPct = pct(m.pHashSimilarity ?? 0);
      const similarWork = m.mostSimilarWork
        ? `,与${m.mostSimilarWork.artist}《${m.mostSimilarWork.title}》相似度较高`
        : '';
      return `pHash感知哈希相似度${simPct},超过50%阈值${similarWork},原创性不足`;
    },
    operation: () => '在构图/色彩/表现手法上至少改变2处关键元素,融入个人视角和表现语言,避免直接临摹',
    reference: '毕加索《亚维农少女》——借鉴非洲雕塑但彻底转化为立体主义语言',
    practice: '选一幅名作,用3种不同风格(表现主义/立体主义/极简)做变体创作',
  },
  {
    id: 'painting-orig-variation-low',
    dimension: '原创性',
    priority: 'medium',
    condition: (m) => m.edgeDensity < 0.05 && m.textureComplexity < 0.25,
    evidence: (m) => `边缘密度${m.edgeDensity.toFixed(2)}、纹理复杂度${m.textureComplexity.toFixed(2)}均偏低,画面变化不足`,
    operation: () => '增加画面中的形状对比、质感变化和线条节奏,避免大面积均一处理',
    reference: '波洛克《秋韵》——密集滴洒形成丰富的视觉层次和变化',
    practice: '做"一幅画面5种质感"练习,训练丰富变化能力',
  },
];

// ============================================================
// 4. 设计类(design)规则集
//    维度:视觉层次/排版/色彩/原创性
// ============================================================

const DESIGN_RULES: TemplateSuggestionRule[] = [
  // ---------- 视觉层次/排版类 ----------
  {
    id: 'design-hierarchy-whitespace-high',
    dimension: '视觉层次',
    priority: 'high',
    condition: (m) => m.whitespaceRatio > 0.45,
    evidence: (m) => `留白比例${pct(m.whitespaceRatio, 1)},超过45%阈值,信息密度过低,视觉元素过于稀疏`,
    operation: (m) =>
      `将留白比例从${pct(m.whitespaceRatio, 1)}压缩至25%-35%,适当增大核心视觉元素占比,建立明确信息层级`,
    reference: '瑞士国际主义风格海报——网格系统内的精准留白,信息密度与呼吸感平衡',
    practice: '对一个信息稀疏的版面做3版密度递增的重排,体会留白与信息密度的关系',
  },
  {
    id: 'design-hierarchy-whitespace-low',
    dimension: '视觉层次',
    priority: 'high',
    condition: (m) => m.whitespaceRatio < 0.20,
    evidence: (m) => `留白比例仅${pct(m.whitespaceRatio, 1)},不足20%,版面拥挤,信息层级不清晰`,
    operation: (m) =>
      `将留白比例从${pct(m.whitespaceRatio, 1)}增加至30%-45%,拉开标题/正文/辅助信息的间距`,
    reference: '无印良品海报设计——极致留白传递"空"的品牌哲学',
    practice: '使用8点网格系统做排版练习,严格遵循元素间距规范',
  },
  {
    id: 'design-hierarchy-focus-offset',
    dimension: '视觉层次',
    priority: 'high',
    condition: (m) => m.focusX > 0.7 || m.focusX < 0.3,
    evidence: (m) => `视觉重心位于(${m.focusX.toFixed(2)}, ${m.focusY.toFixed(2)}),偏离中心,信息焦点失衡`,
    operation: (m) => {
      const dir = m.focusX > 0.7 ? '左' : '右';
      return `将核心信息焦点从X=${m.focusX.toFixed(2)}向${dir}调整至0.4-0.6区间,或用对称/不对称布局明确视觉引导`;
    },
    reference: 'Josef Muller-Brockmann 音乐会海报——严格网格下的重心精准控制',
    practice: '做对称/不对称/黄金分割3种版式方案,标注视觉重心位置',
  },
  {
    id: 'design-hierarchy-golden-ratio-low',
    dimension: '视觉层次',
    priority: 'medium',
    condition: (m) => (m.goldenRatioScore ?? 65) < 50,
    evidence: (m) => `黄金分割评分${Math.round(m.goldenRatioScore ?? 0)}分,低于50分,主要元素位置缺乏经典比例支撑`,
    operation: () => '使用黄金分割网格(1:1.618)布置标题/图片/正文区,关键元素落在黄金分割线交点',
    reference: 'Apple 产品页面设计——严格遵循黄金比例的视觉层级',
    practice: '用黄金矩形分割法重新设计一个版面,标注比例关系',
  },
  {
    id: 'design-hierarchy-leading-line-weak',
    dimension: '排版',
    priority: 'medium',
    condition: (m) => (m.leadingLineStrength ?? 0.5) < 0.2,
    evidence: (m) => `引导线强度仅${(m.leadingLineStrength ?? 0).toFixed(2)},低于0.2,视觉流动路径不明确`,
    operation: () => '通过对齐线、文字排列方向、图片裁剪边等建立明确的视觉流向,引导用户按Z型/F型路径阅读',
    reference: '报刊杂志排版——标题→副标题→正文→配图的明确阅读流线',
    practice: '设计一个信息海报,用箭头/线条/对齐标注视觉阅读路径',
  },

  // ---------- 色彩类 ----------
  {
    id: 'design-color-warm-excessive',
    dimension: '色彩',
    priority: 'medium',
    condition: (m) => m.warmRatio > 0.70,
    evidence: (m) => `暖色占比${pct(m.warmRatio)},超过70%,配色缺乏冷色平衡,视觉疲劳风险高`,
    operation: (m) =>
      `将暖色比例从${pct(m.warmRatio)}调整至50%-60%,增加冷色作为辅助色/点缀色,遵循60-30-10配色法则`,
    reference: 'Spotify品牌色——大面积绿色(冷色)中暖色点缀形成活力感',
    practice: '用60-30-10法则为一个暖调品牌做冷色平衡配色方案',
  },
  {
    id: 'design-color-cool-excessive',
    dimension: '色彩',
    priority: 'medium',
    condition: (m) => m.coolRatio > 0.70,
    evidence: (m) => `冷色占比${pct(m.coolRatio)},超过70%,画面缺乏暖色CTA按钮/重点色引导行动`,
    operation: (m) =>
      `将冷色比例从${pct(m.coolRatio)}调整至50%-60%,在CTA按钮/重要信息处使用暖色(橙/红)形成行动引导`,
    reference: '微信读书——大面积蓝白冷调中,橙色按钮引导核心操作',
    practice: '为一个冷调界面设计暖色CTA方案,A/B测试点击率差异',
  },
  {
    id: 'design-color-harmony-low',
    dimension: '色彩',
    priority: 'high',
    condition: (m) => (m.harmonyScore ?? 65) < 50,
    evidence: (m) => `色彩和谐度评分${Math.round(m.harmonyScore ?? 0)}分,低于50分,配色缺乏系统性`,
    operation: () => '建立品牌色板:主色1个+辅色2个+中性色4-5个,所有设计元素从色板中取色',
    reference: 'Google Material Design——系统化色彩体系,主色/辅色/语义色定义清晰',
    practice: '为一个虚拟品牌构建完整色板(主/辅/中/语义色),制作色卡规范',
  },
  {
    id: 'design-color-saturation-imbalance',
    dimension: '色彩',
    priority: 'low',
    condition: (m) => m.avgSaturation > 75 || m.avgSaturation < 20,
    evidence: (m) =>
      m.avgSaturation > 75
        ? `平均饱和度${m.avgSaturation.toFixed(0)}/100过高,色彩刺眼缺乏专业感`
        : `平均饱和度${m.avgSaturation.toFixed(0)}/100过低,色彩单调缺乏品牌识别度`,
    operation: (m) =>
      m.avgSaturation > 75
        ? '降低整体饱和度至40-60区间,高饱和色仅用于小面积重点强调'
        : '提高品牌主色饱和度至60-80形成识别焦点,辅助色保持中低饱和',
    reference: 'Airbnb 品牌色——Rausch 红饱和度适中,既醒目又不刺眼',
    practice: '做同一设计的3个饱和度版本(高/中/低),评估品牌感与可读性',
  },

  // ---------- 排版方向类 ----------
  {
    id: 'design-typography-direction-incoherent',
    dimension: '排版',
    priority: 'medium',
    condition: (m) => (m.directionCoherence ?? 0.5) < 0.30,
    evidence: (m) => `方向一致性${(m.directionCoherence ?? 0).toFixed(2)},低于0.30,文字/元素排列方向混乱`,
    operation: () => '统一文字对齐方向(建议左对齐为主),建立水平/垂直方向的网格对齐基线',
    reference: 'Helvetica 字体海报——严格水平对齐的瑞士风格排版',
    practice: '用基线网格做一页多文字排版,所有元素对齐网格线',
  },

  // ---------- 原创性类 ----------
  {
    id: 'design-orig-similarity-high',
    dimension: '原创性',
    priority: 'high',
    condition: (m) => m.pHashSimilarity !== undefined && m.pHashSimilarity > 0.5,
    evidence: (m) => {
      const simPct = pct(m.pHashSimilarity ?? 0);
      const similarWork = m.mostSimilarWork
        ? `,与${m.mostSimilarWork.artist}《${m.mostSimilarWork.title}》相似度较高`
        : '';
      return `pHash相似度${simPct},超过50%阈值${similarWork},设计原创性不足`;
    },
    operation: () => '在保持功能逻辑前提下,尝试改变构图方式/图形语言/色彩策略至少2处,避免模板化',
    reference: '佐藤可士和设计——强视觉符号化语言,高度原创且辨识度极高',
    practice: '选一个常见设计模板,做"反模板"重构练习,改变布局和视觉语言',
  },
];

// ============================================================
// 5. 产品设计类(product)规则集
//    维度:形态/材质/功能/原创性
// ============================================================

const PRODUCT_RULES: TemplateSuggestionRule[] = [
  // ---------- 形态类 ----------
  {
    id: 'product-form-whitespace-high',
    dimension: '形态',
    priority: 'medium',
    condition: (m) => m.whitespaceRatio > 0.45,
    evidence: (m) => `空间占比中空/虚区域${pct(m.whitespaceRatio, 1)},超过45%,产品形态存在感不足,视觉体量偏弱`,
    operation: (m) =>
      `将实体占比从${pct(1 - m.whitespaceRatio, 1)}提升至60%-75%,增加形体饱满度或调整拍摄角度展现立体感`,
    reference: 'Braun T3 收音机——Dieter Rams 设计,紧凑形态中见精密比例',
    practice: '用陶泥做5个体量递增的产品草模,体会实体空间比例变化',
  },
  {
    id: 'product-form-focus-offset',
    dimension: '形态',
    priority: 'high',
    condition: (m) => m.focusX > 0.7 || m.focusX < 0.3,
    evidence: (m) => `视觉重心位于(${m.focusX.toFixed(2)}, ${m.focusY.toFixed(2)}),X轴偏移过大,形态重心不稳`,
    operation: (m) => {
      const dir = m.focusX > 0.7 ? '左' : '右';
      return `调整形体主要特征线/操作面从X=${m.focusX.toFixed(2)}向${dir}回移至0.4-0.6,建立对称或平衡的视觉稳定感`;
    },
    reference: 'iPod Classic——环形操作键居中对称,形态高度均衡',
    practice: '绘制产品三视图,标注重心线,调整形态使重心位于几何中心附近',
  },
  {
    id: 'product-form-golden-ratio-low',
    dimension: '形态',
    priority: 'medium',
    condition: (m) => (m.goldenRatioScore ?? 65) < 50,
    evidence: (m) => `黄金分割评分${Math.round(m.goldenRatioScore ?? 0)}分,低于50分,形态比例缺乏经典美学支撑`,
    operation: () => '运用黄金比例(1:1.618)调整长宽比和分割线位置,按键/接口/分模线落在黄金分割点上',
    reference: 'iPhone 4——前后玻璃与中框的比例精确遵循黄金分割',
    practice: '用黄金矩形绘制3个产品轮廓方案,对比比例美感',
  },
  {
    id: 'product-form-leading-line-weak',
    dimension: '形态',
    priority: 'low',
    condition: (m) => (m.leadingLineStrength ?? 0.5) < 0.2,
    evidence: (m) => `线条引导强度${(m.leadingLineStrength ?? 0).toFixed(2)},低于0.2,产品轮廓线缺乏流畅感与方向感`,
    operation: () => '强化产品特征线条,使用连续曲面(C2连续)过渡,让轮廓线自然引导视线至操作区域',
    reference: '保时捷911轮廓线——从车头到车尾的流畅腰线贯穿全车',
    practice: '用贝塞尔曲线绘制产品侧视图,确保曲线G2连续无折角',
  },

  // ---------- 材质类 ----------
  {
    id: 'product-mat-texture-too-simple',
    dimension: '材质',
    priority: 'medium',
    condition: (m) => m.textureComplexity < 0.20,
    evidence: (m) => `材质纹理复杂度${m.textureComplexity.toFixed(2)},低于0.20,表面处理过于单调缺乏质感层次`,
    operation: () => '增加材质对比:高光面+磨砂面/金属+塑料/皮革+木材等双材质搭配,提升触感层次',
    reference: 'Leica M 相机——黄铜顶盖+硫化皮饰+光学玻璃,材质对比丰富经典',
    practice: '制作材质情绪板(mood board),收集10种以上材质搭配组合',
  },
  {
    id: 'product-mat-texture-too-complex',
    dimension: '材质',
    priority: 'low',
    condition: (m) => m.textureComplexity > 0.80,
    evidence: (m) => `材质纹理复杂度${m.textureComplexity.toFixed(2)},超过0.80,表面纹理过于繁复干扰产品形态阅读`,
    operation: () => '简化表面纹理,将复杂肌理控制在局部细节(握持区/按键区),大面积保持简洁',
    reference: 'MUJI 产品——表面处理极简,材质本质感为主,纹理控制在极低范围',
    practice: '对一个纹理复杂的方案做减法练习,去除3处非必要肌理',
  },
  {
    id: 'product-mat-edge-too-dense',
    dimension: '材质',
    priority: 'medium',
    condition: (m) => m.edgeDensity > 0.20,
    evidence: (m) => `边缘密度${m.edgeDensity.toFixed(2)},超过0.20,分模线/细节过多导致视觉杂乱`,
    operation: () => '减少表面分割线和细节元素,将按键/接口整合到最少的视觉面,追求"少即是多"',
    reference: 'Dieter Rams Braun SK61唱机——极简面板,功能分区清晰无多余线条',
    practice: '做产品细节减法练习:每去掉一个元素验证功能完整性,直到无法再减',
  },

  // ---------- 功能/形态类 ----------
  {
    id: 'product-func-direction-incoherent',
    dimension: '形态',
    priority: 'medium',
    condition: (m) => (m.directionCoherence ?? 0.5) < 0.30,
    evidence: (m) => `方向一致性${(m.directionCoherence ?? 0).toFixed(2)},低于0.30,形态线条方向不统一,功能暗示混乱`,
    operation: () => '统一形态语言:圆弧圆角半径一致,斜面方向遵循统一规则,操作区方向与使用姿势匹配',
    reference: 'B&O Beoplay A9音箱——圆形形态语言高度统一,所有元素服从圆形母题',
    practice: '为一个产品定义3条形态设计法则(如"全部圆角R8""斜面统一45°"),严格执行',
  },

  // ---------- 原创性类 ----------
  {
    id: 'product-orig-similarity-high',
    dimension: '原创性',
    priority: 'high',
    condition: (m) => m.pHashSimilarity !== undefined && m.pHashSimilarity > 0.5,
    evidence: (m) => {
      const simPct = pct(m.pHashSimilarity ?? 0);
      const similarWork = m.mostSimilarWork
        ? `,与${m.mostSimilarWork.artist}《${m.mostSimilarWork.title}》形态相似度较高`
        : '';
      return `pHash形态相似度${simPct},超过50%阈值${similarWork},产品形态辨识度不足`;
    },
    operation: () => '从使用场景/用户行为出发重新定义形态语义,避免追随市场同类产品外观,尝试跨界借鉴',
    reference: '斯塔克柠檬榨汁器——完全跳脱传统榨汁器形态,雕塑感与功能性兼具',
    practice: '用随机词联想法(如产品+自然生物)做5个跨界形态发想方案',
  },
];

// ============================================================
// 6. 雕塑类(sculpture)规则集
//    维度:空间/形体/材质/原创性
// ============================================================

const SCULPTURE_RULES: TemplateSuggestionRule[] = [
  // ---------- 空间构成类 ----------
  {
    id: 'sculpture-space-whitespace-high',
    dimension: '空间',
    priority: 'high',
    condition: (m) => m.whitespaceRatio > 0.50,
    evidence: (m) => `空间(虚空)占比${pct(m.whitespaceRatio, 1)},超过50%阈值,实体体积感不足,空间占有偏弱`,
    operation: (m) =>
      `将实体占比从${pct(1 - m.whitespaceRatio, 1)}提升至55%-70%,增加体块厚度或扩展基座,增强空间占有`,
    reference: '罗丹《思想者》——紧实团块体积感强烈,实体占据空间的力量感十足',
    practice: '做泥塑加法练习:从一个核心体块开始,逐步添加形体感受体积生长',
  },
  {
    id: 'sculpture-space-whitespace-low',
    dimension: '空间',
    priority: 'medium',
    condition: (m) => m.whitespaceRatio < 0.15,
    evidence: (m) => `空间(虚空)占比仅${pct(m.whitespaceRatio, 1)},不足15%,虚实关系失衡,缺少通透感`,
    operation: (m) =>
      `将虚空占比从${pct(m.whitespaceRatio, 1)}增加至25%-40%,通过镂空/穿孔/悬挑等手法增加虚实对比`,
    reference: '亨利·摩尔《斜倚的人形》——实体中穿凿孔洞,虚实相生形成空间韵律',
    practice: '在石膏方块上做减法雕刻,挖去30%体积形成虚实关系,保留结构稳定性',
  },
  {
    id: 'sculpture-space-focus-offset',
    dimension: '空间',
    priority: 'high',
    condition: (m) => m.focusX > 0.7 || m.focusX < 0.3 || m.focusY > 0.7 || m.focusY < 0.3,
    evidence: (m) => `视觉重心位于(${m.focusX.toFixed(2)}, ${m.focusY.toFixed(2)}),偏离中心区域,空间构图失衡`,
    operation: (m) => {
      const xDir = m.focusX > 0.7 ? '左' : m.focusX < 0.3 ? '右' : '';
      const yDir = m.focusY > 0.7 ? '下' : m.focusY < 0.3 ? '上' : '';
      const dir = [xDir, yDir].filter(Boolean).join('/');
      return `调整形体主要朝向/突出部位向${dir || '中心'}回移,使重心回到画面0.35-0.65核心区域,建立空间均衡`;
    },
    reference: '米开朗基罗《大卫》——重心微偏但整体均衡, contrapposto(对立式平衡)经典范式',
    practice: '做contrapposto对立式平衡站姿雕塑速写8个,体会重心偏移与均衡',
  },
  {
    id: 'sculpture-space-golden-ratio-low',
    dimension: '空间',
    priority: 'medium',
    condition: (m) => (m.goldenRatioScore ?? 65) < 50,
    evidence: (m) => `黄金分割评分${Math.round(m.goldenRatioScore ?? 0)}分,低于50分,空间比例缺乏经典法则支撑`,
    operation: () => '按照黄金分割比例布置雕塑实体与虚空的关系,主要突出部位落在黄金分割点上',
    reference: '波利克里托斯《持矛者》——头身比1:7,各部位比例精确遵循黄金法则',
    practice: '用黄金比例标尺测量3件经典雕塑作品,标注关键比例点',
  },
  {
    id: 'sculpture-space-leading-line-weak',
    dimension: '空间',
    priority: 'low',
    condition: (m) => (m.leadingLineStrength ?? 0.5) < 0.2,
    evidence: (m) => `动态线强度${(m.leadingLineStrength ?? 0).toFixed(2)},低于0.2,形体缺乏运动趋势和方向性`,
    operation: () => '强化S形曲线或螺旋线作为主要动态线,让形体从基座到顶端有明确的方向延展',
    reference: '贝尼尼《阿波罗与达芙妮》——强烈的上升S形动态线贯穿整组雕塑',
    practice: '用铁丝制作3个动态线骨架(直线/S形/螺旋形),在此基础上添加泥塑体量',
  },

  // ---------- 形体语言类 ----------
  {
    id: 'sculpture-body-direction-incoherent',
    dimension: '形体',
    priority: 'medium',
    condition: (m) => (m.directionCoherence ?? 0.5) < 0.30,
    evidence: (m) => `方向一致性${(m.directionCoherence ?? 0).toFixed(2)},低于0.30,形体各部分朝向不统一,动态关系紊乱`,
    operation: () => '建立形体主轴,让头/胸/髋三大体块沿主轴扭转(三向扭转法),局部服从整体动势',
    reference: '罗丹《吻》——两个形体交织的S形主轴高度统一,动势流畅',
    practice: '做"三个体块扭转"练习:头/胸/髋沿垂直轴各偏转不同角度,感受张力',
  },
  {
    id: 'sculpture-body-energy-low',
    dimension: '形体',
    priority: 'medium',
    condition: (m) => (m.strokeEnergy ?? 0.5) < 0.20,
    evidence: (m) => `形体张力/能量值${(m.strokeEnergy ?? 0).toFixed(2)},低于0.20,形体过于静态缺乏张力与内在力量`,
    operation: () => '通过肌肉拉伸暗示/重心偏移/动态平衡等手法增加形体势能,让雕塑即使静止也蕴含运动趋势',
    reference: '贾科梅蒂《行走的人》——极度拉长的形体蕴含前行的张力与孤独感',
    practice: '做3个同一动态但不同张力等级(松弛/中等/紧绷)的快速雕塑小稿',
  },

  // ---------- 材质类 ----------
  {
    id: 'sculpture-mat-texture-too-simple',
    dimension: '材质',
    priority: 'low',
    condition: (m) => m.textureComplexity < 0.20,
    evidence: (m) => `材质肌理复杂度${m.textureComplexity.toFixed(2)},低于0.20,表面处理过于光滑缺乏材料语言表现力`,
    operation: () => '探索材料本身特性:铸铜的氧化绿锈/石雕的凿痕/木雕的木纹/焊接的接缝,保留材料痕迹',
    reference: '布朗库西《波嘉尼小姐》——青铜抛光与底座粗石形成材质对比,高度提炼',
    practice: '用3种不同材料(黏土/石膏/铁丝)做同一形态,体会材料语言差异',
  },
  {
    id: 'sculpture-mat-edge-too-few',
    dimension: '材质',
    priority: 'medium',
    condition: (m) => m.edgeDensity < 0.03,
    evidence: (m) => `边缘/细节密度${m.edgeDensity.toFixed(2)},低于0.03,形体转折过于圆滑缺乏结构线和细节刻画`,
    operation: () => '强化形体骨骼结构点:肩/肘/膝/踝等骨点处塑造更明确的转折和细节,增强形体可信度',
    reference: '多纳泰罗《大卫》——肌肉与骨骼的精准刻画,边缘细节丰富生动',
    practice: '做人体局部(手/脚/面部)解剖雕塑练习,重点刻画骨骼与肌肉交接处',
  },

  // ---------- 原创性类 ----------
  {
    id: 'sculpture-orig-similarity-high',
    dimension: '原创性',
    priority: 'high',
    condition: (m) => m.pHashSimilarity !== undefined && m.pHashSimilarity > 0.5,
    evidence: (m) => {
      const simPct = pct(m.pHashSimilarity ?? 0);
      const similarWork = m.mostSimilarWork
        ? `,与${m.mostSimilarWork.artist}《${m.mostSimilarWork.title}》造型相似度较高`
        : '';
      return `pHash造型相似度${simPct},超过50%阈值${similarWork},形体语言缺乏个人面貌`;
    },
    operation: () => '尝试新的材料组合/空间处理方式/非传统基座/动态平衡等,突破传统雕塑范式',
    reference: '考尔德动态雕塑——完全抛弃传统静态基座,用空气动力学创造运动雕塑',
    practice: '用日常非雕塑材料(纸板/铁丝/废品)做一个装置雕塑,探索材料可能性',
  },
];

// ============================================================
// 7. 规则注册表(按 ArtType 索引)
// ============================================================

const RULES_BY_ART_TYPE: Readonly<Record<ArtType, readonly TemplateSuggestionRule[]>> = {
  painting: PAINTING_RULES,
  design: DESIGN_RULES,
  product: PRODUCT_RULES,
  sculpture: SCULPTURE_RULES,
  // TODO[阶段B Task 18]: 补充非遗类目规则(剪纸刀工/刺绣针法/瓷器釉色)
  heritage: [],
};

// ============================================================
// 8. 通用鼓励性建议(无规则触发时返回)
// ============================================================

/**
 * 通用鼓励性建议(无阈值触发时使用)
 * 按 artType 区分,提供3-5条正向反馈+持续精进建议
 */
const GENERAL_SUGGESTIONS: Readonly<Record<ArtType, ProfessionalSuggestion[]>> = {
  painting: [
    {
      dimension: '构图',
      level: 'good',
      evidence: '各项构图指标均在合理区间,视觉重心稳定,留白比例适当',
      operation: '可进一步尝试非常规构图(如俯视/仰视/裁切构图),突破常规视角限制',
      reference: '德加《舞蹈课》——倾斜俯视构图营造空间动感',
      practice: '做5种非常规视角构图练习(微距/鱼眼/鸟瞰/虫视/框中框)',
      priority: 'low',
    },
    {
      dimension: '色彩',
      level: 'good',
      evidence: '冷暖色比例均衡,饱和度适中,色彩搭配较和谐',
      operation: '可尝试条件色写生训练,深入观察环境色对固有色的微妙影响',
      reference: '印象派莫奈系列——同一景物不同时段的色彩变化研究',
      practice: '对同一组静物在早晨/中午/傍晚三个时段做色彩速写各一幅',
      priority: 'low',
    },
    {
      dimension: '笔触',
      level: 'good',
      evidence: '笔触方向较统一,力度有基本变化,整体表现较完整',
      operation: '可研究大师笔触技法:伦勃朗的厚堆/塞尚的结构性笔触/梵高的方向性笔触',
      reference: '弗洛伊德后期肖像——笔触塑造与形体结构深度结合',
      practice: '临摹3位大师的局部笔触(各10cm见方),体会用笔差异',
      priority: 'low',
    },
    {
      dimension: '原创性',
      level: 'average',
      evidence: '画面完成度较好,未发现高度相似的已知作品',
      operation: '建议在临摹基础上加入个人情感表达,逐步形成个人视觉语言',
      reference: '齐白石——"学我者生,似我者死",在传承中建立个人风格',
      practice: '每完成一幅写生后,再做一幅同主题的表现性变体,不看对象凭印象和情感创作',
      priority: 'medium',
    },
  ],
  design: [
    {
      dimension: '视觉层次',
      level: 'good',
      evidence: '留白比例合理,视觉重心清晰,信息层级基本明确',
      operation: '可进一步研究视觉传达效率:3秒法则测试——观者3秒内能否获取核心信息',
      reference: 'Saul Bass 电影海报——极简图形瞬间传递影片核心情绪',
      practice: '做3秒信息传达测试,快速展示5张设计稿给同学看,记录第一印象信息',
      priority: 'low',
    },
    {
      dimension: '色彩',
      level: 'good',
      evidence: '配色较和谐,未出现严重色彩失衡问题',
      operation: '可研究色彩心理学在设计中的应用,根据目标用户群体调整色彩策略',
      reference: 'Coca-Cola 红——品牌色彩与情感联想的精准绑定',
      practice: '为同一设计做3种完全不同情绪的配色方案(活力/沉稳/文艺)',
      priority: 'low',
    },
    {
      dimension: '排版',
      level: 'average',
      evidence: '排版方向基本统一,网格对齐有一定基础',
      operation: '建议深入学习网格系统(8pt/4pt grid),建立严格的排版规范',
      reference: 'Josef Muller-Brockmann《网格系统》——现代排版的奠基之作',
      practice: '严格按照8点网格系统重排一个页面,所有间距/字号为8的倍数',
      priority: 'medium',
    },
    {
      dimension: '原创性',
      level: 'average',
      evidence: '设计完成度尚可,未发现高度雷同的已知作品',
      operation: '建议建立个人视觉素材库,从非设计领域(建筑/自然/音乐)获取灵感,避免设计内卷',
      reference: '原研哉设计——从东方美学和日常生活中提炼设计语言',
      practice: '每周做1个"非设计灵感"转化练习,将自然形态/建筑细节转化为图形元素',
      priority: 'medium',
    },
  ],
  product: [
    {
      dimension: '形态',
      level: 'good',
      evidence: '形态比例较协调,重心稳定,线条有基本流畅度',
      operation: '可进一步研究曲面质量(G2/G3连续),提升形态精致度',
      reference: 'Apple MacBook Pro 一体化Unibody机身——曲面连续与工艺极致',
      practice: '用Rhino/Alias做3个G2连续曲面过渡练习,用斑马线检测曲面质量',
      priority: 'low',
    },
    {
      dimension: '材质',
      level: 'good',
      evidence: '材质表现有基本层次,纹理复杂度适中',
      operation: '可研究CMF(Color/Material/Finish)设计,深入表面处理工艺',
      reference: 'Dyson 产品系列——材质与色彩的工业化精致表达',
      practice: '收集20种真实材质样本(塑料/金属/木材/陶瓷/织物),建立个人CMF库',
      priority: 'low',
    },
    {
      dimension: '功能',
      level: 'average',
      evidence: '形态与功能关系基本合理,操作暗示有一定表达',
      operation: '建议深入用户研究,通过人机工程学数据优化操作体验和细节设计',
      reference: 'OXO Good Grips 厨具——人机工程学驱动的形态设计,通用性极强',
      practice: '对一个日常产品做10分钟使用体验记录,列出5个可改进的交互细节',
      priority: 'medium',
    },
    {
      dimension: '原创性',
      level: 'average',
      evidence: '产品形态有基本完整性,未发现高度相似的现有产品',
      operation: '建议从用户真实痛点出发做颠覆性创新,而非微迭代现有产品',
      reference: 'Tesla Cybertruck——完全跳脱传统皮卡设计语言',
      practice: '选一个成熟产品品类,用"如果由苹果/无印良品/乐高来做"的假设做颠覆性方案',
      priority: 'medium',
    },
  ],
  sculpture: [
    {
      dimension: '空间',
      level: 'good',
      evidence: '虚实关系较协调,空间占有基本均衡,重心稳定',
      operation: '可进一步探索负空间(negative space)的表现力,让虚空参与形体塑造',
      reference: '野口勇雕塑——东西方空间美学融合,虚与实的诗意对话',
      practice: '做一组以"穿过"为主题的空间雕塑小稿,探索孔洞与通透的可能性',
      priority: 'low',
    },
    {
      dimension: '形体',
      level: 'good',
      evidence: '形体方向较统一,动态有一定表现力,体量感适中',
      operation: '可深入研究解剖学与形体几何化概括的结合,提升形体塑造力',
      reference: '贾科梅蒂雕塑——极端消瘦形体中蕴含的存在主义力量',
      practice: '做3个同一动态但不同体量感(厚重/轻盈/扭曲)的快速小稿对比',
      priority: 'low',
    },
    {
      dimension: '材质',
      level: 'average',
      evidence: '材质表现基本完整,肌理有一定层次',
      operation: '建议深入研究材料特性与情感表达:铜的厚重/石的永恒/木的温暖/钢的冷峻',
      reference: 'Richard Serra 钢板雕塑——工业材料原始力量的极致呈现',
      practice: '用单一材料(如铁丝/纸板)做一个高50cm的抽象雕塑,穷尽该材料表现力',
      priority: 'medium',
    },
    {
      dimension: '原创性',
      level: 'average',
      evidence: '作品完整度尚可,未发现高度相似的已有雕塑',
      operation: '建议拓展雕塑的定义边界:装置/行为/光影/动态雕塑等跨界探索',
      reference: '蔡国强火药艺术——雕塑与事件/时间/偶然的跨界融合',
      practice: '用非传统雕塑材料完成一件小型作品,并写200字材料观念说明',
      priority: 'medium',
    },
  ],
  // TODO[阶段B Task 18]: 按 HeritageCategory 细化非遗通用建议
  heritage: [
    {
      dimension: '工艺规范',
      level: 'average',
      evidence: '非遗类目作品,工艺完成度与传承规范初步成立',
      operation: '建议对照该类目传统工艺标准(刀工/针法/釉色)逐项校验,强化工艺规范意识',
      reference: '非遗传承人代表作——传统工艺标准与当代表达的平衡',
      practice: '研习该非遗类目3件代表性传承作品,记录其工艺要点与纹样规范',
      priority: 'medium',
    },
    {
      dimension: '原创性',
      level: 'average',
      evidence: '作品在传统纹样基础上进行创作,原创性尚有提升空间',
      operation: '建议在保留传统基因的前提下融入当代设计语言,探索传承与创新的平衡',
      reference: '现代非遗创新案例——传统工艺与当代审美的跨界融合',
      practice: '以同一传统纹样做2版创作(一版忠于传统/一版当代重构)对比',
      priority: 'low',
    },
  ],
};

// ============================================================
// 9. 主入口:generateTemplateSuggestions
// ============================================================

/**
 * 基于 Jimp 客观指标生成模板建议
 * 当 AI 不可用/超时/返回格式错误时调用
 *
 * 算法:
 *   1. 获取对应 artType 的规则集
 *   2. 遍历规则,触发 condition(metrics) === true 的规则
 *   3. 按 priority 排序(high > medium > low),同优先级保持触发顺序
 *   4. 数量限制:high ≤ 2, medium ≤ 2, low ≤ 1, total ≤ 5
 *   5. 无触发规则 → 返回通用鼓励性建议
 *
 * @param metrics Jimp 客观指标(Phase A 全量指标)
 * @param artType 作品类型
 * @returns ProfessionalSuggestion[] 最多5条
 */
export function generateTemplateSuggestions(
  metrics: JimpMetricsForPrompt,
  artType: ArtType,
): ProfessionalSuggestion[] {
  const rules = RULES_BY_ART_TYPE[artType];
  if (!rules || rules.length === 0) {
    return GENERAL_SUGGESTIONS[artType] ?? [];
  }

  // 第一步:收集所有触发的规则,保持触发顺序
  const triggered: Array<{
    rule: TemplateSuggestionRule;
    priority: 'high' | 'medium' | 'low';
  }> = [];

  for (const rule of rules) {
    try {
      if (rule.condition(metrics)) {
        triggered.push({ rule, priority: rule.priority });
      }
    } catch {
      // condition 异常时跳过该规则,不影响其他规则
      continue;
    }
  }

  // 第二步:按优先级分组(保持组内顺序)
  const highRules = triggered.filter((t) => t.priority === 'high');
  const mediumRules = triggered.filter((t) => t.priority === 'medium');
  const lowRules = triggered.filter((t) => t.priority === 'low');

  // 第三步:应用数量限制
  const selected: typeof triggered = [];

  // high 最多 2 条
  const highLimit = 2;
  selected.push(...highRules.slice(0, highLimit));

  // medium 最多 2 条
  const mediumLimit = 2;
  selected.push(...mediumRules.slice(0, mediumLimit));

  // low 最多 1 条
  const lowLimit = 1;
  selected.push(...lowRules.slice(0, lowLimit));

  // 总数不超过 5
  const finalSelected = selected.slice(0, 5);

  // 第四步:若无任何规则触发,返回通用建议
  if (finalSelected.length === 0) {
    return GENERAL_SUGGESTIONS[artType] ?? [];
  }

  // 第五步:将触发的规则转换为 ProfessionalSuggestion
  const suggestions: ProfessionalSuggestion[] = [];
  for (const { rule } of finalSelected) {
    try {
      const evidence = rule.evidence(metrics);
      const operation = resolveOperation(rule.operation, metrics);
      suggestions.push({
        dimension: rule.dimension,
        level: priorityToLevel(rule.priority),
        evidence,
        operation,
        reference: rule.reference,
        practice: rule.practice,
        priority: rule.priority,
      });
    } catch {
      // 单条建议生成异常时跳过
      continue;
    }
  }

  // 如果转换过程中全部失败,返回通用建议
  if (suggestions.length === 0) {
    return GENERAL_SUGGESTIONS[artType] ?? [];
  }

  // 补足到至少3条:如果不足3条,从通用建议中补充low级别的
  if (suggestions.length < 3) {
    const general = GENERAL_SUGGESTIONS[artType] ?? [];
    for (const gen of general) {
      if (suggestions.length >= 3) break;
      // 避免重复维度
      if (!suggestions.some((s) => s.dimension === gen.dimension)) {
        suggestions.push(gen);
      }
    }
    // 如果还是不足3条(维度重复),直接用通用建议前几条填充
    while (suggestions.length < 3 && suggestions.length < general.length) {
      const idx = suggestions.length;
      if (!suggestions.includes(general[idx]!)) {
        suggestions.push(general[idx]!);
      } else {
        break;
      }
    }
  }

  return suggestions.slice(0, 5);
}

// ============================================================
// 10. 工具函数:构造 AI 失败时的 AIVisionResult 兜底结果
// ============================================================

/**
 * 构造 AI 失败时的降级 AIVisionResult
 *
 * 批次③(2026-09-05):模板建议话术下线——阈值触发的模板建议对"这张画"缺乏针对性(spec §5b:
 * "万能模板话术"),降级路径不再填充 professionalSuggestions(前端展示客观检测 + 无建议状态)。
 * 本函数保留以维持 aiVisionResult 结构兼容(semanticTheme 说明离线状态),建议数组恒为空。
 *
 * @param metrics Jimp 客观指标(保留参数兼容,不再用于生成建议)
 * @param artType 作品类型
 * @returns 降级的 AIVisionResult(aiEnhanced=false 场景,无模板建议)
 */
export function createFallbackAIVisionResult(
  _metrics: JimpMetricsForPrompt,
  artType: ArtType,
): AIVisionResult {
  // 根据作品类型生成默认语义描述(说明当前为本地客观检测模式)
  const semanticThemeByType: Record<ArtType, string> = {
    painting: '该作品为绘画作业,已完成构图、色彩、笔触等像素级客观检测。AI 深度语义分析暂不可用,可稍后重试获取完整诊断与评分。',
    design: '该作品为设计作业,已完成视觉层次、排版、色彩等像素级客观检测。AI 深度语义分析暂不可用,可稍后重试获取完整诊断与评分。',
    product: '该作品为产品设计作业,已完成形态、材质、功能表达等像素级客观检测。AI 深度语义分析暂不可用,可稍后重试获取完整诊断与评分。',
    sculpture: '该作品为雕塑作业,已完成空间构成、形体语言、材质等像素级客观检测。AI 深度语义分析暂不可用,可稍后重试获取完整诊断与评分。',
    heritage: '该作品为非遗类目作业,已完成构图、色彩、工艺等像素级客观检测。AI 深度语义分析暂不可用,可稍后重试获取完整诊断与评分。',
  };

  return {
    visualDescription: semanticThemeByType[artType],
    composition: '基于本地像素分析',
    color: '基于本地像素分析',
    technique: '基于本地像素分析',
    semanticTheme: semanticThemeByType[artType],
    styleRecognition: '离线分析模式(AI暂不可用)',
    professionalSuggestions: [], // 批次③:模板建议下线,不填充阈值触发话术
    scoreAdjustments: {
      dimensionAdjustments: [],
      overallDelta: 0,
      overallReason: 'AI分析暂不可用,未进行评分',
    },
    referenceArtworks: [],
  };
}
