import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Upload, Eye, Palette, Sparkles, CheckCircle2, Loader2, ArrowRight, PenTool, Layers, Box, Brush, Download, Share2, Cpu, Cloud, Zap, Type, Gem, Settings, Move, Scan, Brain, FileText, Image as ImageIcon, RefreshCw, History as HistoryIcon, AlertTriangle, GraduationCap, Award, MessageCircleQuestion, Send, ChevronDown, ChevronUp, X, Clock, TimerReset, Wand2 } from 'lucide-react';
import type { AnalysisResult, PaintingAnalysis, DesignAnalysis, ProductAnalysis, SculptureAnalysis, ProfessionalSuggestion, SuggestionPriority, DiagnosisMode, ExamSubject, EvaluationStage, HeritageCategory } from '../types';
import { EXAM_SUBJECT_LABEL } from '../types';
import { saveAnalysis } from '../services/data-service';
import { createDraft, deleteDraft, updateDraft, getDraft } from '../services/draft-service';
import { createMarkerFeedback } from '../services/marker-feedback-api';
import { listAnnotations } from '../services/teacher-api';
import type { TeacherAnnotationRecord } from '../types/teacher';
import { useAuth } from '../hooks/useAuth';
import HeatmapCanvas from '../components/HeatmapCanvas';
import SmartImage from '../components/SmartImage';
import { ScoreTraceToggle, RubricSummaryBar } from '../components/ScoreTracePanel';
import { useToast } from '../components/ToastProvider';
import { smartAnalyze, aiEnhanceAnalysis, askAnalysisQuestion, persistLocalAnalysis, type AnalysisDecision, type AnalysisQAResult } from '../services/smartAnalysisEngine';
import PresetSelector from '../components/PresetSelector';
import RequestReviewSection from '../components/RequestReviewSection';
import ReviewListSection from '../components/ReviewListSection';
import AnalysisInsights from '../components/AnalysisInsights';
import ScoreCriteriaPanel from '../components/ScoreCriteriaPanel';
import AnnotationWorkspace from '../components/AnnotationWorkspace';
import DepthDimensionsPanel from '../components/DepthDimensionsPanel';
import ShareToOrgButton from '../components/org/ShareToOrgButton';
import ExamResultPanel from '../components/ExamResultPanel';
import ObjectiveChecksPanel from '../components/ObjectiveChecksPanel';
import CrossDomainInspiration from '../components/CrossDomainInspiration';
import { ApiError } from '../services/api';

type Step = 'upload' | 'analyzing' | 'result';
type ArtTypeLocal = 'painting' | 'design' | 'product' | 'sculpture' | 'heritage';

/* AI 分析过程可视化：5 阶段流水线，让用户清晰看到分析进度与当前动作 */
const ANALYSIS_STAGES = [
  { id: 0, name: '图像预处理', desc: '解析画面构成', icon: ImageIcon },
  { id: 1, name: '特征提取', desc: '识别主体与元素', icon: Scan },
  { id: 2, name: '维度分析', desc: '多维度智能诊断', icon: Layers },
  { id: 3, name: '综合评估', desc: '生成评分与建议', icon: Brain },
  { id: 4, name: '报告生成', desc: '整理诊断报告', icon: FileText },
];

/* 实时专业术语描述：按阶段分组，每阶段 4 句专业描述
   阶段 2（维度分析）按艺术类型自适应，呈现绘画/设计/产品/雕塑各自的专业维度 */
const STAGE_DETAILS_GENERIC: string[][] = [
  /* 阶段 0：图像预处理 */
  [
    '解析 EXIF 元数据与分辨率信息',
    '转换 RGB → Lab 色彩空间',
    '建立像素矩阵，去噪与锐化处理',
    '生成画面直方图与亮度分布',
  ],
  /* 阶段 1：特征提取 */
  [
    'Canny 边缘检测识别轮廓形态',
    'HOG 方向梯度直方图提取',
    'SIFT 关键点匹配与定位',
    '主体物识别与背景区域分割',
  ],
  /* 阶段 2 占位（按艺术类型动态选择，见 STAGE_DETAILS_BY_ART_TYPE） */
  [],
  /* 阶段 3：综合评估 */
  [
    '多维度加权评分模型计算',
    '对比风格库匹配相似作品',
    '识别优势项与待改进维度',
    '生成改进建议与参考方向',
  ],
  /* 阶段 4：报告生成 */
  [
    '结构化输出诊断报告',
    '整理可视化热力图数据',
    '生成具体改进建议清单',
    '保存诊断记录到历史档案',
  ],
];

/* 阶段 2 维度分析：按艺术类型给出 4 句专业术语，对应 3 个核心维度 + 综合 */
const STAGE_DETAILS_BY_ART_TYPE: Record<ArtTypeLocal, string[]> = {
  painting: [
    '黄金分割与三分法则构图验证',
    '视觉重心坐标计算与焦点定位',
    '主色调提取与色彩饱和度分析',
    '笔触纹理特征与飞白密度识别',
  ],
  design: [
    '网格系统对齐与视觉层次评估',
    '字体排版节奏与阅读路径分析',
    '色彩对比度与无障碍标准验证',
    '留白比例与信息密度平衡',
  ],
  product: [
    '形态语义与曲面连续性分析',
    '材质表现与反光特性识别',
    '人机工程学与握持比例评估',
    '功能逻辑与操作流程推演',
  ],
  sculpture: [
    '空间构成与体量平衡分析',
    '形体语言与轮廓张力评估',
    '材料肌理与表面处理识别',
    '虚实关系与负空间计算',
  ],
  heritage: [
    '工艺技法与刀工流畅度识别',
    '传统纹样传承与阴阳虚实分析',
    '构图均衡与视觉节奏评估',
    '材质表现与工艺完整度推演',
  ],
};

/* 根据当前阶段 + 艺术类型获取对应的描述列表(非遗按类目返回专属工艺维度文案) */
function getStageDetails(stage: number, artType: ArtTypeLocal, heritageCategory?: HeritageCategory): string[] {
  if (stage === 2) {
    if (artType === 'heritage' && heritageCategory) {
      return HERITAGE_DIMENSIONS[heritageCategory].map((d) => `${d}评估`);
    }
    return STAGE_DETAILS_BY_ART_TYPE[artType];
  }
  return STAGE_DETAILS_GENERIC[stage] || ['正在分析...'];
}

const artTypes: { id: ArtTypeLocal; name: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: 'painting', name: '绘画', icon: Brush, desc: '油画、水彩、素描、国画等' },
  { id: 'design', name: '设计', icon: PenTool, desc: '视觉传达、平面设计、UI设计等' },
  { id: 'product', name: '产品设计', icon: Box, desc: '工业设计、产品造型、家具设计等' },
  { id: 'sculpture', name: '雕塑', icon: Layers, desc: '雕塑、陶艺、装置艺术等' },
  { id: 'heritage', name: '非遗工艺', icon: Gem, desc: '剪纸、刺绣、瓷器等传统非遗' },
];

/* 用户上次选择的创作类型持久化键(localStorage),实现"下次诊断直接选上次" */
const LAST_ART_TYPE_KEY = 'danqing-last-art-type';
const VALID_ART_TYPES: ArtTypeLocal[] = ['painting', 'design', 'product', 'sculpture', 'heritage'];
function isValidArtType(v: unknown): v is ArtTypeLocal {
  return typeof v === 'string' && (VALID_ART_TYPES as string[]).includes(v);
}
function readLastArtType(): ArtTypeLocal | null {
  try {
    const v = localStorage.getItem(LAST_ART_TYPE_KEY);
    return isValidArtType(v) ? v : null;
  } catch { return null; }
}
function writeLastArtType(t: ArtTypeLocal) {
  try { localStorage.setItem(LAST_ART_TYPE_KEY, t); } catch { /* ignore */ }
}

const ANALYSIS_CONFIG: Record<ArtTypeLocal, { dimensions: { label: string; icon: React.ComponentType<{ className?: string }>; color: string; barColor: string }[] }> = {
  painting: {
    dimensions: [
      { label: '构图分析', icon: Eye, color: 'text-cinnabar', barColor: 'bg-cinnabar' },
      { label: '色彩诊断', icon: Palette, color: 'text-stone', barColor: 'bg-stone' },
      { label: '笔触技法', icon: PenTool, color: 'text-gold', barColor: 'bg-gold' },
    ],
  },
  design: {
    dimensions: [
      { label: '视觉层次', icon: Eye, color: 'text-cinnabar', barColor: 'bg-cinnabar' },
      { label: '排版诊断', icon: Type, color: 'text-stone', barColor: 'bg-stone' },
      { label: '色彩应用', icon: Palette, color: 'text-gold', barColor: 'bg-gold' },
    ],
  },
  product: {
    dimensions: [
      { label: '形态分析', icon: Box, color: 'text-cinnabar', barColor: 'bg-cinnabar' },
      { label: '材质表现', icon: Gem, color: 'text-stone', barColor: 'bg-stone' },
      { label: '功能表达', icon: Settings, color: 'text-gold', barColor: 'bg-gold' },
    ],
  },
  sculpture: {
    dimensions: [
      { label: '空间构成', icon: Box, color: 'text-cinnabar', barColor: 'bg-cinnabar' },
      { label: '形体语言', icon: Move, color: 'text-stone', barColor: 'bg-stone' },
      { label: '材料语言', icon: Gem, color: 'text-gold', barColor: 'bg-gold' },
    ],
  },
  heritage: {
    dimensions: [
      { label: '工艺技法', icon: Gem, color: 'text-cinnabar', barColor: 'bg-cinnabar' },
      { label: '纹样传承', icon: Palette, color: 'text-stone', barColor: 'bg-stone' },
      { label: '构图均衡', icon: Box, color: 'text-gold', barColor: 'bg-gold' },
    ],
  },
};

/* 评价阶段元信息(阶段 D Task 14.1:诊断报告标题徽章复用)
 * teaching 三档(爱好者/进阶/资深)用青绿色系;exam 三档(联考/美院/大师)用朱砂色系 */
const EVALUATION_STAGE_META: Record<EvaluationStage, { label: string; tone: 'jade' | 'cinnabar' }> = {
  enthusiast: { label: '爱好者级', tone: 'jade' },
  intermediate: { label: '进阶层', tone: 'jade' },
  advanced: { label: '资深层', tone: 'jade' },
  unified: { label: '联考级', tone: 'cinnabar' },
  academy: { label: '美院级', tone: 'cinnabar' },
  master: { label: '大师级', tone: 'cinnabar' },
};

const HERITAGE_CATEGORIES: { id: HeritageCategory; name: string; desc: string }[] = [
  { id: 'papercut', name: '剪纸', desc: '阴阳虚实 · 刀工流畅' },
  { id: 'embroidery', name: '刺绣', desc: '针法运用 · 色彩过渡' },
  { id: 'porcelain', name: '瓷器', desc: '造型规整 · 釉色质感' },
  { id: 'nianhua', name: '年画', desc: '套色明快 · 民俗叙事' },
  { id: 'shadowpuppet', name: '皮影', desc: '镂空雕镂 · 影偶动态' },
  { id: 'weaving', name: '编织', desc: '经纬结构 · 纹理秩序' },
  { id: 'woodcarving', name: '木雕', desc: '刀法层次 · 木质肌理' },
  { id: 'clay', name: '泥塑', desc: '塑形生动 · 泥料质感' },
  { id: 'lacquer', name: '漆器', desc: '髹饰温润 · 螺钿镶嵌' },
  { id: 'thangka', name: '唐卡', desc: '度量规范 · 矿彩浓丽' },
];

/* 十大类非遗的专属工艺评估维度(4维/类目,对齐非遗知识库鉴赏体系与后端评估上下文) */
const HERITAGE_DIMENSIONS: Record<HeritageCategory, string[]> = {
  papercut: ['刀工流畅度', '阴阳虚实', '传统纹样', '构图均衡'],
  embroidery: ['针法运用', '丝理走向', '色彩过渡', '绣面平整度'],
  porcelain: ['造型规整度', '釉色质感', '纹饰布局', '胎体工艺'],
  nianhua: ['套色准确度', '造型程式', '民俗叙事', '构图饱满度'],
  shadowpuppet: ['镂空雕镂', '影偶造型', '关节结构', '敷彩层次'],
  weaving: ['经纬密度', '纹样秩序', '材料肌理', '色彩交织'],
  woodcarving: ['刀法层次', '造型生动度', '木质肌理', '打磨光洁度'],
  clay: ['塑形准确度', '动态神韵', '泥料质感', '细部刻画'],
  lacquer: ['髹饰工艺', '螺钿镶嵌', '大漆温润度', '纹样布局'],
  thangka: ['度量经规范', '矿彩浓度', '开眼技法', '构图坛城秩序'],
};

/* 十大类非遗四维工艺点评(报告页维度卡片内容,与 HERITAGE_DIMENSIONS 一一对应) */
const HERITAGE_DIM_COMMENTS: Record<HeritageCategory, string[]> = {
  papercut: ['走刀连贯流畅,转角处无毛刺断刀', '阴刻阳刻相衬,虚实节奏分明', '锯齿纹月牙纹规范,纹样寓意准确', '团花中心对称,视觉重心稳定'],
  embroidery: ['平齐细密,针脚均匀不露底', '丝理转折自然,顺应物象结构', '晕色衔接柔和,色阶过渡细腻', '绣面平服,无起皱露底'],
  porcelain: ['器型端正,口沿腹部曲线流畅', '釉面温润匀净,光泽内蕴', '纹样疏密有致,主次分明', '胎质细腻致密,修胎规整'],
  nianhua: ['套版对位精准,色版无错位', '人物开脸规范,程式语言纯正', '题材寓意吉祥,叙事完整', '画面饱满均衡,留白得当'],
  shadowpuppet: ['镂空纹样精细,刀口干净利落', '侧面影像生动,轮廓优美', '活动关节灵活,签子装配合理', '敷色透亮,层次过渡自然'],
  weaving: ['经纬排布均匀,松紧一致', '提花纹样秩序井然,循环准确', '篾丝粗细匀称,肌理自然', '色线交织和谐,对比得当'],
  woodcarving: ['刀法圆熟,深浅层次分明', '形神兼备,动态自然', '顺纹用刀,木纹肌理得体', '打磨细腻,无刀痕毛刺'],
  clay: ['比例结构准确,形体饱满', '神态生动,气韵连贯', '泥料匀净,塑痕处理得当', '五官衣纹细部刻画入微'],
  lacquer: ['髹漆层薄而匀,无流坠起皱', '镶嵌平整牢固,接缝密合', '漆面温润内蕴,光泽含蓄', '纹样布局讲究,疏密有度'],
  thangka: ['佛身比例合度,量度严谨', '矿物颜料浓度恰当,发色沉稳', '开眼传神,点睛到位', '坛城秩序井然,主从分明'],
};

/* Task 14.5:非遗类目选择器(仅 selectedArtType==='heritage' 时显示) */
function HeritageCategoryPicker({ value, onChange }: { value: HeritageCategory; onChange: (v: HeritageCategory) => void }) {
  return (
    <div className="mt-4">
      <h4 className="font-serif text-sm font-bold text-ink-900 mb-2 text-center">选择非遗类目</h4>
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="非遗类目">
        {HERITAGE_CATEGORIES.map((c) => {
          const isSelected = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(c.id)}
              className={`p-3 rounded-lg text-center transition-all ${
                isSelected
                  ? 'bg-gold text-white shadow-card'
                  : 'bg-white text-ink-700 shadow-card hover:shadow-card-hover'
              }`}
            >
              <p className="font-medium text-sm">{c.name}</p>
              <p className={`text-2xs mt-1 ${isSelected ? 'text-white/80' : 'text-ink-500'}`}>{c.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getScoreBg(score: number) {
  if (score >= 85) return 'bg-jade';
  if (score >= 70) return 'bg-gold';
  return 'bg-cinnabar';
}

// 类型守卫
function isPainting(dims: AnalysisResult['dimensions']): dims is PaintingAnalysis {
  return dims.type === 'painting';
}
function isDesign(dims: AnalysisResult['dimensions']): dims is DesignAnalysis {
  return dims.type === 'design';
}
function isProduct(dims: AnalysisResult['dimensions']): dims is ProductAnalysis {
  return dims.type === 'product';
}
function isSculpture(dims: AnalysisResult['dimensions']): dims is SculptureAnalysis {
  return dims.type === 'sculpture';
}

// 辅助组件
function DimensionHeader({ icon: Icon, title, score, color }: { icon: React.ComponentType<{className?: string}>, title: string, score: number | null, color: 'cinnabar' | 'stone' | 'gold' }) {
  const bgColor = color === 'cinnabar' ? 'bg-cinnabar/10' : color === 'stone' ? 'bg-stone/10' : 'bg-gold/10';
  const textColor = color === 'cinnabar' ? 'text-cinnabar' : color === 'stone' ? 'text-stone' : 'text-gold';
  // 批次③:维度分可空(本地引擎停分),null 用中性灰底
  const scoreBg = score == null ? 'bg-ink-400' : getScoreBg(score);
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${bgColor} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${textColor}`} />
        </div>
        <h3 className="font-serif text-lg font-bold text-ink-900">{title}</h3>
      </div>
      <div className={`w-12 h-12 ${scoreBg} rounded-full flex items-center justify-center`}>
        <span className="font-serif text-xl font-bold text-white">{score ?? '—'}</span>
      </div>
    </div>
  );
}

function MetricItem({ label, value, className = '' }: { label: string, value: React.ReactNode, className?: string }) {
  return (
    <div className="bg-rice-50 rounded-lg p-3">
      <div className="text-xs text-ink-500 mb-1">{label}</div>
      <div className={`text-sm font-medium text-ink-700 ${className}`}>{value}</div>
    </div>
  );
}

function SuggestionBox({ color, suggestion, evidence, priority }: {
  color: 'cinnabar' | 'stone' | 'gold';
  suggestion: string;
  evidence?: string;
  priority?: SuggestionPriority;
}) {
  const bg = color === 'cinnabar' ? 'bg-cinnabar/5' : color === 'stone' ? 'bg-stone/5' : 'bg-gold/5';
  const border = color === 'cinnabar' ? 'border-cinnabar/20' : color === 'stone' ? 'border-stone/20' : 'border-gold/20';
  const text = color === 'cinnabar' ? 'text-cinnabar' : color === 'stone' ? 'text-stone' : 'text-gold';

  /* priority 颜色标识: high=朱砂红/警告, medium=石青/信息, low=墨灰/普通 */
  const priorityStyles: Record<SuggestionPriority, { label: string; badge: string }> = {
    high: { label: '优先改进', badge: 'bg-cinnabar text-white' },
    medium: { label: '建议提升', badge: 'bg-[#5a8a7a] text-white' },
    low: { label: '亮点保持', badge: 'bg-ink-500 text-white' },
  };

  return (
    <div className={`${bg} rounded-xl p-4 border ${border}`}>
      <div className="flex items-center justify-between mb-1">
        <p className={`text-sm font-medium ${text}`}>改进建议</p>
        {priority && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityStyles[priority].badge}`}>
            {priorityStyles[priority].label}
          </span>
        )}
      </div>
      <p className="text-sm text-ink-600">{suggestion}</p>
      {evidence && (
        <p className="text-xs text-ink-400 mt-2 pl-3 border-l-2 border-ink-200 italic">
          数据依据: {evidence}
        </p>
      )}
    </div>
  );
}

/**
 * 专业建议卡片(用于AI增强模式下的professionalSuggestions列表)
 * 按priority排序显示,支持evidence引用、reference参考案例、practice练习路径
 */
function ProfessionalSuggestionCard({ sug, index }: { sug: ProfessionalSuggestion; index: number }) {
  const priority: SuggestionPriority = sug.priority || 'medium';

  const priorityConfig: Record<SuggestionPriority, {
    label: string;
    borderColor: string;
    badgeBg: string;
    dotColor: string;
    headerBg: string;
  }> = {
    high: {
      label: '优先改进',
      borderColor: 'border-cinnabar/30',
      badgeBg: 'bg-cinnabar text-white',
      dotColor: 'bg-cinnabar',
      headerBg: 'bg-cinnabar/5',
    },
    medium: {
      label: '建议提升',
      borderColor: 'border-[#5a8a7a]/30',
      badgeBg: 'bg-[#5a8a7a] text-white',
      dotColor: 'bg-[#5a8a7a]',
      headerBg: 'bg-[#5a8a7a]/5',
    },
    low: {
      label: '亮点保持',
      borderColor: 'border-ink-300/30',
      badgeBg: 'bg-ink-500 text-white',
      dotColor: 'bg-ink-400',
      headerBg: 'bg-ink-100/50',
    },
  };

  const cfg = priorityConfig[priority];

  return (
    <div className={`bg-rice-50 rounded-xl border ${cfg.borderColor} overflow-hidden`}>
      <div className={`px-4 py-2.5 ${cfg.headerBg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
          <span className="text-xs font-medium text-ink-700">{index + 1}.</span>
          <span className="text-sm font-semibold text-ink-900 font-serif">{sug.dimension}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badgeBg}`}>
          {cfg.label}
        </span>
      </div>
      <div className="p-4 space-y-2">
        {/* 操作建议 */}
        <p className="text-sm text-ink-700 leading-relaxed">{sug.operation}</p>

        {/* 证据字段:小字、灰色、引用样式 */}
        {sug.evidence && (
          <p className="text-xs text-ink-400 pl-3 border-l-2 border-ink-200 italic leading-relaxed">
            数据依据: {sug.evidence}
          </p>
        )}

        {/* 参考案例 */}
        {sug.reference && (
          <p className="text-xs text-ink-500">
            <span className="font-medium text-ink-600">参考:</span> {sug.reference}
          </p>
        )}

        {/* 练习路径 */}
        {sug.practice && (
          <p className="text-xs text-ink-500">
            <span className="font-medium text-ink-600">练习:</span> {sug.practice}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 按优先级排序专业建议: high > medium > low; 同级保持原顺序
 */
function sortSuggestionsByPriority(suggestions: ProfessionalSuggestion[]): ProfessionalSuggestion[] {
  const order: Record<SuggestionPriority, number> = { high: 0, medium: 1, low: 2 };
  return [...suggestions].sort((a, b) => {
    const pa = order[a.priority || 'medium'];
    const pb = order[b.priority || 'medium'];
    return pa - pb;
  });
}

function HeatmapSection({ data, focusPoint, title = '视觉焦点热力图', harmonyData }: { data: number[][], focusPoint?: {x:number, y:number}, title?: string, harmonyData?: { harmonyScore?: number; harmonyType?: string; dominantColor?: string } }) {
  return (
    <div className="bg-rice-100 rounded-xl p-4 mb-4">
      <p className="text-sm font-medium text-ink-700 mb-3">{title}</p>
      <div className="flex justify-center">
        <HeatmapCanvas heatmapData={data} focusPoint={focusPoint} harmonyData={harmonyData} />
      </div>
      <p className="text-xs text-ink-500 text-center mt-2">{harmonyData ? '可切换查看色彩和谐度环形图' : '红色区域为视觉焦点'}</p>
    </div>
  );
}

/**
 * 分数圆环动画组件：从 0 滚动到 targetScore，SVG stroke-dashoffset 同步动画
 * 颜色按分数档位区分：>=85 jade 玉绿、70-84 gold 金、<70 cinnabar 朱砂红
 * 使用 easeOutQuart 缓动让数字滚动有减速感，持续 1.2s
 */
function AnimatedScore({ score, size = 120 }: { score: number; size?: number }) {
  const [displayScore, setDisplayScore] = useState(0);
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayScore / 100) * circumference;
  /* 使用项目 ink 色板的精确色值，保证设计一致性 */
  const color = score >= 85 ? '#5b8c5a' : score >= 70 ? '#d4af37' : '#c41e3a';

  useEffect(() => {
    let raf: number;
    const start = Date.now();
    const duration = 1200;
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      /* easeOutQuart 缓动：前期快速推进，后期减速 */
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplayScore(Math.round(score * eased));
      if (progress < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,15,15,0.06)" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-3xl font-bold" style={{ color }}>{displayScore}</span>
        <span className="text-xs text-ink-400">总分</span>
      </div>
    </div>
  );
}

/* ============================================================
 * 创作草稿辅助 (任务包A)
 * - compressImageToThumbnail: 用 canvas 压缩为最大 maxSize 的 JPEG dataURL
 *   (避免把原图 MB 级 dataURL 写入 LocalStorage 导致超配额)
 * - getDraftIdFromUrl / setDraftIdInUrl: HashRouter 兼容的 draftId 读写
 *   (hash 形如 #/analyze?draftId=xxx,用 history.replaceState 不刷新页面)
 * ============================================================ */

/** 将 dataURL 图片压缩为最大 maxSize 的 JPEG 缩略图 dataURL;失败回退原图 */
function compressImageToThumbnail(dataUrl: string, maxSize = 200): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          // 等比缩放,最长边不超过 maxSize,不放大原图
          const ratio = Math.min(maxSize / width, maxSize / height, 1);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          // JPEG 0.7 质量:缩略图足够清晰且体积小
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** 从 URL hash 中读取 draftId (HashRouter 兼容) */
function getDraftIdFromUrl(): string | null {
  try {
    const hash = window.location.hash; // e.g. "#/analyze?draftId=xxx"
    const queryStr = hash.split('?')[1];
    if (!queryStr) return null;
    return new URLSearchParams(queryStr).get('draftId');
  } catch {
    return null;
  }
}

/** 在 URL hash 中写入/清除 draftId (history.replaceState 不刷新页面) */
function setDraftIdInUrl(id: string | null): void {
  try {
    const hash = window.location.hash;
    const [path, query] = hash.replace(/^#/, '').split('?');
    const params = new URLSearchParams(query || '');
    if (id) params.set('draftId', id);
    else params.delete('draftId');
    const qs = params.toString();
    const newHash = qs ? `${path}?${qs}` : path;
    window.history.replaceState(null, '', `#${newHash}`);
  } catch (err) {
    console.warn('更新 URL draftId 失败:', err);
  }
}

/* ============================================================
 * 相似作品并排对比卡(阶段 D,Task 13.2)
 * 数据源:result.aiVisionResult.referenceArtworks(AI 深度分析输出)
 * 注:referenceArtworks 当前未在 src/types 的 AIVisionResult 中声明(类型文件只读,
 *     由架构师维护),此处通过本地展示接口 + 类型断言访问;后端返回该字段时渲染,
 *     为空时不渲染,不影响普通分析流程。
 * ============================================================ */

/** 参考作品(AI 识别的相似名作/参考案例) */
interface ReferenceArtwork {
  title?: string;
  artist?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  /** 相似点说明(AI 给出的与当前作品的相似之处) */
  similarityNote?: string;
  note?: string;
  description?: string;
  similarity?: string | number;
}

/** 从 aiVisionResult 安全提取 referenceArtworks(类型未声明,用断言兜底) */
function extractReferenceArtworks(vision: AnalysisResult['aiVisionResult']): ReferenceArtwork[] {
  if (!vision) return [];
  const raw = (vision as unknown as { referenceArtworks?: unknown }).referenceArtworks;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is ReferenceArtwork =>
    Boolean(a) && typeof a === 'object' &&
    (Boolean((a as ReferenceArtwork).title) ||
     Boolean((a as ReferenceArtwork).imageUrl) ||
     Boolean((a as ReferenceArtwork).thumbnailUrl))
  );
}

function ReferenceArtworksSection({ artworks }: { artworks: ReferenceArtwork[] }) {
  if (artworks.length === 0) return null;
  const top = artworks.slice(0, 3);
  return (
    <section aria-label="相似作品对比" className="bg-rice-50 rounded-2xl p-6 shadow-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-stone/10 rounded-lg flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-stone" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-bold text-ink-900">相似作品对比</h3>
          <p className="text-xs text-ink-500">AI 识别的画面参考与相似点分析</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {top.map((art, i) => {
          const img = art.thumbnailUrl || art.imageUrl;
          const note = art.similarityNote || art.note || art.description;
          return (
            <div key={i} className="bg-white/70 rounded-xl border border-ink-100 overflow-hidden flex flex-col">
              {img ? (
                <div className="aspect-[4/3] bg-ink-100 overflow-hidden">
                  <img
                    src={img}
                    alt={art.title || '参考作品'}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div className="aspect-[4/3] bg-ink-100 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-ink-300" />
                </div>
              )}
              <div className="p-3 flex-1 flex flex-col">
                <p className="text-sm font-semibold text-ink-900 truncate">{art.title || '未命名作品'}</p>
                {art.artist && <p className="text-xs text-ink-500 mt-0.5 truncate">{art.artist}</p>}
                {note && <p className="text-xs text-ink-600 mt-2 leading-relaxed flex-1">{note}</p>}
                {typeof art.similarity === 'number' && (
                  <span className="mt-2 inline-flex items-center gap-1 text-2xs text-stone">
                    相似度 {Math.round(art.similarity * 100)}%
                  </span>
                )}
                {typeof art.similarity === 'string' && (
                  <span className="mt-2 inline-flex items-center gap-1 text-2xs text-stone">{art.similarity}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AnalysisPage() {
  const toast = useToast();
  /* 用 ref 持有最新 toast 上下文,供分析 useEffect 内部调用。
   * 原因:ToastProvider 的 context value 对象每次渲染都会重建,
   * 若把 `toast` 直接放入分析 effect 依赖,会在 toast 出现/消失时
   * 重复触发 smartAnalyze(造成重复分析)。ref 方式既拿到最新方法,
   * 又不进入依赖数组,行为与原先一致。 */
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { user, tenant } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('upload');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  /* Phase 4 批次④:教师批注列表(学生端第⑤层展示;后端记录变化时重拉) */
  const [teacherAnnotations, setTeacherAnnotations] = useState<TeacherAnnotationRecord[]>([]);
  const resultId = result?.id;
  useEffect(() => {
    /* 仅服务端落库分析可拉(本地 analysis-* 前缀无后端记录;silent 失败静默) */
    if (!resultId || resultId.startsWith('analysis-')) {
      setTeacherAnnotations([]);
      return;
    }
    let cancelled = false;
    listAnnotations(resultId)
      .then((items) => {
        if (!cancelled) setTeacherAnnotations(items);
      })
      .catch(() => {
        if (!cancelled) setTeacherAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [resultId]);
  /* 批注查找:markerId 优先、markerIndex 兜底(与写入定位语义对称);
   * 服务端返回的 markerIndex 已是修正后真实索引 */
  const teacherAnnotationLookup = useCallback(
    (markerId: string | undefined, markerIndex: number): TeacherAnnotationRecord | undefined => {
      if (markerId) {
        const byId = teacherAnnotations.find((a) => a.markerId === markerId);
        if (byId) return byId;
      }
      return teacherAnnotations.find((a) => a.markerIndex === markerIndex);
    },
    [teacherAnnotations],
  );
  /* 非遗类目(阶段 D Task 14.5):仅 selectedArtType==='heritage' 时有效,
   * 上传请求透传给后端切换剪纸/刺绣/瓷器评估维度上下文。 */
  const [heritageCategory, setHeritageCategory] = useState<HeritageCategory>('papercut');
  const [progress, setProgress] = useState(0);
  const [detailIndex, setDetailIndex] = useState(0);
  /* 上次诊断方案记忆:URL ?type= 优先级最高(侧栏快捷入口),其次 localStorage 上次选择,最后默认绘画 */
  const [selectedArtType, setSelectedArtType] = useState<ArtTypeLocal>(() => {
    try {
      /* 初次渲染时 react-router 的 searchParams 还未取到,用 window.location 兜底 */
      const hash = window.location.hash || '';
      const qIdx = hash.indexOf('?');
      const urlType = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)).get('type') : null;
      if (isValidArtType(urlType)) return urlType;
      const last = readLastArtType();
      return last ?? 'painting';
    } catch { return 'painting'; }
  });
  const [analysisDecision, setAnalysisDecision] = useState<AnalysisDecision | null>(null);
  const [analysisDuration, setAnalysisDuration] = useState<number | null>(null);
  const [showTypeSwitcher, setShowTypeSwitcher] = useState(false);

  /* ====== 诊断模式(2026-08-16 诊断理念重构) ======
   * diagnosisMode: teaching 教学诊断(默认) / exam 艺考诊断
   * 默认值跟随学习者画像:artStudent(美术生)→ exam,其余 → teaching;
   * 用户手动切换后不再被画像覆盖(modeTouchedRef 标记)。
   * examSubject: 艺考科目,仅 exam 模式提交,默认素描。 */
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>(() =>
    user?.learnerProfile === 'artStudent' ? 'exam' : 'teaching'
  );
  const [examSubject, setExamSubject] = useState<ExamSubject>('sketch');
  const modeTouchedRef = useRef(false);
  /* 画像异步就绪后同步一次默认模式(用户未手动切换时) */
  useEffect(() => {
    if (!modeTouchedRef.current && user?.learnerProfile) {
      setDiagnosisMode(user.learnerProfile === 'artStudent' ? 'exam' : 'teaching');
    }
  }, [user?.learnerProfile]);
  const handleModeChange = useCallback((mode: DiagnosisMode) => {
    modeTouchedRef.current = true;
    setDiagnosisMode(mode);
  }, []);
  /* AI 深度增强分析 loading(阶段 2:仅当结果未 aiEnhanced 时显示按钮) */
  const [aiEnhanceLoading, setAiEnhanceLoading] = useState(false);
  /* P0 深度诊断黑盒修复:AI 深度分析 8 阶段进度可视化 + 错误详情折叠面板 */
  /** 8 阶段名称:阶段 0="同步诊断记录"(前端 id→UUID 落库,让 AI 功能永远可用);
   *  阶段 1-7 与后端 stageTimings 键对齐:metrics_extract/prompt_build/image_preprocess/
   *  model_call/result_parse/result_merge/persist */
  const AI_ENHANCE_STAGES: { key: string; label: string; tip: string }[] = [
    { key: 'persist_local', label: '同步诊断记录到服务器', tip: '先将本地分析结果落库,再发起 AI 深度分析(任何网络状态下都可直接点按钮)。' },
    { key: 'metrics_extract', label: '提取作品特征指纹', tip: '从本地 3 秒分析结果中抽取色彩/构图/纹理客观指标' },
    { key: 'prompt_build', label: '构建深度诊断 Prompt', tip: '注入评价阶段/非遗工艺维度/去同质化约束' },
    { key: 'image_preprocess', label: '图像预处理与编码', tip: '读取作品文件并转为 base64,缩放到视觉模型输入分辨率' },
    { key: 'model_call', label: '调用 GLM-4V 视觉模型', tip: '长耗时阶段,含 4 深度维度计算 + 评分标准 + 问题区域标注 + 美学洞察三层面板' },
    { key: 'result_parse', label: '解析模型结构化输出', tip: '校验 JSON Schema,抽取 scoreCriteria/issueMarkers/4 维度评分' },
    { key: 'result_merge', label: '校准本地与 AI 结果', tip: '应用 ±5 分校准 clamp、重建评分证据链、加权深度维度参与综合分' },
    { key: 'persist', label: '写回深度分析记录', tip: '持久化 result JSON、evaluationStage/scoreCriteria/issueMarkers 列、更新 durationMs' },
  ];
  /** 当前已完成阶段数(0-8,8=AI_ENHANCE_STAGES.length)。进度条按 (stage/stageCount) 渲染,
   *  model_call 阶段权重最大(占总进度的 40%),因此推进到此阶段时暂停更长时间。 */
  const [aiEnhanceStage, _setAiEnhanceStage] = useState(0);
  const aiEnhanceStageRef = useRef(0);
  // 同时支持 setState(值) 与 setState(prev => 值),兼容 stageSchedule 里的 Math.max 合并语义
  const setAiEnhanceStage = (updater: number | ((prev: number) => number)) => {
    if (typeof updater === 'function') {
      _setAiEnhanceStage((prev) => {
        const next = updater(prev);
        aiEnhanceStageRef.current = Number.isFinite(next) ? next : aiEnhanceStageRef.current;
        return aiEnhanceStageRef.current;
      });
      // 函数式更新时同步更新 ref:用 ref.current 自身传入 updater(近似 prev, 避免等下次渲染)
      aiEnhanceStageRef.current = (() => {
        const next = updater(aiEnhanceStageRef.current);
        return Number.isFinite(next) ? next : aiEnhanceStageRef.current;
      })();
    } else {
      const n = Number.isFinite(updater) ? updater : aiEnhanceStageRef.current;
      aiEnhanceStageRef.current = n;
      _setAiEnhanceStage(n);
    }
  };
  const aiEnhanceProgressRef = useRef<number | null>(null);
  const aiEnhanceAbortRef = useRef<AbortController | null>(null);
  /** AI 增强失败详情(从 ApiError.rawData 解析的 aiMeta/debugHint/aiEffectiveTimeoutMs),
   *  非空时在 AI 按钮下方渲染折叠错误详情面板。 */
  type AiEnhanceErrorPayload = {
    aiMeta?: {
      aiSuccess?: boolean;
      aiDurationMs?: number;
      aiFailureReason?: string | null;
      aiModel?: string;
      aiInvokedAt?: string;
      stageTimings?: Record<string, number | undefined>;
      debugHint?: string;
    };
    aiEffectiveTimeoutMs?: number;
  };
  const [aiEnhanceError, setAiEnhanceError] = useState<AiEnhanceErrorPayload | null>(null);
  const [aiEnhanceErrorOpen, setAiEnhanceErrorOpen] = useState(false);
  /* client 模式落库同步状态(2026-08-18 改造:handleAiEnhance 内部负责自动落库,
   *  syncStatus 只用于 setSyncStatus watchDog + smartAnalyze onSyncStatus 回调,
   *  不在 UI 上渲染独立"正在同步"占位块了。) */
  const [, _setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle');
  const [syncRetrying, _setSyncRetrying] = useState(false);
  void syncRetrying;
  /* 2026-08-18 “一直同步服务器”修复:UI 级 30s watchDog。
   * 即使 persistLocalAnalysis Promise 永久 pending(后端连接池卡住/nginx 未关 keepalive),
   * UI 不会永远显示“正在同步…”,到点自动 -> failed,显示重试按钮。
   * syncBailoutRef 负责在 setSyncStatus 变为非 syncing 时清理上一次的计时。 */
  const syncBailoutRef = useRef<number | null>(null);
  const setSyncStatus = (next: 'idle' | 'syncing' | 'synced' | 'failed') => {
    // 先清理旧的 watchDog(不放入 setState 回调内,避免触发 TS 未使用参数 & 双重执行风险)
    if (syncBailoutRef.current !== null) {
      window.clearTimeout(syncBailoutRef.current);
      syncBailoutRef.current = null;
    }
    // 进入 syncing:启动 30s 兜底(只在真正进入时开启)
    if (next === 'syncing') {
      syncBailoutRef.current = window.setTimeout(() => {
        _setSyncStatus((cur) => (cur === 'syncing' ? 'failed' : cur));
      }, 30_000);
    }
    _setSyncStatus(next);
  };
  // 卸载时清 watchDog,避免内存泄漏
  useEffect(() => () => {
    if (syncBailoutRef.current !== null) window.clearTimeout(syncBailoutRef.current);
  }, []);
  /* ====== 问题分析(阶段 3:AI 深度分析后的用户追问) ====== */
  const [showQA, setShowQA] = useState(true);
  const [questionInput, setQuestionInput] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [qaList, setQaList] = useState<AnalysisQAResult[]>([]);
  const qaSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const startTimeRef = useRef<number | null>(null);

  /* ====== 创作草稿 (任务包A) ======
   * draftIdRef: 草稿 ID (ref,供分析 effect 内清理使用,避免依赖闭包陈旧值)
   * draftId:    草稿 ID (state,驱动 UI 显示"已恢复草稿"提示)
   * restoredPreview: 恢复草稿时的缩略图 (用于上传区预览) */
  const draftIdRef = useRef<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [restoredPreview, setRestoredPreview] = useState<string | undefined>(undefined);

  /* 进入页面:检查 URL ?draftId=xxx,命中则恢复草稿状态 (预填表单/缩略图,不重新分析) */
  useEffect(() => {
    try {
      const id = getDraftIdFromUrl();
      if (!id) return;
      const draft = getDraft(id);
      if (!draft) {
        // 草稿已不存在 (已清理),移除 URL 残留 query
        setDraftIdInUrl(null);
        return;
      }
      // 恢复:预填类型 + 缩略图 + draftId (不触发分析)
      if (draft.artworkType === 'painting' || draft.artworkType === 'design'
        || draft.artworkType === 'product' || draft.artworkType === 'sculpture') {
        setSelectedArtType(draft.artworkType);
      }
      draftIdRef.current = draft.id;
      setDraftId(draft.id);
      setRestoredPreview(draft.imagePreview);
      toast.info('已恢复未完成的草稿', '可重新上传图片继续诊断');
    } catch (err) {
      console.warn('恢复草稿失败:', err);
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* URL ?type= 参数变化时同步选择(侧栏快捷入口 /analyze?type=xxx 生效) */
  useEffect(() => {
    const t = searchParams.get('type');
    if (isValidArtType(t) && t !== selectedArtType && step === 'upload') {
      setSelectedArtType(t);
    }
    // 只在 URL 参数实际变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* 监听命令面板派发的 switch-art-type 事件,实时切换类型 */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ artType?: unknown }>).detail;
      if (isValidArtType(detail?.artType) && step === 'upload') {
        setSelectedArtType(detail.artType);
      }
    };
    window.addEventListener('switch-art-type', handler);
    return () => window.removeEventListener('switch-art-type', handler);
  }, [step]);

  /* 用户选择创作类型后,持久化到 localStorage,下次进入默认选中 */
  useEffect(() => {
    writeLastArtType(selectedArtType);
  }, [selectedArtType]);

  /**
   * 图片加载完成后:创建草稿 + 进入分析
   * - 压缩为 200x200 缩略图存入草稿 (避免 LocalStorage 撑爆)
   * - 若存在旧草稿 (恢复后重新上传),先删除旧草稿
   * - 创建后更新 URL ?draftId=xxx,分析完成时清除
   * 全程 try/catch,失败只 console.warn 不阻塞分析主流程
   */
  const beginAnalysisWithImage = useCallback(async (_file: File, dataUrl: string) => {
    setImageUrl(dataUrl);
    setRestoredPreview(undefined);
    try {
      if (user && tenant) {
        const thumb = await compressImageToThumbnail(dataUrl, 200);
        const draft = createDraft({
          tenantId: tenant.id,
          userId: user.id,
          title: `未命名作品_${Date.now()}`,
          artworkType: selectedArtType,
          imagePreview: thumb,
        });
        if (draft) {
          // 恢复场景重新上传:清理旧草稿
          if (draftIdRef.current && draftIdRef.current !== draft.id) {
            try { deleteDraft(draftIdRef.current); } catch (e) { console.warn('清理旧草稿失败:', e); }
          }
          draftIdRef.current = draft.id;
          setDraftId(draft.id);
          setDraftIdInUrl(draft.id);
          try { updateDraft(draft.id, { status: 'analyzing' }); } catch (e) { console.warn('更新草稿状态失败:', e); }
        }
      }
    } catch (err) {
      console.warn('创建草稿失败:', err);
    }
    setStep('analyzing');
    setProgress(0);
    setDetailIndex(0);
  }, [user, tenant, selectedArtType]);

  /* 根据 progress 计算当前阶段（0-4），每 20% 切换一个阶段 */
  const currentStage = Math.min(4, Math.floor(progress / 20));

  /* 阶段切换时重置 detailIndex，让新阶段从第一句描述开始 */
  useEffect(() => {
    setDetailIndex(0);
  }, [currentStage]);

  /* 文件校验：仅允许 JPG/PNG，最大 10MB；失败时通过 Toast 提示并返回 false */
  const validateFile = useCallback((file: File): boolean => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('图片格式不支持', '仅支持 JPG / PNG 格式');
      return false;
    }
    const maxSize = 10 * 1024 * 1024; /* 10MB */
    if (file.size > maxSize) {
      toast.error('图片超过 10MB 限制', `当前 ${(file.size / 1024 / 1024).toFixed(1)}MB，请压缩后重试`);
      return false;
    }
    return true;
  }, [toast]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && validateFile(file)) {
      fileRef.current = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        /* 委托给 beginAnalysisWithImage:压缩缩略图 + 创建草稿 + 进入分析 */
        void beginAnalysisWithImage(file, dataUrl);
      };
      reader.readAsDataURL(file);
    }
    /* 重置 input value，允许再次选择同一文件（校验失败后可重选） */
    event.target.value = '';
  }, [validateFile, beginAnalysisWithImage]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && validateFile(file)) {
      fileRef.current = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        void beginAnalysisWithImage(file, dataUrl);
      };
      reader.readAsDataURL(file);
    }
  }, [validateFile, beginAnalysisWithImage]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  /* 粘贴图片支持（Ctrl+V）：仅在 upload 步骤生效，自动校验后进入分析 */
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (step !== 'upload') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            if (!validateFile(file)) return;
            e.preventDefault();
            fileRef.current = file;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target?.result as string;
              void beginAnalysisWithImage(file, dataUrl);
            };
            reader.readAsDataURL(file);
            toast.info('已粘贴图片', '正在准备分析...');
            return;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [step, toast, validateFile, beginAnalysisWithImage]);

  useEffect(() => {
    if (step === 'analyzing') {
      let completed = false;
      /* 记录分析开始时间，用于结果页展示总耗时 */
      startTimeRef.current = Date.now();
      setAnalysisDuration(null);

      /* 进度推进定时器：每 60ms 推进 1%，到 95% 后等待真实分析完成再冲到 100%
         总时长约 5.7s（95% × 60ms），与 smartAnalyze 的实际耗时大致匹配 */
      const progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 95) return prev;            /* 等待真实分析完成 */
          return Math.min(95, prev + 1);
        });
      }, 60);

      /* 详情文字轮播：每 600ms 切换一句，在当前阶段的专业描述组内循环
         从 progress 实时计算 stage，避免 ref 同步 */
      const detailTimer = setInterval(() => {
        setProgress((prevProgress) => {
          const stage = Math.min(4, Math.floor(prevProgress / 20));
          const list = getStageDetails(stage, selectedArtType, heritageCategory);
          setDetailIndex((prev) => (prev + 1) % (list.length || 1));
          return prevProgress;  /* 不修改 progress，只用于读取最新值 */
        });
      }, 600);

      const processResult = async (analysisResult: AnalysisResult) => {
        if (completed) return;
        completed = true;
        clearInterval(progressTimer);
        clearInterval(detailTimer);
        /* 真实分析完成，进度冲到 100% */
        setProgress(100);
        /* 计算并保存分析总耗时（毫秒），结果页显示为秒 */
        setAnalysisDuration(Date.now() - (startTimeRef.current ?? Date.now()));
        /* 异步保存到 data-service(API 优先,失败回退 LocalStorage),不阻塞 UI 切换 */
        try {
          await saveAnalysis(analysisResult);
        } catch (err) {
          console.error('保存分析结果失败:', err);
          toastRef.current.warning('诊断结果已生成,但保存到历史记录失败', '可在本地继续查看,刷新页面后可能丢失');
        }
        /* 分析成功:清理草稿 + 清除 URL query (任务包A) */
        if (draftIdRef.current) {
          try { deleteDraft(draftIdRef.current); } catch (e) { console.warn('清理草稿失败:', e); }
          draftIdRef.current = null;
          setDraftId(null);
          setDraftIdInUrl(null);
        }
        /* 短暂展示 100% 完成态，再切换到结果页 */
        setTimeout(() => {
          setResult(analysisResult);
          setStep('result');
          toastRef.current.success('分析完成', '诊断报告已生成并保存到历史记录');
        }, 400);
      };

      const handleError = (error: unknown) => {
        console.error('分析失败:', error);
        if (!completed) {
          completed = true;
          clearInterval(progressTimer);
          clearInterval(detailTimer);
          toastRef.current.error('图像分析失败', '请检查图片或网络后重试');
          /* 分析失败:保留草稿 (任务包A),状态回退为 draft 以便工作台显示"继续创作" */
          if (draftIdRef.current) {
            try { updateDraft(draftIdRef.current, { status: 'draft' }); } catch (e) { console.warn('更新草稿状态失败:', e); }
          }
          setStep('upload');
          setImageUrl('');
          setAnalysisDecision(null);
          setAnalysisDuration(null);
          startTimeRef.current = null;
        }
      };

      smartAnalyze(fileRef.current, imageUrl, selectedArtType, (decision) => {
        setAnalysisDecision(decision);
      }, {
        diagnosisMode,
        examSubject,
        /* client 模式非阻塞落库完成:将本地临时 `analysis-*` ID 替换为后端
         * 真实记录 ID,AI 深度分析/分享按钮随即可用(函数式更新防竞态:
         * 仅当当前结果仍是本次本地临时结果时才替换) */
        onRecordId: (recordId) => {
          setResult((prev) =>
            prev && prev.id.startsWith('analysis-') ? { ...prev, id: recordId } : prev
          );
        },
        /* 2026-08-16 体验修复:落库状态透传,结果页据此显示同步占位/失败重试 */
        onSyncStatus: (status) => setSyncStatus(status),
      })
        .then(processResult)
        .catch(handleError);

      return () => {
        completed = true;
        clearInterval(progressTimer);
        clearInterval(detailTimer);
      };
    }
  }, [step, imageUrl, selectedArtType, diagnosisMode, examSubject, heritageCategory]);

  const handleRetry = () => {
    /* 重置:清理草稿 + 清除 URL + 清除恢复预览 (任务包A) */
    if (draftIdRef.current) {
      try { deleteDraft(draftIdRef.current); } catch (e) { console.warn('清理草稿失败:', e); }
      draftIdRef.current = null;
      setDraftId(null);
      setDraftIdInUrl(null);
    }
    setRestoredPreview(undefined);
    setStep('upload');
    setImageUrl('');
    setResult(null);
    setAnalysisDecision(null);
    setAnalysisDuration(null);
    setShowTypeSwitcher(false);
    startTimeRef.current = null;
  };

  /* 阶段 2:对已有分析结果触发 AI 深度增强分析。
   * 2026-08-18 体验改造:无论当前 result.id 是「后端真实 UUID」还是「本地临时 analysis-*」,
   * 一律允许直接点按钮。若为临时 ID,在本函数内先静默落库(阶段 0 "同步诊断记录"),拿到真实
   * UUID 后立刻继续调 AI,对用户只呈现「一个 8 阶段进度条」。
   * P0 黑盒修复继承:
   *   - 前端 AbortController 中断 + request.timeoutMs=180s 双层超时
   *   - setInterval 驱动 8 阶段进度条推进(model_call 阶段占更长时间)
   *   - 失败时解析 ApiError.rawData → aiMeta/debugHint/aiEffectiveTimeoutMs 渲染折叠面板 */
  const handleAiEnhance = useCallback(async () => {
    if (!result || !result.id || result.aiEnhanced === true || aiEnhanceLoading) return;
    // 清理之前的失败态
    setAiEnhanceError(null);
    setAiEnhanceErrorOpen(false);
    setAiEnhanceStage(0);
    setAiEnhanceLoading(true);

    // 前端 AbortController:用户离开页面/重复触发时可取消(避免长请求挂住)
    const aborter = new AbortController();
    aiEnhanceAbortRef.current?.abort();
    aiEnhanceAbortRef.current = aborter;

    // 进度推进定时器:8 阶段按权重分配时间(阶段 0="同步诊断记录"→1)
    //   同步诊断记录 → ~1.5s(通常 300ms-1s,留余量)
    //   metrics_extract/prompt_build → 约 400ms 各
    //   image_preprocess → 约 600ms
    //   model_call → 最长,约 10-15s
    //   result_parse/result_merge/persist → 约 400ms 各
    const stageSchedule: [number, number][] = [
      // [targetStageIdx(已完成 N 阶段,1..8), delayMs]
      [1, 200],     // 快速亮灯:表示「同步诊断记录」已开始
      [2, 1600],    // 同步完成(通常 <1s,给 1.4s 余量)→ 进入 metrics_extract
      [3, 2200],    // prompt_build
      [4, 2800],    // image_preprocess
      // model_call 长阶段,分步推进:实际阶段仍 4(未完成),显示推进
      [4, 4500],
      [4, 7500],
      [4, 11000],
      [5, 14500],   // result_parse
      [6, 15300],   // result_merge
      [7, 15900],   // persist(写回 AI 增强结果)
      [8, 16500],   // 全流程假完成:兜底,真实成功会提前跳到 8
    ];
    const timers: number[] = [];
    stageSchedule.forEach(([targetStage, delay]) => {
      const h = window.setTimeout(() => {
        if (!aborter.signal.aborted) {
          setAiEnhanceStage((prev) => Math.max(prev, targetStage));
        }
      }, delay);
      timers.push(h);
    });
    const clearTimers = () => {
      timers.forEach((h) => window.clearTimeout(h));
      if (aiEnhanceProgressRef.current !== null) {
        window.clearInterval(aiEnhanceProgressRef.current);
        aiEnhanceProgressRef.current = null;
      }
    };

    try {
      // ===== 改造核心:如果是本地临时 analysis-* ID,先落库拿真实 UUID,再继续 AI 调用 =====
      let effectiveId = result.id;
      if (effectiveId.startsWith('analysis-')) {
        const file = fileRef.current;
        if (!file) {
          throw new Error('需要重新选择图片，才能把当前诊断同步到服务器并继续 AI 深度分析');
        }
        setSyncStatus('syncing');
        try {
          const recordId = await persistLocalAnalysis(file, selectedArtType, { diagnosisMode, examSubject });
          effectiveId = recordId;
          // 替换当前结果 id(后续 AI 增强请求、分享、成长曲线都用这个真实 ID)
          setResult((prev) =>
            prev && prev.id.startsWith('analysis-') ? { ...prev, id: recordId } : prev
          );
          setSyncStatus('synced');
          // 同步提前完成,把进度推到「同步阶段结束」=1（真实成功直接跳到 1,跳过假进度后面的 200ms 延迟）
          setAiEnhanceStage((prev) => Math.max(prev, 1));
        } catch (e) {
          setSyncStatus('failed');
          const msg = e instanceof Error ? e.message : '诊断记录同步失败';
          throw new Error(`诊断记录同步失败:${msg}，可点击重试再次尝试`);
        }
      }

      // 2026-08-18 超时修复:前端硬超时从 20s 提升到 180s(后端默认 60s,留 3x 余量)
      //  修复"进度条已经 100% 还是报超过 20 秒失败":此前前端 20s 比 glm-4v 实测 50s 短,
      //  后端实际返回但前端已经 abort 吞了结果。
      const enhanced = await aiEnhanceAnalysis(effectiveId, selectedArtType, { timeoutMs: 180000 });
      // 成功:推进到满阶段(8),替换 result,toast 成功
      setAiEnhanceStage(AI_ENHANCE_STAGES.length);
      setResult(enhanced);
      toast.success('AI 深度分析完成', '已融合视觉模型增强诊断');
    } catch (err) {
      // 解析 ApiError.rawData(aiMeta/aiEffectiveTimeoutMs/debugHint),落入折叠错误面板
      let errPayload: AiEnhanceErrorPayload | null = null;
      let message = err instanceof Error ? err.message : 'AI 深度分析失败，请稍后重试';
      if (err instanceof ApiError) {
        const raw = err.rawData as AiEnhanceErrorPayload | undefined;
        if (raw && (raw.aiMeta || typeof raw.aiEffectiveTimeoutMs === 'number')) {
          errPayload = raw;
        }
        // 408/超时类:提示可重试;其他错误保留原 message
        if (err.httpStatus === 408 && !message.includes('超时')) {
          message = `AI 深度分析超时(${message})`;
        }
        // 纯前端超时(axios/AbortController 本地触发,httpStatus=undefined):
        //  若 8 阶段进度条已到尾(≥7),用户会看到"跑满却仍失败"的反直觉体验,
        //  给出更具体的"模型排队或网络慢,建议重试"文案
        if (typeof err.httpStatus !== 'number' && /超时|timeout|abort/i.test(message)) {
          if (aiEnhanceStageRef.current >= AI_ENHANCE_STAGES.length - 1) {
            message = 'AI 视觉模型排队或响应较慢，已接近完成，可立即重试一次。' +
              (errPayload?.aiEffectiveTimeoutMs ? `（服务端设置上限 ${Math.round(errPayload.aiEffectiveTimeoutMs/1000)} 秒）` : '');
          } else {
            message = 'AI 视觉模型响应超时，可重试；若持续缓慢请稍后再试。';
          }
        }
      } else if (err instanceof Error && /超时|timeout|abort/i.test(err.message)) {
        // 非 ApiError 的超时(如 request 封装直接抛出 Error)
        if (aiEnhanceStageRef.current >= AI_ENHANCE_STAGES.length - 1) {
          message = 'AI 视觉模型接近完成但未能及时返回，可立即重试一次';
        } else {
          message = 'AI 视觉模型响应超时，建议重试';
        }
      }
      setAiEnhanceError(errPayload);
      // 有详细 debugHint 时默认展开错误面板
      setAiEnhanceErrorOpen(Boolean(errPayload?.aiMeta?.debugHint));
      toast.error('AI 深度分析失败', message);
    } finally {
      clearTimers();
      aborter.abort();
      if (aiEnhanceAbortRef.current === aborter) aiEnhanceAbortRef.current = null;
      setAiEnhanceLoading(false);
    }
  }, [result, aiEnhanceLoading, selectedArtType, toast, diagnosisMode, examSubject, AI_ENHANCE_STAGES.length]);

  /* 阶段 3:问题分析 —— 就诊断结果向 AI 提问。
   * 前置:结果已 aiEnhanced 且携带后端记录 id(否则后端 409)。
   * 成功:追加到 qaList 顶部;失败:toast 错误,不动已有问答。 */
  const handleAskQuestion = async () => {
    if (!result || !result.id || result.aiEnhanced !== true || askLoading) return;
    const q = questionInput.trim();
    if (q.length < 10) {
      toast.error('问题太短了', '请至少输入 10 个字,便于 AI 聚焦解答');
      return;
    }
    setAskLoading(true);
    try {
      const qa = await askAnalysisQuestion(result.id, q);
      setQaList((prev) => [qa, ...prev]);
      setQuestionInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '问题分析失败，请稍后重试';
      toast.error('问题分析失败', message);
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
            智绘镜
          </h1>
          <p className="text-ink-600">智能感知作品复杂度，自动选择最优分析方案</p>
        </div>

        {step === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-6">
              <h3 className="font-serif text-lg font-bold text-ink-900 mb-3 text-center">
                选择创作类型
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {artTypes.map((art) => {
                  const Icon = art.icon;
                  const isSelected = selectedArtType === art.id;
                  return (
                    <button
                      key={art.id}
                      onClick={() => setSelectedArtType(art.id)}
                      aria-label={art.name}
                      className={`p-4 rounded-xl text-center transition-all ${
                        isSelected
                          ? 'bg-cinnabar text-white shadow-card'
                          : 'bg-white text-ink-700 shadow-card hover:shadow-card-hover'
                      }`}
                    >
                      <Icon className="w-6 h-6 mx-auto mb-2" />
                      <p className="font-medium text-sm">{art.name}</p>
                      <p className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-ink-500'}`}>
                        {art.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
              {/* Task 14.5:非遗类目选择器(仅 selectedArtType==='heritage' 时显示) */}
              {selectedArtType === 'heritage' && (
                <HeritageCategoryPicker value={heritageCategory} onChange={setHeritageCategory} />
              )}
              {/* 上次选择记忆提示 */}
              {readLastArtType() !== null && (() => {
                const last = readLastArtType();
                const lastArt = artTypes.find((a) => a.id === last);
                if (!lastArt || lastArt.id === selectedArtType) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setSelectedArtType(lastArt.id)}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 text-xs text-ink-600 bg-gold/5 hover:bg-gold/10 border border-gold/20 rounded-lg transition-colors group"
                  >
                    <HistoryIcon className="w-3.5 h-3.5 text-gold-dark" />
                    <span>上次诊断使用 <span className="font-semibold text-gold-dark">{lastArt.name}</span>，点击切回</span>
                    <ArrowRight className="w-3 h-3 text-ink-400 group-hover:text-gold-dark group-hover:translate-x-0.5 transition-all" />
                  </button>
                );
              })()}
              {(() => {
                const current = artTypes.find((a) => a.id === selectedArtType);
                if (!current) return null;
                return (
                  <p className="mt-2 text-center text-2xs text-ink-400">
                    已为你选中 <span className="text-cinnabar font-medium">{current.name}</span>
                    {readLastArtType() === selectedArtType && <> · 记住你的选择</>}
                  </p>
                );
              })()}
            </div>

            {/* 诊断模式切换(2026-08-16 诊断理念重构):教学诊断 vs 艺考诊断 */}
            <div className="mb-6">
              <h3 className="font-serif text-lg font-bold text-ink-900 mb-3 text-center">
                选择诊断模式
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="诊断模式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={diagnosisMode === 'teaching'}
                  onClick={() => handleModeChange('teaching')}
                  className={`p-4 rounded-xl text-left transition-all ${
                    diagnosisMode === 'teaching'
                      ? 'bg-cinnabar text-white shadow-card'
                      : 'bg-white text-ink-700 shadow-card hover:shadow-card-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <GraduationCap className="w-5 h-5 flex-shrink-0" />
                    <p className="font-medium text-sm">教学诊断</p>
                  </div>
                  <p className={`text-xs leading-relaxed ${diagnosisMode === 'teaching' ? 'text-white/85' : 'text-ink-500'}`}>
                    像老师在画架旁 1 对 1 辅导:看完整度、画面关系,顺着你的风格给出下一步建议
                  </p>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={diagnosisMode === 'exam'}
                  onClick={() => handleModeChange('exam')}
                  className={`p-4 rounded-xl text-left transition-all ${
                    diagnosisMode === 'exam'
                      ? 'bg-cinnabar text-white shadow-card'
                      : 'bg-white text-ink-700 shadow-card hover:shadow-card-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Award className="w-5 h-5 flex-shrink-0" />
                    <p className="font-medium text-sm">艺考诊断</p>
                  </div>
                  <p className={`text-xs leading-relaxed ${diagnosisMode === 'exam' ? 'text-white/85' : 'text-ink-500'}`}>
                    面向美术生:按联考阅卷标准客观分档,给出扣分点与升档提分策略
                  </p>
                </button>
              </div>

              {/* 艺考科目选择(仅 exam 模式) */}
              {diagnosisMode === 'exam' && (
                <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                  <span className="text-xs text-ink-500 mr-1">考试科目</span>
                  {(Object.keys(EXAM_SUBJECT_LABEL) as ExamSubject[]).map((subject) => (
                    <button
                      key={subject}
                      type="button"
                      onClick={() => setExamSubject(subject)}
                      aria-pressed={examSubject === subject}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                        examSubject === subject
                          ? 'bg-ink-900 text-rice-100 shadow-card'
                          : 'bg-rice-50 text-ink-600 border border-ink-900/10 hover:border-ink-900/30'
                      }`}
                    >
                      {EXAM_SUBJECT_LABEL[subject]}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-center text-2xs text-ink-400">
                {diagnosisMode === 'exam'
                  ? `将按「${EXAM_SUBJECT_LABEL[examSubject]}」联考评分标准诊断 · AI 深度分析后给出档位评定`
                  : '诊断以作品完整度与个性化建议为主,分数仅作阶段参考'}
              </p>
            </div>

            <div className="mb-6">
              <div className="bg-rice-50 rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3 mb-3">
                  <Zap className="w-5 h-5 text-cinnabar" />
                  <h3 className="font-serif text-base font-bold text-ink-900">智能分析引擎</h3>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-rice-50 rounded-lg p-3">
                    <Cpu className="w-5 h-5 text-ink-600 mx-auto mb-1" />
                    <p className="text-xs text-ink-500">简单作品</p>
                    <p className="text-xs font-medium text-jade">本地分析</p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3">
                    <Zap className="w-5 h-5 text-gold mx-auto mb-1" />
                    <p className="text-xs text-ink-500">中等复杂度</p>
                    <p className="text-xs font-medium text-gold">智能选择</p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3">
                    <Cloud className="w-5 h-5 text-cinnabar mx-auto mb-1" />
                    <p className="text-xs text-ink-500">复杂作品</p>
                    <p className="text-xs font-medium text-cinnabar">后端分析</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 已恢复草稿提示 (任务包A):显示缩略图 + 类型,可放弃草稿重新开始 */}
            {draftId && restoredPreview && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-cinnabar/5 border border-cinnabar/20 rounded-xl">
                {restoredPreview ? (
                  <img
                    src={restoredPreview}
                    alt="草稿缩略图"
                    loading="lazy"
                    className="w-14 h-14 rounded-md object-cover border border-ink-900/10 flex-shrink-0"
                  />
                ) : null}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">已恢复未完成的草稿</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    类型:{artTypes.find((a) => a.id === selectedArtType)?.name} · 可重新上传继续诊断
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRetry();
                  }}
                  className="text-xs text-ink-500 hover:text-cinnabar transition-colors flex-shrink-0 px-2 py-1"
                >
                  放弃草稿
                </button>
              </div>
            )}

            <div
              className="border-2 border-dashed border-ink-300 rounded-2xl p-12 text-center cursor-pointer hover:border-cinnabar hover:bg-cinnabar/5 transition-all duration-300"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="w-20 h-20 bg-ink-900/5 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="w-10 h-10 text-ink-500" />
              </div>
              <h3 className="font-serif text-xl font-semibold text-ink-900 mb-2">
                点击或拖拽上传{artTypes.find(a => a.id === selectedArtType)?.name}作品
              </h3>
              <p className="text-ink-500 mb-4">支持 JPG、PNG 格式 · 可拖拽或 Ctrl+V 粘贴</p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900 text-rice-100 rounded-lg">
                <span className="font-medium">选择文件</span>
              </div>
            </div>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="max-w-3xl mx-auto">
            {/* === 顶部：作品 + 扫描线 + 中央进度环 === */}
            <div className="bg-rice-50 rounded-2xl overflow-hidden shadow-card">
              <div className="relative">
                <img
                  src={imageUrl}
                  alt="上传的作品"
                  loading="lazy"
                  className="w-full max-h-96 object-contain"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.img-fallback')) {
                      const fallback = document.createElement('div');
                      fallback.className = 'img-fallback w-full h-48 bg-ink-100 flex items-center justify-center text-ink-400 text-sm';
                      fallback.textContent = '图片加载失败';
                      parent.insertBefore(fallback, target);
                    }
                  }}
                />
                {/* 半透明遮罩 + 扫描线（仅分析进行中显示，100% 时隐藏） */}
                {progress < 100 && (
                  <>
                    <div className="absolute inset-0 bg-ink-900/40" />
                    {/* AI 扫描线：从上到下循环移动 */}
                    <div className="absolute inset-x-0 scan-line-animation pointer-events-none">
                      <div className="h-0.5 bg-gradient-to-r from-transparent via-cinnabar to-transparent shadow-[0_0_12px_rgba(196,30,58,0.8)]" />
                      <div className="h-8 bg-gradient-to-b from-cinnabar/20 to-transparent" />
                    </div>
                  </>
                )}

                {/* 中央：大号进度百分比 + 当前阶段名 */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="font-serif text-6xl font-bold text-white tabular-nums tracking-tight drop-shadow-lg">
                    {progress}<span className="text-3xl">%</span>
                  </p>
                  <p className="font-serif text-xl text-rice-100 mt-2 drop-shadow">
                    {ANALYSIS_STAGES[currentStage].name}
                  </p>
                  {analysisDecision && (
                    <div className="mt-3 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 inline-flex items-center gap-1.5">
                      {analysisDecision.mode === 'server' ? (
                        <Cloud className="w-3 h-3 text-rice-100" />
                      ) : (
                        <Cpu className="w-3 h-3 text-rice-100" />
                      )}
                      <span className="text-xs text-rice-100">
                        {analysisDecision.mode === 'server' ? '后端深度学习分析' : '本地智能分析'}
                      </span>
                    </div>
                  )}
                </div>

                {/* 完成态标记 */}
                {progress === 100 && (
                  <div className="absolute top-4 right-4 bg-jade/90 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span className="text-xs text-white font-medium">分析完成</span>
                  </div>
                )}
              </div>

              {/* === 进度条（带流光高光） === */}
              <div className="px-6 py-4 border-t border-ink-900/6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-ink-500">
                    {progress < 100 ? '正在分析' : '分析完成'}
                  </span>
                  <span className="text-xs font-mono text-ink-500 tabular-nums">{progress}/100</span>
                </div>
                <div className="relative h-2 bg-ink-900/8 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-cinnabar to-cinnabar-dark rounded-full transition-all duration-150 ease-out"
                    style={{ width: `${progress}%` }}
                  >
                    {/* 进度条流光 */}
                    {progress < 100 && (
                      <div className="absolute inset-0 overflow-hidden rounded-full">
                        <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent progress-shine-animation" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* === 5 阶段流水线卡片 === */}
            <div className="mt-6 grid grid-cols-5 gap-2">
              {ANALYSIS_STAGES.map((stage, i) => {
                const Icon = stage.icon;
                const isDone = i < currentStage || progress === 100;
                const isActive = i === currentStage && progress < 100;
                const isPending = i > currentStage;
                return (
                  <div
                    key={stage.id}
                    className={[
                      'relative rounded-xl p-3 text-center border transition-all duration-300',
                      isDone
                        ? 'bg-jade/8 border-jade/30'
                        : isActive
                        ? 'bg-cinnabar/10 border-cinnabar/40 stage-pulse-animation'
                        : 'bg-rice-50 border-ink-900/6 opacity-60',
                    ].join(' ')}
                  >
                    <div className="flex justify-center mb-2">
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-jade" />
                      ) : isActive ? (
                        <Loader2 className={`w-5 h-5 text-cinnabar animate-spin`} />
                      ) : (
                        <Icon className={`w-5 h-5 ${isPending ? 'text-ink-400' : 'text-ink-500'}`} />
                      )}
                    </div>
                    <p className={`text-xs font-medium ${isDone ? 'text-jade' : isActive ? 'text-cinnabar' : 'text-ink-500'}`}>
                      {stage.name}
                    </p>
                    <p className="text-2xs text-ink-400 mt-0.5 hidden sm:block">{stage.desc}</p>
                  </div>
                );
              })}
            </div>

            {/* === 实时专业术语描述（按阶段 + 艺术类型自适应，轮播淡入） === */}
            {(() => {
              const stageDetails = getStageDetails(currentStage, selectedArtType, heritageCategory);
              const currentDetail = stageDetails[detailIndex % (stageDetails.length || 1)] || '';
              const StageIcon = ANALYSIS_STAGES[currentStage].icon;
              return (
                <div className="mt-4 bg-rice-50 border border-ink-900/6 rounded-xl overflow-hidden">
                  {/* 阶段标题栏 */}
                  <div className="px-4 py-2 bg-ink-900/[0.03] border-b border-ink-900/6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StageIcon className="w-3.5 h-3.5 text-cinnabar" />
                      <span className="text-xs font-medium text-ink-700">
                        阶段 {currentStage + 1}/5 · {ANALYSIS_STAGES[currentStage].name}
                      </span>
                    </div>
                    <span className="text-2xs font-mono text-ink-400">
                      {String((detailIndex % (stageDetails.length || 1)) + 1).padStart(2, '0')}/{String(stageDetails.length).padStart(2, '0')}
                    </span>
                  </div>
                  {/* 当前专业描述文字（轮播淡入） */}
                  <div className="px-4 py-3 flex items-center gap-3">
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-cinnabar opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cinnabar" />
                    </span>
                    <p
                      key={`${currentStage}-${detailIndex}`}
                      className="text-sm text-ink-700 detail-fade-animation flex-1 truncate font-medium"
                    >
                      {currentDetail}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* === 维度小预览(保持原有信息架构;非遗时按类目展示 4 维专属工艺标准) === */}
            {selectedArtType === 'heritage' ? (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {HERITAGE_DIMENSIONS[heritageCategory].map((label, i) => (
                  <div key={label} className="bg-rice-50 rounded-xl p-3 text-center border border-ink-900/6">
                    <Gem className={`w-5 h-5 ${i % 2 === 0 ? 'text-gold' : 'text-cinnabar'} mx-auto mb-1.5`} />
                    <p className="text-xs text-ink-700 font-medium">{label}</p>
                    <div className="mt-2 h-1 bg-ink-900/8 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${i % 2 === 0 ? 'bg-gold' : 'bg-cinnabar'} rounded-full transition-all duration-500 ease-out`}
                        style={{ width: `${Math.min(100, progress + i * 5)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {ANALYSIS_CONFIG[selectedArtType].dimensions.map((dim, i) => {
                  const Icon = dim.icon;
                  return (
                    <div key={i} className="bg-rice-50 rounded-xl p-3 text-center border border-ink-900/6">
                      <Icon className={`w-5 h-5 ${dim.color} mx-auto mb-1.5`} />
                      <p className="text-xs text-ink-500">{dim.label}</p>
                      <div className="mt-2 h-1 bg-ink-900/8 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${dim.barColor} rounded-full transition-all duration-500 ease-out`}
                          style={{ width: `${Math.min(100, progress + i * 5)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-8">
            {/* 非遗诊断:当前类目徽章 + 类目专属工艺标准四维标签条 */}
            {result.artType === 'heritage' && (
              <div className="bg-gold/5 border border-gold/25 rounded-xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gold-dark text-white text-xs font-medium">
                    <Gem className="w-3 h-3" />
                    非遗 · {HERITAGE_CATEGORIES.find((c) => c.id === heritageCategory)?.name ?? '剪纸'}
                  </span>
                  <span className="text-xs text-ink-500">类目专属工艺评估标准</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {HERITAGE_DIMENSIONS[heritageCategory].map((d) => (
                    <span key={d} className="px-3 py-1 rounded-full bg-white border border-gold/40 text-xs font-medium text-ink-700 shadow-sm">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 结果页标题 + 分析耗时 */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-serif text-2xl font-bold text-ink-900">诊断报告</h2>
                {/* Task 14.1:评价阶段徽章(仅 aiEnhanced 深度分析且携带 evaluationStage 时渲染) */}
                {(() => {
                  if (result.aiEnhanced !== true) return null;
                  const stage = result.evaluationStage;
                  if (!stage) return null;
                  const meta = EVALUATION_STAGE_META[stage];
                  if (!meta) return null;
                  const toneCls = meta.tone === 'cinnabar'
                    ? 'bg-cinnabar/10 border-cinnabar/30 text-cinnabar'
                    : 'bg-jade/10 border-jade/30 text-jade';
                  return (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${toneCls}`}
                      title={`AI 深度分析 · ${meta.label}参照系`}
                    >
                      <Sparkles className="w-3 h-3" />
                      AI 深度 · {meta.label}
                    </span>
                  );
                })()}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {analysisDuration !== null && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cinnabar/5 border border-cinnabar/20 rounded-full">
                    <Zap className="w-3 h-3 text-cinnabar" />
                    <span className="text-xs font-medium text-cinnabar">
                      分析耗时 <span className="font-mono tabular-nums">{(analysisDuration / 1000).toFixed(1)}s</span>
                    </span>
                  </div>
                )}
                {/* 阶段 2:AI 深度分析触发按钮(2026-08-18 改造:永远允许点,不看 id 类型)
                    若当前为本地临时 analysis-* ID,点击后会在 handleAiEnhance 内部先自动落库
                    (阶段 0 "同步诊断记录到服务器"),拿 UUID 后再继续调用 AI,用户零感知。 */}
                {result.aiEnhanced !== true && result.id && (
                  <button
                    type="button"
                    onClick={handleAiEnhance}
                    disabled={aiEnhanceLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-cinnabar/10 border border-cinnabar/30 rounded-full transition-colors hover:bg-cinnabar/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    title="调用 AI 视觉模型对当前结果进行深度增强分析(任何状态下都可直接触发)"
                  >
                    {aiEnhanceLoading ? (
                      <Loader2 className="w-3 h-3 text-cinnabar animate-spin" />
                    ) : (
                      <Brain className="w-3 h-3 text-cinnabar" />
                    )}
                    <span className="text-xs font-medium text-cinnabar">
                      {aiEnhanceLoading ? 'AI 分析中…' : 'AI 深度分析'}
                    </span>
                  </button>
                )}
                {/* Phase F1:可观测性元信息徽章 */}
                {result.aiEnhanced === true && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#5a8a7a]/10 border border-[#5a8a7a]/30 rounded-full" title="本次分析经过 AI 视觉模型增强">
                    <Brain className="w-3 h-3 text-[#5a8a7a]" />
                    <span className="text-xs font-medium text-[#5a8a7a]">AI 增强</span>
                  </div>
                )}
                {/* 阶段 3:问题分析入口(仅 AI 深度分析完成 + 后端记录时可用),点击展开问答区并滚动定位 */}
                {result.aiEnhanced === true && result.id && !result.id.startsWith('analysis-') && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowQA(true);
                      requestAnimationFrame(() => qaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-gold/10 border border-gold/40 rounded-full transition-colors hover:bg-gold/20"
                    title="就诊断结果向 AI 提问,获取定向解答"
                  >
                    <MessageCircleQuestion className="w-3 h-3 text-gold-dark" />
                    <span className="text-xs font-medium text-gold-dark">问题分析</span>
                  </button>
                )}
                {/* 作品有效性校验:非作品图片时展示 来源识别 → 来历分析 → 二创判断 链路 */}
                {result.artworkCheck?.status === 'mismatch' && (() => {
                  const ac = result.artworkCheck!;
                  const DERIV_LABEL: Record<string, string> = {
                    derivative: '疑似二创',
                    transfer: '原样搬运',
                    uncertain: '二创存疑',
                  };
                  const derivTag = ac.derivativeJudgment ? DERIV_LABEL[ac.derivativeJudgment] : null;
                  const derivStyle =
                    ac.derivativeJudgment === 'derivative'
                      ? 'bg-gold/15 text-gold border-gold/40'
                      : ac.derivativeJudgment === 'transfer'
                        ? 'bg-ink-900/10 text-ink-700 border-ink-900/25'
                        : 'bg-ink-900/5 text-ink-500 border-ink-900/15';
                  const guidance =
                    ac.derivativeJudgment === 'derivative'
                      ? '画面含再创作成分,以下分析聚焦二创部分的改动与质量'
                      : ac.derivativeJudgment === 'transfer'
                        ? '该图无作者创作成分,无法作为作品诊断,建议上传自己的作品'
                        : '以下分析基于实际画面内容,建议上传真实作品重新诊断';
                  return (
                    <div className="w-full px-4 py-3 bg-cinnabar/10 border border-cinnabar/40 rounded-xl text-left">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-cinnabar flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-cinnabar">
                            图片可能不是有效的{result.artType === 'painting' ? '绘画' : result.artType === 'design' ? '设计' : result.artType === 'product' ? '产品设计' : '雕塑'}作品
                          </p>
                          <p className="text-xs text-ink-700 mt-0.5">
                            AI 识别为「{ac.actualType || '非作品图片'}」{ac.reason ? `:${ac.reason}` : ''}
                          </p>
                        </div>
                      </div>
                      {(ac.sourceIdentification || ac.provenanceAnalysis || derivTag) && (
                        <div className="mt-2.5 pt-2.5 border-t border-cinnabar/25 space-y-1.5">
                          {ac.sourceIdentification && (
                            <p className="text-xs text-ink-600 flex gap-1.5">
                              <span className="text-ink-400 flex-shrink-0">来源</span>
                              {ac.sourceIdentification}
                            </p>
                          )}
                          {ac.provenanceAnalysis && (
                            <p className="text-xs text-ink-600 flex gap-1.5">
                              <span className="text-ink-400 flex-shrink-0">来历</span>
                              {ac.provenanceAnalysis}
                            </p>
                          )}
                          {derivTag && (
                            <p className="text-xs flex gap-1.5 items-start">
                              <span className={`px-1.5 py-0.5 rounded border text-2xs flex-shrink-0 ${derivStyle}`}>{derivTag}</span>
                              <span className="text-ink-600">{ac.derivativeNote || (ac.derivativeJudgment === 'derivative' ? '画面含手绘/合成等再创作痕迹' : ac.derivativeJudgment === 'transfer' ? '未发现作者再创作成分' : '无法确认是否含再创作成分')}</span>
                            </p>
                          )}
                          <p className="text-xs text-cinnabar/90 pt-0.5">{guidance}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {result.cacheHit === true && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-gold/10 border border-gold/30 rounded-full" title="相同图片命中缓存,跳过重复计算">
                    <Cpu className="w-3 h-3 text-gold" />
                    <span className="text-xs font-medium text-gold">缓存命中</span>
                  </div>
                )}
                {typeof result.jimpDurationMs === 'number' && typeof result.aiDurationMs === 'number' && (result.jimpDurationMs > 0 || result.aiDurationMs > 0) && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-ink-900/5 border border-ink-900/15 rounded-full" title="Jimp 本地算法 vs AI 视觉模型耗时分解">
                    <Cloud className="w-3 h-3 text-ink-600" />
                    <span className="text-xs font-medium text-ink-600">
                      Jimp <span className="font-mono tabular-nums">{result.jimpDurationMs}ms</span>
                      {' / '}
                      AI <span className="font-mono tabular-nums">{result.aiDurationMs}ms</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-rice-50 rounded-2xl overflow-hidden shadow-card">
              <div className="relative">
                {/* 2026-09-03 Phase 1A:aiEnhanced 且 issueMarkers 非空时用 AnnotationWorkspace
                    (锚定卡片式:图+SVG标注+侧栏卡片+维度过滤);否则 SmartImage。 */}
                {(() => {
                  if (result.aiEnhanced === true) {
                    const markers = result.issueMarkers ?? result.aiVisionResult?.issueMarkers;
                    if (markers && markers.length > 0) {
                      const dims = result.dimensions;
                      /* 2026-08-18 修复:focusPoint 可能缺失(旧记录/后端同步数据未含该字段),
                       * 兜底画面中心,避免 fp.x 渲染崩溃 → ErrorBoundary"模块暂时无法正常显示" */
                      const fp = (isPainting(dims) ? dims.composition.focusPoint :
                                 isDesign(dims) ? dims.visualHierarchy.focusPoint :
                                 isProduct(dims) ? dims.form?.focusPoint :
                                 dims.spatialComposition?.focusPoint) ?? { x: 0.5, y: 0.5 };
                      return (
                        <AnnotationWorkspace
                          imageUrl={result.imageUrl}
                          issueMarkers={markers}
                          imgClassName="w-full max-h-96 min-h-[200px] object-contain"
                          focusPoint={fp}
                          /* Phase 4 批次②(数据飞轮):标注卡反馈按钮接线。
                           * 仅后端已同步分析可反馈——本地临时 analysis-* 前缀 ID 无后端记录
                           * (照 L1804/L2968 AI 增强区块同款守卫;onRecordId 回调会在落库后
                           * 替换真实 ID 并重渲染,届时反馈入口自动出现)。
                           * 失败静默兜底:业务错误由 api.ts 全局 Toast,此处仅吞未处理拒绝 */
                          onMarkerFeedback={
                            result.id && !result.id.startsWith('analysis-')
                              ? (markerId, markerIndex, action) => {
                                  createMarkerFeedback(result.id, { markerId, markerIndex, action }).catch(
                                    () => {
                                      /* 业务错误已全局 Toast;乐观态由下次点击自然纠正 */
                                    },
                                  );
                                }
                              : undefined
                          }
                          /* Phase 4 批次④:教师批注第⑤层(查找函数;空列表时全部返回
                           * undefined,卡片层不渲染,零开销) */
                          teacherAnnotations={teacherAnnotationLookup}
                          cornerBadges={
                            <>
                              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-xl flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-jade" />
                                <span className="font-bold text-ink-900">分析完成</span>
                              </div>
                              <div className="absolute top-4 left-4 flex items-center gap-2">
                                <div className="bg-ink-900/80 backdrop-blur-sm px-3 py-1 rounded-lg">
                                  <span className="text-rice-100 text-sm font-medium">
                                    {artTypes.find(a => a.id === selectedArtType)?.name}
                                  </span>
                                </div>
                                {(result.diagnosisMode ?? diagnosisMode) === 'exam' ? (
                                  <div className="bg-cinnabar/90 backdrop-blur-sm px-3 py-1 rounded-lg" title="按联考阅卷标准客观评定">
                                    <span className="text-rice-100 text-sm font-medium">
                                      艺考诊断{(result.examSubject ?? examSubject) ? ` · ${EXAM_SUBJECT_LABEL[(result.examSubject ?? examSubject) as ExamSubject]}` : ''}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="bg-jade/85 backdrop-blur-sm px-3 py-1 rounded-lg" title="1对1教学视角,顺着你的风格给建议">
                                    <span className="text-rice-100 text-sm font-medium">教学诊断</span>
                                  </div>
                                )}
                              </div>
                            </>
                          }
                        />
                      );
                    }
                  }
                  return (
                    <div className="relative">
                      <SmartImage
                        src={result.imageUrl}
                        alt="分析的作品"
                        className="w-full max-h-96 min-h-[200px]"
                        imgClassName="object-contain transition-opacity duration-300"
                        fallbackText="图片加载失败"
                      />
                      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-xl flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-jade" />
                        <span className="font-bold text-ink-900">分析完成</span>
                      </div>
                      <div className="absolute top-4 left-4 flex items-center gap-2">
                        <div className="bg-ink-900/80 backdrop-blur-sm px-3 py-1 rounded-lg">
                          <span className="text-rice-100 text-sm font-medium">
                            {artTypes.find(a => a.id === selectedArtType)?.name}
                          </span>
                        </div>
                        {(result.diagnosisMode ?? diagnosisMode) === 'exam' ? (
                          <div className="bg-cinnabar/90 backdrop-blur-sm px-3 py-1 rounded-lg" title="按联考阅卷标准客观评定">
                            <span className="text-rice-100 text-sm font-medium">
                              艺考诊断{(result.examSubject ?? examSubject) ? ` · ${EXAM_SUBJECT_LABEL[(result.examSubject ?? examSubject) as ExamSubject]}` : ''}
                            </span>
                          </div>
                        ) : (
                          <div className="bg-jade/85 backdrop-blur-sm px-3 py-1 rounded-lg" title="1对1教学视角,顺着你的风格给建议">
                            <span className="text-rice-100 text-sm font-medium">教学诊断</span>
                          </div>
                        )}
                      </div>
                      {(() => {
                        const dims = result.dimensions;
                        const fp = (isPainting(dims) ? dims.composition.focusPoint :
                                   isDesign(dims) ? dims.visualHierarchy.focusPoint :
                                   isProduct(dims) ? dims.form?.focusPoint :
                                   dims.spatialComposition?.focusPoint) ?? { x: 0.5, y: 0.5 };
                        return (
                          <div
                            className="absolute inset-0 pointer-events-none opacity-60"
                            style={{
                              background: `radial-gradient(circle at ${fp.x * 100}% ${fp.y * 100}%,
                            rgba(196, 30, 58, 0.4) 0%,
                            rgba(196, 30, 58, 0.15) 30%,
                            transparent 60%)`
                            }}
                          />
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-ink-500 mb-2">综合评分</p>
              {result.overallScore == null ? (
                /* 批次②:基础检测不产分(评分属 AI 深度分析),显示占位引导升级 */
                <div className="inline-flex flex-col items-center py-2">
                  <span className="font-serif text-3xl font-semibold text-ink-400">—</span>
                  <p className="text-xs text-ink-500 mt-1.5">基础检测不产生评分,点击下方「AI 深度分析」获取专业评分</p>
                </div>
              ) : (
                <div className="inline-flex items-center gap-4">
                  <AnimatedScore score={result.overallScore} size={120} />
                  <div className="text-left">
                    <p className="font-serif text-lg font-semibold text-ink-900">
                      {result.overallScore >= 85 ? '优秀' : result.overallScore >= 70 ? '良好' : '需改进'}
                    </p>
                    <p className="text-sm text-ink-500">继续加油，你的创作会越来越好！</p>
                  </div>
                </div>
              )}
              {/* 评分依据汇总(框架二 P1:破"评分黑盒"质疑,分数可追溯) */}
              {result.rubricSummary && <RubricSummaryBar summary={result.rubricSummary} />}
            </div>

            {/* 2026-09-03 Phase 1B:客观画面检测(像素级可复现指标+明度标尺)
                - 本地快速模式:明示降级,引导用户按需升级 AI 深度分析
                - Phase 2 批次⑥:AI 增强后亦展示(spec §5b.3"客观数据层并入报告")——
                  此时为档案阈值重判定版,面板带「按本校标准」标记,教师调阈值对学生可见 */}
            {result.objectiveChecks && (
              <ObjectiveChecksPanel
                checks={result.objectiveChecks}
                showLocalBanner={result.analysisSource === 'local'}
              />
            )}

            {/* Phase 2 批次④:档位估算徽章(评分档案 tierMapping 语义,与联考 A-E 评级独立)。
                诚实性设计(spec §4.3):非确定评级——主文案强制"预估…档(±1 档)",
                note 给估算依据,灰底副注"估算值仅供参考";无估算(undefined)时不渲染 */}
            {result.tierEstimate && (
              <div className="bg-gold/5 border border-gold/25 rounded-2xl p-5 flex items-start gap-3">
                <Award className="w-5 h-5 text-gold-dark flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="font-serif text-lg font-semibold text-ink-900">
                      预估 {result.tierEstimate.tier} 档
                    </p>
                    <span className="text-xs text-ink-500">（±1 档）</span>
                  </div>
                  <p className="text-xs text-ink-600 leading-relaxed mt-1">
                    {result.tierEstimate.note}
                  </p>
                  <p className="text-xs text-ink-400 mt-1.5">估算值仅供参考</p>
                </div>
              </div>
            )}

            {/* 艺考诊断结果面板(2026-08-16 诊断理念重构):
               exam 模式 + AI 深度分析产出 examResult 时展示档位/维度分/扣分点/提分策略;
               exam 模式但尚未 AI 增强时,提示点击下方「AI 深度分析」获取档位评定 */}
            {(result.diagnosisMode ?? diagnosisMode) === 'exam' && (
              result.aiVisionResult?.examResult ? (
                <ExamResultPanel
                  examResult={result.aiVisionResult.examResult}
                  examSubject={result.examSubject ?? examSubject}
                />
              ) : result.aiEnhanced !== true ? (
                <div className="bg-gold/5 border border-gold/25 rounded-2xl p-5 flex items-start gap-3">
                  <Award className="w-5 h-5 text-gold-dark flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">艺考档位评定待生成</p>
                    <p className="text-xs text-ink-600 leading-relaxed mt-1">
                      当前为本地快速分析结果。点击下方「AI 深度分析」后,将按「{EXAM_SUBJECT_LABEL[(result.examSubject ?? examSubject) as ExamSubject]}」联考阅卷标准给出档位评定、维度得分、扣分点与升档提分策略。
                    </p>
                  </div>
                </div>
              ) : null
            )}

            {/* 评分预设:选择标准+调节权重 */}
            {(() => {
              /* 批次②:无评分(基础检测)时不渲染评分预设——预设调权依赖已有分数 */
              if (result.overallScore == null) return null;
              const dims = result.dimensions;
              const dimScores: Record<string, number> = {};
              /* 批次③:维度分可空(本地引擎停分,AI 覆盖后才有分);null 时该维度不入映射 */
              const put = (key: string, v: number | null) => {
                if (v != null) dimScores[key] = v;
              };
              if (isPainting(dims)) {
                put('composition_form', dims.composition.score);
                put('color', dims.color.score);
                put('technique', dims.brushwork.score);
                dimScores.overall = result.overallScore;
              } else if (isDesign(dims)) {
                put('visual_hierarchy', dims.visualHierarchy.score);
                put('layout', dims.typography.score);
                put('color_application', dims.colorApplication.score);
                put('creativity', result.originality.score);
              } else if (isProduct(dims)) {
                put('form_semantics', dims.form.score);
                put('material', dims.materialExpression.score);
                put('function', dims.functionExpression.score);
                dimScores.ergonomics = result.overallScore;
              } else if (isSculpture(dims)) {
                put('spatial_composition', dims.spatialComposition.score);
                put('form_language', dims.bodyLanguage.score);
                put('material_language', dims.materialLanguage.score);
                put('concept', result.originality.score);
              }
              return (
                <PresetSelector
                  analysisId={result.id}
                  artType={result.artType}
                  dimensionScores={dimScores}
                  currentScore={result.overallScore}
                />
              );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 非遗诊断:类目专属四维工艺卡片(分数从绘画三维确定性派生,文案为类目工艺点评) */}
              {result.artType === 'heritage' && isPainting(result.dimensions) && (() => {
                const d = result.dimensions;
                /* 批次③:维度分可空(本地引擎停分);null → DimensionHeader 显示"—",进度条 0% */
                const scores: Array<number | null> = [
                  d.composition.score,
                  d.color.score,
                  d.brushwork.score,
                  d.composition.score != null && d.color.score != null && d.brushwork.score != null
                    ? Math.round((d.composition.score + d.color.score + d.brushwork.score) / 3)
                    : null,
                ];
                const comments = HERITAGE_DIM_COMMENTS[heritageCategory];
                const sugg = [d.composition.suggestion, d.color.suggestion, d.brushwork.suggestion];
                const priorities: SuggestionPriority[] = ['high', 'medium', 'low', 'low'];
                return (
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {HERITAGE_DIMENSIONS[heritageCategory].map((label, i) => (
                      <div key={label} className="bg-rice-50 rounded-2xl p-5 shadow-card">
                        <DimensionHeader icon={Gem} title={label} score={scores[i]} color={i % 2 === 0 ? 'cinnabar' : 'gold'} />
                        <div className="h-1.5 bg-ink-900/8 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${i % 2 === 0 ? 'bg-cinnabar' : 'bg-gold'} rounded-full transition-all duration-700 ease-out`}
                            style={{ width: `${scores[i] == null ? 0 : Math.min(100, scores[i])}%` }}
                          />
                        </div>
                        <div className="mt-4">
                          <MetricItem label="工艺点评" value={comments[i]} />
                        </div>
                        <div className="mt-3">
                          <SuggestionBox
                            color={i % 2 === 0 ? 'cinnabar' : 'gold'}
                            suggestion={i < 3 ? sugg[i] : '整体工艺完成度良好，可对照类目专属标准继续打磨细节。'}
                            priority={priorities[i]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {result.artType !== 'heritage' && isPainting(result.dimensions) && (
                <>
                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Eye} title="构图分析" score={result.dimensions.composition.score} color="cinnabar" />
                    <HeatmapSection data={result.dimensions.composition.heatmapData} focusPoint={result.dimensions.composition.focusPoint} />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="均衡度" value={
                        result.dimensions.composition.balance === 'balanced' ? '均衡' :
                        result.dimensions.composition.balance === 'left-heavy' ? '偏左' :
                        result.dimensions.composition.balance === 'right-heavy' ? '偏右' :
                        result.dimensions.composition.balance === 'top-heavy' ? '偏上' : '偏下'
                      } />
                      <MetricItem label="引导线" value={
                        result.dimensions.composition.guideline === 'good' ? '合理' :
                        result.dimensions.composition.guideline === 'average' ? '一般' : '需优化'
                      } />
                    </div>
                    <MetricItem label="留白比例" value={`${(result.dimensions.composition.whitespaceRatio * 100).toFixed(0)}%`} />
                    <div className="mt-3">
                      <SuggestionBox color="cinnabar" suggestion={result.dimensions.composition.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'composition') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'composition')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Palette} title="色彩诊断" score={result.dimensions.color.score} color="stone" />
                    {/* Phase F1:色彩和谐度环形可视化(有 harmonyType/harmonyScore 时展示) */}
                    {(result.dimensions.color.harmonyType || typeof result.dimensions.color.harmonyScore === 'number') && (
                      <HeatmapSection
                        data={[]}
                        title="色彩和谐度"
                        harmonyData={{
                          harmonyScore: result.dimensions.color.harmonyScore,
                          harmonyType: result.dimensions.color.harmonyType,
                          dominantColor: result.dimensions.color.dominantColor,
                        }}
                      />
                    )}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="冷暖比" value={`${result.dimensions.color.warmRatio.toFixed(1)} : ${(1 - result.dimensions.color.warmRatio).toFixed(1)}`} />
                      <MetricItem label="对比度" value={
                        result.dimensions.color.contrast === 'high' ? '高' :
                        result.dimensions.color.contrast === 'medium' ? '适中' : '低'
                      } />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="饱和度" value={
                        result.dimensions.color.saturation === 'high' ? '高' :
                        result.dimensions.color.saturation === 'medium' ? '适中' : '低'
                      } />
                      <MetricItem label="丰富度" value={
                        result.dimensions.color.richness === 'rich' ? '丰富' :
                        result.dimensions.color.richness === 'moderate' ? '适中' : '有限'
                      } />
                    </div>
                    <MetricItem label="主色调" value={result.dimensions.color.dominantColor} />
                    <div className="mt-3">
                      <SuggestionBox color="stone" suggestion={result.dimensions.color.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'color') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'color')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={PenTool} title="笔触技法" score={result.dimensions.brushwork.score} color="gold" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="肌理层次" value={
                        result.dimensions.brushwork.textureLevel === 'rich' ? '丰富' :
                        result.dimensions.brushwork.textureLevel === 'moderate' ? '适中' : '简单'
                      } />
                      <MetricItem label="笔触变化" value={`${result.dimensions.brushwork.strokeVariety}%`} />
                    </div>
                    <MetricItem label="干湿平衡" value={result.dimensions.brushwork.wetDryBalance} />
                    <div className="mt-3">
                      <SuggestionBox color="gold" suggestion={result.dimensions.brushwork.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'brushwork') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'brushwork')!} />
                    )}
                  </div>
                </>
              )}

              {isDesign(result.dimensions) && (
                <>
                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Eye} title="视觉层次" score={result.dimensions.visualHierarchy.score} color="cinnabar" />
                    <HeatmapSection data={result.dimensions.visualHierarchy.heatmapData} focusPoint={result.dimensions.visualHierarchy.focusPoint} />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="主次清晰度" value={
                        result.dimensions.visualHierarchy.primarySecondaryClarity === 'clear' ? '清晰' :
                        result.dimensions.visualHierarchy.primarySecondaryClarity === 'moderate' ? '一般' : '模糊'
                      } />
                      <MetricItem label="信息流动" value={
                        result.dimensions.visualHierarchy.informationFlow === 'good' ? '顺畅' :
                        result.dimensions.visualHierarchy.informationFlow === 'average' ? '一般' : '阻塞'
                      } />
                    </div>
                    <div className="mt-3">
                      <SuggestionBox color="cinnabar" suggestion={result.dimensions.visualHierarchy.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'visualHierarchy') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'visualHierarchy')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Type} title="排版" score={result.dimensions.typography.score} color="stone" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="对齐质量" value={
                        result.dimensions.typography.alignmentQuality === 'good' ? '优秀' :
                        result.dimensions.typography.alignmentQuality === 'average' ? '一般' : '需优化'
                      } />
                      <MetricItem label="节奏一致性" value={
                        result.dimensions.typography.rhythmConsistency === 'good' ? '一致' :
                        result.dimensions.typography.rhythmConsistency === 'average' ? '一般' : '混乱'
                      } />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="负空间运用" value={
                        result.dimensions.typography.negativeSpaceUsage === 'good' ? '得当' :
                        result.dimensions.typography.negativeSpaceUsage === 'average' ? '一般' : '拥挤'
                      } />
                      <MetricItem label="网格遵循度" value={`${result.dimensions.typography.gridAdherence}%`} />
                    </div>
                    <div className="mt-3">
                      <SuggestionBox color="stone" suggestion={result.dimensions.typography.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'typography') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'typography')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Palette} title="色彩应用" score={result.dimensions.colorApplication.score} color="gold" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="对比度" value={
                        result.dimensions.colorApplication.contrast === 'high' ? '高' :
                        result.dimensions.colorApplication.contrast === 'medium' ? '适中' : '低'
                      } />
                      <MetricItem label="品牌一致性" value={
                        result.dimensions.colorApplication.brandConsistency === 'strong' ? '强' :
                        result.dimensions.colorApplication.brandConsistency === 'moderate' ? '一般' : '弱'
                      } />
                    </div>
                    <MetricItem label="色彩心理学" value={result.dimensions.colorApplication.colorPsychology} />
                    <div className="mt-3">
                      <SuggestionBox color="gold" suggestion={result.dimensions.colorApplication.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'colorApplication') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'colorApplication')!} />
                    )}
                  </div>
                </>
              )}

              {isProduct(result.dimensions) && (
                <>
                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Box} title="形态" score={result.dimensions.form.score} color="cinnabar" />
                    <HeatmapSection data={result.dimensions.form.heatmapData} focusPoint={result.dimensions.form.focusPoint} title="形态焦点热力图" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="比例平衡" value={
                        result.dimensions.form.proportionBalance === 'good' ? '协调' :
                        result.dimensions.form.proportionBalance === 'average' ? '一般' : '失衡'
                      } />
                      <MetricItem label="线条流畅度" value={
                        result.dimensions.form.lineFluidity === 'smooth' ? '流畅' :
                        result.dimensions.form.lineFluidity === 'moderate' ? '一般' : '生硬'
                      } />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="曲面质量" value={
                        result.dimensions.form.surfaceQuality === 'excellent' ? '优秀' :
                        result.dimensions.form.surfaceQuality === 'good' ? '良好' : '一般'
                      } />
                      <MetricItem label="人机工学暗示" value={
                        result.dimensions.form.ergonomicsHint === 'strong' ? '强' :
                        result.dimensions.form.ergonomicsHint === 'moderate' ? '一般' : '弱'
                      } />
                    </div>
                    <div className="mt-3">
                      <SuggestionBox color="cinnabar" suggestion={result.dimensions.form.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'form') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'form')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Gem} title="材质表现" score={result.dimensions.materialExpression.score} color="stone" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="质感真实度" value={
                        result.dimensions.materialExpression.textureRealism === 'high' ? '高' :
                        result.dimensions.materialExpression.textureRealism === 'medium' ? '中' : '低'
                      } />
                      <MetricItem label="光影表现" value={
                        result.dimensions.materialExpression.lightShadowPerformance === 'excellent' ? '优秀' :
                        result.dimensions.materialExpression.lightShadowPerformance === 'good' ? '良好' : '一般'
                      } />
                    </div>
                    <MetricItem label="表面处理" value={
                      result.dimensions.materialExpression.surfaceTreatment === 'refined' ? '精致' :
                      result.dimensions.materialExpression.surfaceTreatment === 'moderate' ? '一般' : '粗糙'
                    } />
                    <div className="mt-3">
                      <SuggestionBox color="stone" suggestion={result.dimensions.materialExpression.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'materialExpression') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'materialExpression')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Settings} title="功能表达" score={result.dimensions.functionExpression.score} color="gold" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="结构清晰度" value={
                        result.dimensions.functionExpression.structureClarity === 'clear' ? '清晰' :
                        result.dimensions.functionExpression.structureClarity === 'moderate' ? '一般' : '模糊'
                      } />
                      <MetricItem label="功能暗示" value={
                        result.dimensions.functionExpression.functionImplication === 'strong' ? '强' :
                        result.dimensions.functionExpression.functionImplication === 'moderate' ? '一般' : '弱'
                      } />
                    </div>
                    <MetricItem label="细节精致度" value={
                      result.dimensions.functionExpression.detailRefinement === 'excellent' ? '优秀' :
                      result.dimensions.functionExpression.detailRefinement === 'good' ? '良好' : '一般'
                    } />
                    <div className="mt-3">
                      <SuggestionBox color="gold" suggestion={result.dimensions.functionExpression.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'functionExpression') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'functionExpression')!} />
                    )}
                  </div>
                </>
              )}

              {isSculpture(result.dimensions) && (
                <>
                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Box} title="空间构成" score={result.dimensions.spatialComposition.score} color="cinnabar" />
                    <HeatmapSection data={result.dimensions.spatialComposition.heatmapData} focusPoint={result.dimensions.spatialComposition.focusPoint} title="空间焦点热力图" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="体积感" value={
                        result.dimensions.spatialComposition.volumeSense === 'strong' ? '强烈' :
                        result.dimensions.spatialComposition.volumeSense === 'moderate' ? '一般' : '薄弱'
                      } />
                      <MetricItem label="空间占有" value={
                        result.dimensions.spatialComposition.spaceOccupation === 'full' ? '饱满' :
                        result.dimensions.spatialComposition.spaceOccupation === 'moderate' ? '适中' : '稀疏'
                      } />
                    </div>
                    <MetricItem label="虚实关系" value={
                      result.dimensions.spatialComposition.voidSolidRelation === 'harmonious' ? '和谐' :
                      result.dimensions.spatialComposition.voidSolidRelation === 'moderate' ? '一般' : '失衡'
                    } />
                    <div className="mt-3">
                      <SuggestionBox color="cinnabar" suggestion={result.dimensions.spatialComposition.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'spatialComposition') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'spatialComposition')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Move} title="形体语言" score={result.dimensions.bodyLanguage.score} color="stone" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="动态感" value={
                        result.dimensions.bodyLanguage.dynamicSense === 'strong' ? '强烈' :
                        result.dimensions.bodyLanguage.dynamicSense === 'moderate' ? '一般' : '静态'
                      } />
                      <MetricItem label="张力表达" value={
                        result.dimensions.bodyLanguage.tensionExpression === 'high' ? '高' :
                        result.dimensions.bodyLanguage.tensionExpression === 'medium' ? '中' : '低'
                      } />
                    </div>
                    <MetricItem label="韵律流动" value={
                      result.dimensions.bodyLanguage.rhythmFlow === 'fluent' ? '流畅' :
                      result.dimensions.bodyLanguage.rhythmFlow === 'moderate' ? '一般' : '生硬'
                    } />
                    <div className="mt-3">
                      <SuggestionBox color="stone" suggestion={result.dimensions.bodyLanguage.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'bodyLanguage') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'bodyLanguage')!} />
                    )}
                  </div>

                  <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                    <DimensionHeader icon={Gem} title="材料语言" score={result.dimensions.materialLanguage.score} color="gold" />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <MetricItem label="材料特性" value={
                        result.dimensions.materialLanguage.materialCharacter === 'distinct' ? '鲜明' :
                        result.dimensions.materialLanguage.materialCharacter === 'moderate' ? '一般' : '模糊'
                      } />
                      <MetricItem label="肌理表现" value={
                        result.dimensions.materialLanguage.textureExpression === 'rich' ? '丰富' :
                        result.dimensions.materialLanguage.textureExpression === 'moderate' ? '一般' : '简单'
                      } />
                    </div>
                    <MetricItem label="质感层次" value={
                      result.dimensions.materialLanguage.qualityLayering === 'rich' ? '丰富' :
                      result.dimensions.materialLanguage.qualityLayering === 'moderate' ? '一般' : '简单'
                    } />
                    <div className="mt-3">
                      <SuggestionBox color="gold" suggestion={result.dimensions.materialLanguage.suggestion} />
                    </div>
                    {result.scoreTrace?.find((t) => t.dimensionKey === 'materialLanguage') && (
                      <ScoreTraceToggle trace={result.scoreTrace!.find((t) => t.dimensionKey === 'materialLanguage')!} />
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 第一阶段引导提示：仅未AI增强时显示。
                2026-08-18 改造：移除「!result.id.startsWith('analysis-')」门控 — 任何状态下
                都能点绿按钮，即使是本地临时 analysis-* ID，内部会先静默落库再调 AI。 */}
            {result.aiEnhanced !== true && result.id && (
              <div className="bg-gradient-to-r from-jade/10 to-jade/5 border-l-4 border-jade rounded-xl p-5 mb-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-jade/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Brain className="w-5 h-5 text-jade" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-serif text-base font-bold text-ink-900 mb-1">
                      当前为基础视觉分析结果
                    </h4>
                    <p className="text-sm text-ink-600 mb-3 leading-relaxed">
                      以上为本地图像特征快速分析（3秒内完成）。若需<strong className="text-jade">美院规范的具体改进建议</strong>、<strong className="text-jade">问题定位</strong>与<strong className="text-jade">创作方向指引</strong>，请点击下方"AI深度分析"按钮，调用GLM-4V视觉模型生成专业诊断报告。
                    </p>
                    <button
                      onClick={handleAiEnhance}
                      disabled={aiEnhanceLoading}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-jade text-white rounded-lg hover:bg-jade/90 transition-all shadow-sm hover:shadow disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {aiEnhanceLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>AI 分析中…（{aiEnhanceStage}/{AI_ENHANCE_STAGES.length}）</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>立即获取 AI 深度分析</span>
                        </>
                      )}
                    </button>
                    {/* P0 深度诊断黑盒修复:AI 分析 8 阶段进度条(主 CTA 下方展示,用户最可见)。
                        阶段 0="同步诊断记录到服务器",保证本地临时 ID 也能直接在同一个进度流里完成。 */}
                    {aiEnhanceLoading && (
                      <div className="mt-4 w-full space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-ink-500">
                          <span className="font-medium">{AI_ENHANCE_STAGES[Math.min(aiEnhanceStage, AI_ENHANCE_STAGES.length - 1)]?.label ?? '深度分析中…'}</span>
                          <span className="font-mono tabular-nums">{Math.round((aiEnhanceStage / AI_ENHANCE_STAGES.length) * 100)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-jade to-jade-dark transition-all duration-300 ease-out"
                            style={{ width: `${(aiEnhanceStage / AI_ENHANCE_STAGES.length) * 100}%` }}
                          />
                        </div>
                        {/* 8 阶段小胶囊(完成:绿色实心,当前:半实心描边,未开始:灰色描边) */}
                        <div className="grid grid-cols-8 gap-1.5 mt-1">
                          {AI_ENHANCE_STAGES.map((st, idx) => {
                            const done = aiEnhanceStage > idx;
                            const active = aiEnhanceStage === idx && !done;
                            return (
                              <div
                                key={st.key}
                                title={`${st.label} · ${st.tip}`}
                                className={[
                                  'h-6 rounded-md text-center leading-6 text-[10px] font-medium transition-colors truncate px-1',
                                  done
                                    ? 'bg-jade/15 text-jade border border-jade/40'
                                    : active
                                      ? 'bg-jade/5 text-jade-dark border border-jade animate-pulse'
                                      : 'bg-white text-ink-400 border border-ink-100',
                                ].join(' ')}
                              >
                                {idx + 1}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* P0 深度诊断黑盒修复:AI 失败详情折叠面板(主 CTA 下方) */}
                    {!aiEnhanceLoading && aiEnhanceError && (
                      <div className="mt-4 w-full rounded-xl border border-cinnabar/30 bg-cinnabar/5 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setAiEnhanceErrorOpen((o) => !o)}
                          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <AlertTriangle className="w-4 h-4 flex-none text-cinnabar" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-cinnabar truncate">
                                {aiEnhanceError.aiMeta?.aiFailureReason
                                  ? `AI 调用失败（${aiEnhanceError.aiMeta.aiFailureReason}）`
                                  : 'AI 深度分析失败详情'}
                              </div>
                              <div className="text-xs text-ink-500 truncate">
                                实际耗时 {aiEnhanceError.aiMeta?.aiDurationMs ?? '—'}ms · 超时配置 {aiEnhanceError.aiEffectiveTimeoutMs ?? '—'}ms
                              </div>
                            </div>
                          </div>
                          <div className="flex-none flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAiEnhanceError(null);
                                setAiEnhanceErrorOpen(false);
                              }}
                              className="p-1 rounded hover:bg-cinnabar/10 text-ink-400 hover:text-cinnabar"
                              title="关闭详情"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            {aiEnhanceErrorOpen ? (
                              <ChevronUp className="w-4 h-4 text-ink-500 flex-none" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-ink-500 flex-none" />
                            )}
                          </div>
                        </button>
                        {aiEnhanceErrorOpen && (
                          <div className="px-4 pb-4 space-y-3 text-sm border-t border-cinnabar/10 pt-3 bg-white/50">
                            {aiEnhanceError.aiMeta?.debugHint && (
                              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                                <div className="flex items-center gap-1.5 text-amber-800 font-semibold text-xs mb-1.5">
                                  <TimerReset className="w-3.5 h-3.5" />
                                  调试建议
                                </div>
                                <p className="text-amber-900 leading-relaxed whitespace-pre-wrap text-[13px]">
                                  {aiEnhanceError.aiMeta.debugHint}
                                </p>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-white border border-ink-100 p-2.5">
                                <div className="text-ink-400 mb-1">失败原因</div>
                                <div className="font-mono text-ink-800">
                                  {aiEnhanceError.aiMeta?.aiFailureReason ?? '—'}
                                </div>
                              </div>
                              <div className="rounded-md bg-white border border-ink-100 p-2.5">
                                <div className="text-ink-400 mb-1">AI 模型</div>
                                <div className="font-mono text-ink-800 truncate">
                                  {aiEnhanceError.aiMeta?.aiModel ?? '—'}
                                </div>
                              </div>
                              <div className="rounded-md bg-white border border-ink-100 p-2.5">
                                <div className="text-ink-400 mb-1 flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> 实际耗时
                                </div>
                                <div className="font-mono text-ink-800">
                                  {aiEnhanceError.aiMeta?.aiDurationMs ?? '—'} ms
                                </div>
                              </div>
                              <div className="rounded-md bg-white border border-ink-100 p-2.5">
                                <div className="text-ink-400 mb-1 flex items-center gap-1">
                                  <TimerReset className="w-3 h-3" /> 超时阈值
                                </div>
                                <div className="font-mono text-ink-800">
                                  {aiEnhanceError.aiEffectiveTimeoutMs ?? '—'} ms
                                </div>
                              </div>
                            </div>
                            {aiEnhanceError.aiMeta?.stageTimings &&
                              Object.keys(aiEnhanceError.aiMeta.stageTimings).length > 0 && (
                                <div>
                                  <div className="text-xs text-ink-500 mb-1.5">各阶段耗时明细</div>
                                  <div className="space-y-1">
                                    {AI_ENHANCE_STAGES.map((st) => {
                                      const v = aiEnhanceError.aiMeta?.stageTimings?.[st.key];
                                      return (
                                        <div
                                          key={st.key}
                                          className="flex items-center gap-2 text-[12px]"
                                        >
                                          <div className="w-36 text-ink-600 flex-none truncate">
                                            {st.label}
                                          </div>
                                          <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-cinnabar/60"
                                              style={{
                                                width: `${v
                                                  ? Math.min(
                                                      100,
                                                      (v / Math.max((aiEnhanceError.aiMeta?.aiDurationMs ?? 1), 1)) * 100,
                                                    )
                                                  : 0}%`,
                                              }}
                                            />
                                          </div>
                                          <div className="w-16 text-right font-mono tabular-nums text-ink-600">
                                            {typeof v === 'number' ? `${v}ms` : '—'}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={handleAiEnhance}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-cinnabar text-white rounded-md text-xs font-medium hover:bg-cinnabar/90 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" /> 立即重试
                              </button>
                              <span className="text-xs text-ink-400">
                                如多次失败，请截图本面板联系管理员排查后端日志
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* AI 深度分析详情:展示画面理解与维度分析 */}
            {result.aiVisionResult && (
              <div className="bg-gradient-to-br from-jade/5 to-ink-50 rounded-2xl p-6 shadow-card border border-jade/20">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-jade/20 rounded-lg flex items-center justify-center">
                    <Eye className="w-5 h-5 text-jade" />
                  </div>
                  <div>
                    <h3 className="font-serif text-lg font-bold text-ink-900">AI 画面深度解析</h3>
                    <p className="text-xs text-ink-500">GLM-4V 视觉模型对作品的观察与理解</p>
                  </div>
                </div>

                {/* 画面整体描述 */}
                {result.aiVisionResult.visualDescription && (
                  <div className="bg-white/60 rounded-xl p-4 mb-4 border border-ink-100">
                    <h4 className="text-sm font-semibold text-ink-800 mb-2 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-jade rounded-full" />
                      画面整体印象
                    </h4>
                    <p className="text-sm text-ink-700 leading-relaxed">{result.aiVisionResult.visualDescription}</p>
                  </div>
                )}

                {/* 三维度详细分析 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.aiVisionResult.composition && (
                    <div className="bg-white/60 rounded-xl p-4 border border-ink-100">
                      <h4 className="text-sm font-semibold text-ink-800 mb-2 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-cinnabar rounded-full" />
                        构图分析
                      </h4>
                      <p className="text-xs text-ink-600 leading-relaxed">{result.aiVisionResult.composition}</p>
                    </div>
                  )}
                  {result.aiVisionResult.color && (
                    <div className="bg-white/60 rounded-xl p-4 border border-ink-100">
                      <h4 className="text-sm font-semibold text-ink-800 mb-2 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-gold rounded-full" />
                        色彩分析
                      </h4>
                      <p className="text-xs text-ink-600 leading-relaxed">{result.aiVisionResult.color}</p>
                    </div>
                  )}
                  {result.aiVisionResult.technique && (
                    <div className="bg-white/60 rounded-xl p-4 border border-ink-100">
                      <h4 className="text-sm font-semibold text-ink-800 mb-2 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-ink-400 rounded-full" />
                        技法分析
                      </h4>
                      <p className="text-xs text-ink-600 leading-relaxed">{result.aiVisionResult.technique}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Task 14.2:评分标准面板(仅 aiEnhanced 且 scoreCriteria 非空时渲染) */}
            {result.aiEnhanced === true && result.scoreCriteria && result.scoreCriteria.length > 0 && (
              <ScoreCriteriaPanel
                scoreCriteria={result.scoreCriteria}
                evaluationStage={result.evaluationStage}
                diagnosisMode={result.diagnosisMode ?? diagnosisMode}
              />
            )}

            {/* Task 14.4:专业深度维度面板(仅 aiEnhanced 时渲染;4 维度优先取 aiVisionResult,回退顶层透传) */}
            {result.aiEnhanced === true && (
              <DepthDimensionsPanel
                originalityAndStyle={result.aiVisionResult?.originalityAndStyle ?? result.originalityAndStyle}
                completenessAndRhythm={result.aiVisionResult?.completenessAndRhythm ?? result.completenessAndRhythm}
                emotionAndMood={result.aiVisionResult?.emotionAndMood ?? result.emotionAndMood}
                craftsmanship={result.aiVisionResult?.craftsmanship ?? result.craftsmanship}
              />
            )}

            {/* Task 13.2:相似作品并排对比卡(基于 result.aiVisionResult.referenceArtworks;为空不渲染) */}
            {(() => {
              const arts = extractReferenceArtworks(result.aiVisionResult);
              if (arts.length === 0) return null;
              return <ReferenceArtworksSection artworks={arts} />;
            })()}

            {/* 专业改进建议(AI增强模式/Phase B4): 按priority排序显示,旧数据无该字段时不渲染 */}
            {result.professionalSuggestions && result.professionalSuggestions.length > 0 && (
              <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-cinnabar/10 rounded-lg flex items-center justify-center">
                    <Brain className="w-5 h-5 text-cinnabar" />
                  </div>
                  <div>
                    <h3 className="font-serif text-lg font-bold text-ink-900">AI专业诊断建议</h3>
                    <p className="text-xs text-ink-500">基于视觉特征数据锚定,按优先级排序</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sortSuggestionsByPriority(result.professionalSuggestions).map((sug, idx) => (
                    <ProfessionalSuggestionCard key={idx} sug={sug} index={idx} />
                  ))}
                </div>
              </div>
            )}

            {/* Phase 3 批次④:跨域启发(灵感嫁接协同,仅 guidance 引导模式渲染;
                反馈区尾部——顺着学生已有风格给发散方向,而非继续纠错) */}
            <CrossDomainInspiration
              feedbackMode={result.feedbackMode}
              diagnosisMode={result.diagnosisMode ?? diagnosisMode}
              examSubject={result.examSubject ?? examSubject}
              artType={result.artType}
            />

            {/* 网络来源疑似提醒(与名作库高度匹配时醒目警示) */}
            {result.originality.suspectedInternetSource && (
              <div
                role="alert"
                className="rounded-2xl border-2 border-cinnabar/60 bg-cinnabar/10 p-5 shadow-card flex items-start gap-4"
              >
                <div className="w-11 h-11 rounded-xl bg-cinnabar flex items-center justify-center flex-shrink-0 animate-pulse">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-serif text-lg font-bold text-cinnabar mb-1">
                    ⚠ 该作品疑似来源于网络
                  </h3>
                  <p className="text-sm text-ink-700 leading-relaxed">
                    检测到该作品与网络已有作品高度相似
                    {result.originality.mostSimilarWork && (
                      <>
                        (最接近:《{result.originality.mostSimilarWork.title}》
                        {result.originality.mostSimilarWork.artist})
                      </>
                    )}
                    {typeof result.originality.pHashSimilarity === 'number' && (
                      <> · 相似度 {Math.round(result.originality.pHashSimilarity * 100)}%</>
                    )}
                    ,请确认是否为本人原创作品。AI 诊断结果仅供临摹学习参考,不作为原创能力评价依据。
                  </p>
                </div>
              </div>
            )}

            {/* 原创性检测 - 全宽卡片 */}
            <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-gold" />
                  </div>
                  <h3 className="font-serif text-lg font-bold text-ink-900">原创性检测</h3>
                </div>
                <div className={`w-12 h-12 ${result.originality.score == null ? 'bg-ink-400' : getScoreBg(result.originality.score)} rounded-full flex items-center justify-center`}>
                  <span className="font-serif text-xl font-bold text-white">{result.originality.score ?? '—'}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricItem label="相似度" value={`${(result.originality.similarity * 100).toFixed(0)}%`} />
                <MetricItem label="评级" value={
                  <span className={
                    result.originality.similarity < 0.15 ? 'text-jade' :
                    result.originality.similarity < 0.25 ? 'text-gold' : 'text-cinnabar'
                  }>
                    {result.originality.similarity < 0.15 ? '优秀' :
                     result.originality.similarity < 0.25 ? '良好' : '需注意'}
                  </span>
                } />
                <MetricItem label="创造力等级" value={
                  result.originality.creativityLevel === 'excellent' ? '卓越' :
                  result.originality.creativityLevel === 'good' ? '良好' :
                  result.originality.creativityLevel === 'average' ? '一般' : '需努力'
                } />
              </div>
              <div className="bg-rice-100 rounded-xl p-4 mt-4 mb-4">
                <p className="text-xs text-ink-500 mb-2">原创性进度</p>
                <div className="w-full h-2 bg-ink-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${
                      result.originality.similarity < 0.15 ? 'bg-jade' :
                      result.originality.similarity < 0.25 ? 'bg-gold' : 'bg-cinnabar'
                    }`}
                    style={{ width: `${(1 - result.originality.similarity) * 100}%` }}
                  />
                </div>
              </div>
              <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
                <p className="text-sm font-medium text-gold mb-1">改进建议</p>
                <p className="text-sm text-ink-600">{result.originality.suggestion}</p>
              </div>
            </div>

            {/* Phase F1:算法指标卡片 - 展示 Phase A 新增的客观算法指标 */}
            {(() => {
              const dims = result.dimensions;
              const metrics: Array<{ label: string; value: string; hint?: string }> = [];

              // 构图类指标(painting/design/product/sculpture 共享 composition 系列字段)
              const comp = isPainting(dims) ? dims.composition :
                           isDesign(dims) ? dims.visualHierarchy :
                           isProduct(dims) ? dims.form :
                           dims.spatialComposition;
              if (typeof comp.goldenRatioScore === 'number') {
                metrics.push({ label: '黄金分割评分', value: `${comp.goldenRatioScore.toFixed(1)}`, hint: '0-100,越高越接近黄金分割' });
              }
              if (typeof comp.ruleOfThirdsScore === 'number') {
                metrics.push({ label: '三分法评分', value: `${comp.ruleOfThirdsScore.toFixed(1)}`, hint: '0-100,焦点落在三分线交点' });
              }
              if (typeof comp.leadingLineDirection === 'number' && typeof comp.leadingLineStrength === 'number') {
                metrics.push({
                  label: '引导线',
                  value: `${comp.leadingLineStrength.toFixed(2)} @ ${Math.round(comp.leadingLineDirection)}°`,
                  hint: '强度(0-1)与方向(0-180°)',
                });
              }

              // 色彩类指标(仅 painting 有 color 维度)
              if (isPainting(dims)) {
                const color = dims.color;
                if (typeof color.harmonyScore === 'number') {
                  metrics.push({ label: '色彩和谐度', value: `${color.harmonyScore.toFixed(1)}`, hint: '0-100,越高色彩越和谐' });
                }
                if (color.harmonyType) {
                  metrics.push({ label: '和谐类型', value: color.harmonyType, hint: '色彩和谐方案' });
                }
                if (color.saturationDistribution) {
                  const sd = color.saturationDistribution;
                  metrics.push({
                    label: '饱和度分布',
                    value: `低${Math.round(sd.low * 100)}% / 中${Math.round(sd.mid * 100)}% / 高${Math.round(sd.high * 100)}%`,
                    hint: '三级饱和度像素占比',
                  });
                }
              }

              // 笔触结构张量(仅 painting)
              if (isPainting(dims) && dims.brushwork.structureTensor) {
                const st = dims.brushwork.structureTensor;
                metrics.push({
                  label: '结构张量',
                  value: `一致${st.coherence.toFixed(2)} / 能量${st.energy.toFixed(2)} / ${Math.round(st.dominantDirection)}°`,
                  hint: '笔触方向一致性、能量与主导方向',
                });
              }

              if (metrics.length === 0) return null;
              return (
                <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                  <div className="flex items-center gap-2 mb-4">
                    <Cpu className="w-5 h-5 text-ink-700" />
                    <h3 className="font-serif text-lg font-semibold text-ink-900">算法指标</h3>
                    <span className="text-xs text-ink-500 ml-1">客观像素级计算结果</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {metrics.map((m) => (
                      <div key={m.label} className="bg-white/60 rounded-lg p-3 border border-ink-100">
                        <div className="text-xs text-ink-500 mb-1">{m.label}</div>
                        <div className="text-sm font-mono tabular-nums font-medium text-ink-800">{m.value}</div>
                        {m.hint && <div className="text-[10px] text-ink-400 mt-1">{m.hint}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 分析报告增强(Phase 3):维度雷达图 + 历史对比 + 成长趋势;本地分析结果组件自动隐藏 */}
            <AnalysisInsights analysisId={result.id} />

            {/* 人工复核(Phase 5):对 AI 评分有异议可申请教师复核;本地分析结果组件自动隐藏 */}
            <RequestReviewSection analysisId={result.id} />

            {/* 已有评审展示(反馈闭环 Phase 4 批次④:ReviewRecord 断链修复——
                评审通知引导到本页,此前无展示;有评审时渲染,无记录/本地结果自动隐藏) */}
            <ReviewListSection analysisId={result.id} />

            {/* 阶段 3:问题分析(AI 深度分析完成后的用户追问;仅后端记录 + 已增强时展示) */}
            {result.aiEnhanced === true && result.id && !result.id.startsWith('analysis-') && (
              <div ref={qaSectionRef} className="bg-gradient-to-br from-gold/5 to-rice-50 rounded-2xl p-6 shadow-card border border-gold/25">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gold/15 rounded-lg flex items-center justify-center">
                      <MessageCircleQuestion className="w-5 h-5 text-gold-dark" />
                    </div>
                    <div>
                      <h3 className="font-serif text-lg font-bold text-ink-900">问题分析</h3>
                      <p className="text-xs text-ink-500">对诊断结果有疑问？向 AI 老师追问，围绕你的问题定向解答</p>
                    </div>
                  </div>
                  {/* 已有问答时可收起/展开 */}
                  {qaList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowQA((v) => !v)}
                      className="text-xs text-ink-500 hover:text-ink-800 px-2 py-1 rounded transition-colors"
                    >
                      {showQA ? '收起问答' : `展开问答(${qaList.length})`}
                    </button>
                  )}
                </div>

                {showQA && (
                  <>
                    {/* 追问输入区 */}
                    <div className="flex flex-col sm:flex-row gap-2 mb-3">
                      <textarea
                        value={questionInput}
                        onChange={(e) => setQuestionInput(e.target.value)}
                        onKeyDown={(e) => {
                          // Ctrl/Cmd+Enter 快捷提交
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            void handleAskQuestion();
                          }
                        }}
                        rows={2}
                        maxLength={500}
                        placeholder="例如:画面右侧的远山是不是太抢主体了？我该怎么处理空间关系？(10-500 字,Ctrl+Enter 发送)"
                        aria-label="输入你的问题"
                        className="flex-1 px-4 py-2.5 text-sm bg-white border border-ink-900/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 resize-none placeholder:text-ink-400"
                      />
                      <button
                        type="button"
                        onClick={handleAskQuestion}
                        disabled={askLoading || questionInput.trim().length < 10}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gold-dark text-white rounded-lg hover:bg-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-stretch sm:self-auto"
                        title="向 AI 提问(Ctrl+Enter)"
                      >
                        {askLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm font-medium">解答中…</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            <span className="text-sm font-medium">提问</span>
                          </>
                        )}
                      </button>
                    </div>
                    {/* 快捷问题:点击直接填入输入框 */}
                    {qaList.length === 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {['这幅画最需要优先改进的是哪个维度，为什么？', '构图上视觉重心偏了怎么调整？', '色彩关系有哪些问题，如何改进画面协调性？'].map((sq) => (
                          <button
                            key={sq}
                            type="button"
                            onClick={() => setQuestionInput(sq)}
                            className="text-xs px-3 py-1.5 bg-white border border-ink-900/10 rounded-full text-ink-600 hover:border-gold/50 hover:text-gold-dark transition-colors"
                          >
                            {sq}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* 问答列表(最新在前) */}
                    {qaList.length > 0 && (
                      <div className="space-y-4">
                        {qaList.map((qa, i) => (
                          <div key={`${i}-${qa.question.slice(0, 8)}`} className="bg-white rounded-xl border border-ink-900/5 p-4">
                            <div className="flex items-start gap-2.5 mb-3">
                              <div className="w-6 h-6 rounded-full bg-cinnabar/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-cinnabar">问</div>
                              <p className="text-sm font-medium text-ink-900 leading-relaxed flex-1">{qa.question}</p>
                            </div>
                            <div className="flex items-start gap-2.5">
                              <div className="w-6 h-6 rounded-full bg-jade/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-jade">答</div>
                              <div className="flex-1 min-w-0">
                                {qa.focusDimension && (
                                  <span className="inline-block text-xs px-2 py-0.5 bg-jade/5 text-jade border border-jade/20 rounded mb-2">
                                    聚焦维度:{qa.focusDimension}
                                  </span>
                                )}
                                <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">{qa.answer}</p>
                                {qa.suggestions.length > 0 && (
                                  <ul className="mt-3 space-y-1.5">
                                    {qa.suggestions.map((s, j) => (
                                      <li key={j} className="flex items-start gap-2 text-sm text-ink-600">
                                        <span className="text-gold-dark font-bold flex-shrink-0">→</span>
                                        <span>{s}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={handleRetry}
                aria-label="重新上传"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-ink-900 text-ink-900 rounded-lg hover:bg-ink-900 hover:text-rice-100 transition-all duration-300"
              >
                <Upload className="w-5 h-5" />
                <span className="font-medium">重新上传</span>
              </button>
              <button
                onClick={() => setShowTypeSwitcher((v) => !v)}
                aria-label="切换类型重测"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-[#5a8a7a] text-[#5a8a7a] rounded-lg hover:bg-[#5a8a7a] hover:text-rice-100 transition-all duration-300"
              >
                <RefreshCw className="w-5 h-5" />
                <span className="font-medium">切换类型重测</span>
              </button>
              <button
                onClick={() => {
                  // 跳转报告预览页(模板切换 + PDF 打印 + PNG 图片卡片)
                  navigate(`/report/${encodeURIComponent(result.id)}`);
                }}
                aria-label="导出报告"
                className="inline-flex items-center gap-2 px-6 py-3 bg-ink-900 text-rice-100 rounded-lg hover:bg-cinnabar transition-all duration-300"
              >
                <Download className="w-5 h-5" />
                <span className="font-medium">导出报告</span>
              </button>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: '丹青有AI - 创作分析报告',
                      text: result.overallScore == null
                        ? `我用丹青有AI完成了${artTypes.find(a => a.id === result.artType)?.name}作品的画面基础检测！`
                        : `我的${artTypes.find(a => a.id === result.artType)?.name}作品获得了${result.overallScore}分！`,
                      url: window.location.href,
                    });
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    toast.success('链接已复制', '可直接粘贴分享诊断结果');
                  }
                }}
                aria-label="分享报告"
                className="inline-flex items-center gap-2 px-6 py-3 bg-cinnabar text-rice-100 rounded-lg hover:bg-stone transition-all duration-300"
              >
                <Share2 className="w-5 h-5" />
                <span className="font-medium">分享报告</span>
              </button>
              {/* 分享到组织动态流(本地分析结果组件自动隐藏) */}
              <ShareToOrgButton
                analysisId={result.id}
                className="px-6 py-3 border-2 border-jade text-jade rounded-lg hover:bg-jade hover:text-white transition-all duration-300"
              />
              {/* M4-T8(真源 §7.3):以此风格生成练习 — 携当前作品图与 artType 跳转
                  生成页风格迁移模式。dataURL 不进 URL query(长度限制),仅经
                  location state 传递;server 模式 result.imageUrl 为已上传 http URL,
                  本地 client 模式可能为 dataURL(消费端 resolvePrefill 已做非空
                  透传 + GenerationPage query 兜底仅收 http,预填安全)。 */}
              <button
                onClick={() => {
                  navigate('/generation', {
                    state: {
                      prefill: {
                        inputType: 'style',
                        styleImageUrl: result.imageUrl,
                        artType: result.artType,
                      },
                    },
                  });
                }}
                aria-label="以此风格生成练习"
                title="以该作品风格语言生成新练习参考，非原作复刻"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-gold-dark text-gold-dark rounded-lg hover:bg-gold-dark hover:text-rice-100 transition-all duration-300"
              >
                <Wand2 className="w-5 h-5" />
                <span className="font-medium">以此风格生成练习</span>
              </button>
              <button
                onClick={() => {
                  document.querySelector('footer')?.scrollIntoView({ behavior: 'smooth' });
                }}
                aria-label="查看历史记录"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-cinnabar text-cinnabar rounded-lg hover:bg-cinnabar hover:text-rice-100 transition-all duration-300"
              >
                <span className="font-medium">查看历史记录</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* 切换类型重新分析：不重新上传图片，直接用新类型重新触发分析 */}
            {showTypeSwitcher && (
              <div className="flex flex-wrap justify-center items-center gap-2">
                <span className="text-sm text-ink-500 mr-2">选择新类型：</span>
                {artTypes.map((art) => {
                  const Icon = art.icon;
                  const isCurrent = selectedArtType === art.id;
                  return (
                    <button
                      key={art.id}
                      onClick={() => {
                        setSelectedArtType(art.id);
                        setShowTypeSwitcher(false);
                        setResult(null);
                        setAnalysisDuration(null);
                        setProgress(0);
                        setDetailIndex(0);
                        setStep('analyzing');
                      }}
                      disabled={isCurrent}
                      aria-label={art.name}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                        isCurrent
                          ? 'bg-ink-900/10 text-ink-400 cursor-not-allowed'
                          : 'bg-rice-50 border border-ink-200 text-ink-700 hover:bg-[#5a8a7a] hover:text-rice-100 hover:border-[#5a8a7a]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{art.name}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setShowTypeSwitcher(false)}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-ink-500 hover:text-ink-700 transition-colors"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
