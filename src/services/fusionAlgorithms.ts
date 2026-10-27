/**
 * 灵感嫁接 · 融合算法库 (P2 重构:双层语料库)
 * ===========================================================
 * 架构:9 个方法帧(METHOD_FRAMES) × 12 个风格包(STYLE_PACKS)
 * = 108 种组合的精调 prompt,集中固化、可审查、可快照测试。
 *
 * - 方法帧:按融合方法固化的中文分层指令(结构层/内容层/风格层...),
 *   含作品描述、配比等运行时插槽
 * - 风格包:按目标风格固化的画面语言描述(中文主体 + 英文媒介关键词,
 *   兼顾 GLM 中文理解与模型风格锚定)
 * - 运行时组装:方法帧 + 风格包 + 配比/强度词 + 质量尾缀
 *
 * 历史版本(英文长句动态拼接)备份于 backup/backup-20260808-1/。
 */

import type { ArtworkItem } from './artworksDatabase';
import type { FuseStyle, FuseMethod, FuseIntensity } from './fuseStandards';

export interface FusionContext {
  style: FuseStyle;
  method: FuseMethod;
  intensity: FuseIntensity;
  /** 作品A占比 0-1(0.5 = 均衡) */
  ratio: number;
  artwork1: ArtworkItem | null;
  artwork2: ArtworkItem | null;
}

/** 方法帧:根据上下文输出该方法的分层融合指令(中文) */
export type MethodFrame = (ctx: FusionContext) => string;

/* ===========================================================
 * 共享工具
 * =========================================================== */

/** 作品描述(中文主体,保留英文标题/作者原名) */
function describeArtwork(item: ArtworkItem | null, fallback: string): string {
  if (!item) return fallback;
  return `《${item.title}》(${item.artist},${item.era},${item.style},主题:${item.tags.join('、')})`;
}

/** 强度 → 中文修饰词 */
function intensityWord(value: number): string {
  if (value <= 0.25) return '极轻,基本保留原作气质,仅作点缀式融合';
  if (value <= 0.5) return '均衡,双方和谐共存';
  if (value <= 0.75) return '强烈,深度互渗,双方特征均鲜明';
  return '极致,彻底重构,大胆再想象';
}

/** 配比 → 主导描述(中文) */
function dominanceWord(ratio: number): string {
  if (ratio >= 0.8) return '作品A强烈主导';
  if (ratio >= 0.6) return '作品A主导,作品B点缀';
  if (ratio >= 0.4) return '作品A与作品B均衡';
  if (ratio >= 0.2) return '作品B主导,作品A点缀';
  return '作品B强烈主导';
}

/* ===========================================================
 * 方法帧层:9 种融合方法的固化分层指令
 * =========================================================== */

/** 构图借鉴:A 骨架 + B 内容填入 */
const compositionFrame: MethodFrame = (ctx) => {
  const fidelity = ctx.ratio >= 0.6
    ? '严格保留作品A的构图骨架、视觉重心与疏密开合'
    : '参考作品A的构图结构,允许创造性重构';
  return [
    `以「构图借鉴」方式融合两件作品。`,
    `结构层:${fidelity}(作品A:${describeArtwork(ctx.artwork1, '作品A')});`,
    `内容层:将作品B的题材、元素与色彩语言填入该骨架(作品B:${describeArtwork(ctx.artwork2, '作品B')});`,
    `风格层:整体以「${ctx.style.name}」手法渲染。`,
  ].join('');
};

/** 色彩迁移:A 明暗结构 + B 色彩体系 */
const colorTransferFrame: MethodFrame = (ctx) => {
  const keep = Math.round((1 - ctx.ratio) * 100);
  return [
    `以「色彩迁移」方式融合两件作品。`,
    `结构层:完整保留作品A的形体轮廓与明暗结构,不作形变(作品A:${describeArtwork(ctx.artwork1, '作品A')});`,
    `色彩层:整幅改用作品B的色相体系与饱和度节奏重新赋彩,同时保留约${keep}%作品A原始色调(作品B:${describeArtwork(ctx.artwork2, '作品B')});`,
    `氛围层:整体情绪追随作品B的氛围。`,
  ].join('');
};

/** 元素融合:A/B 标志性元素有机组合 */
const elementFusionFrame: MethodFrame = (ctx) => {
  const aLeads = ctx.ratio >= 0.5;
  const leadDesc = aLeads ? describeArtwork(ctx.artwork1, '作品A') : describeArtwork(ctx.artwork2, '作品B');
  const supportDesc = aLeads ? describeArtwork(ctx.artwork2, '作品B') : describeArtwork(ctx.artwork1, '作品A');
  return [
    `以「元素融合」方式融合两件作品。`,
    `元素层:提取双方最具标志性的视觉元素,以${aLeads ? 'A' : 'B'}方元素为主导(${leadDesc}),另一方为辅助(${supportDesc});`,
    `关联层:通过形状呼应、动势延续与质感互补,将两族元素编织进同一世界,避免拼贴感;`,
    `统一层:全幅统一于「${ctx.style.name}」。`,
  ].join('');
};

/** 风格转换:A 内容以 B 的艺术语言重新诠释 */
const styleTransformationFrame: MethodFrame = (ctx) => {
  const purity = ctx.ratio >= 0.6 ? '转换彻底而纯正' : '保留少许作品A的原始笔意';
  return [
    `以「风格转换」方式融合两件作品。`,
    `主题层:完整保留作品A的题材与叙事(作品A:${describeArtwork(ctx.artwork1, '作品A')});`,
    `风格层:以作品B的笔法逻辑、色彩体系与构图法则重新诠释,${purity}(作品B:${describeArtwork(ctx.artwork2, '作品B')});`,
    `技法层:最终以「${ctx.style.name}」呈现。`,
  ].join('');
};

/** 场景杂交:两个场景空间并置 + 过渡带 */
const hybridLandscapeFrame: MethodFrame = (ctx) => {
  const aPct = Math.round(ctx.ratio * 100);
  return [
    `以「场景杂交」方式融合两件作品。`,
    `空间层:画面约左${aPct}%呈现作品A的场景(${describeArtwork(ctx.artwork1, '作品A')}),右${100 - aPct}%呈现作品B的场景(${describeArtwork(ctx.artwork2, '作品B')});`,
    `过渡层:两个世界之间设计渐进诗意的过渡带,形态、色彩与氛围互相渗透溶解;`,
    `光影层:全幅统一光源方向与空气透视。`,
  ].join('');
};

/** 意境交融:情绪氛围加权混合 */
const moodBlendingFrame: MethodFrame = (ctx) => {
  const aPct = Math.round(ctx.ratio * 100);
  return [
    `以「意境交融」方式融合两件作品。`,
    `氛围层:作品A的情绪占${aPct}%(${describeArtwork(ctx.artwork1, '作品A')}),作品B的感受占${100 - aPct}%(${describeArtwork(ctx.artwork2, '作品B')}),二者交织,重意境共鸣而非如实再现;`,
    `光影层:光影的方向、柔硬与冷暖均服务于混合情绪;`,
    `色彩层:由混合情绪引导统一的色温与调性。`,
  ].join('');
};

/** 局部置换:A 主体 + B 环境 */
const regionSwapFrame: MethodFrame = (ctx) => {
  const env = Math.round((1 - ctx.ratio) * 100);
  return [
    `以「局部置换」方式融合两件作品。`,
    `主体层:作品A的主体保持完整、清晰、视觉主导(${describeArtwork(ctx.artwork1, '作品A')});`,
    `环境层:用作品B的环境、空间纵深与氛围替换作品A约${env}%的背景区域(${describeArtwork(ctx.artwork2, '作品B')});`,
    `边缘层:主体与新环境自然衔接,加上环境反射光与边界雾气。`,
  ].join('');
};

/** 材质嫁接:A 形态 + B 材质肌理 */
const materialGraftFrame: MethodFrame = (ctx) => {
  const coverage = Math.round(ctx.ratio * 100);
  return [
    `以「材质嫁接」方式融合两件作品。`,
    `形态层:保留作品A的轮廓剪影与结构关系(${describeArtwork(ctx.artwork1, '作品A')});`,
    `材质层:以作品B的材质肌理(釉面、纹理、织感、包浆等,依作品B而定)覆盖约${coverage}%的表面(${describeArtwork(ctx.artwork2, '作品B')});`,
    `光照层:保持单一统一光源,使新材质呈现可信的体积感与光泽。`,
  ].join('');
};

/** 时空折叠:同一画面中并置两个时代 */
const timeFoldFrame: MethodFrame = (ctx) => {
  const aPct = Math.round(ctx.ratio * 100);
  return [
    `以「时空折叠」方式融合两件作品。`,
    `时空层:同一场景中两个时代共存,${aPct}%取自作品A的时代(${describeArtwork(ctx.artwork1, '作品A')}),${100 - aPct}%取自作品B的时代(${describeArtwork(ctx.artwork2, '作品B')});`,
    `对照层:营造古今之间的诗意对话,时代衔接处应有意为之、意味深长;`,
    `透视层:两个时空共享统一的透视与空间逻辑。`,
  ].join('');
};

/**
 * 方法帧注册表(methodId → 帧函数)
 * 覆盖 fuseStandards.fuseMethods 全部 9 个方法
 */
export const METHOD_FRAMES: Record<string, MethodFrame> = {
  composition: compositionFrame,
  'color-transfer': colorTransferFrame,
  'element-fusion': elementFusionFrame,
  'style-transformation': styleTransformationFrame,
  'hybrid-landscape': hybridLandscapeFrame,
  'mood-blending': moodBlendingFrame,
  'region-swap': regionSwapFrame,
  'material-graft': materialGraftFrame,
  'time-fold': timeFoldFrame,
};

/* ===========================================================
 * 风格包层:12 种目标风格的固化画面语言
 * (中文主体描述 + 英文媒介关键词锚定模型风格)
 * =========================================================== */

export const STYLE_PACKS: Record<string, string> = {
  ink: '中国水墨写意画风(ink wash / sumi-e),宣纸纹理,浓淡干湿的笔墨变化,大量留白,写意传神',
  oil: '古典油画风(classical oil painting),厚涂笔触,戏剧性明暗对比,色彩浓郁有层次,博物馆级质感',
  watercolor: '透明水彩画风(watercolor),湿画法色彩自然流淌,水痕肌理清晰,纸张纹理可见,轻盈通透',
  minimal: '极简主义画风(minimalist),几何抽象构成,大面积留白,平涂纯色,线条干净克制',
  cyberpunk: '赛博朋克风(cyberpunk),霓虹灯光,未来都市夜景,高对比色彩,全息元素,雨夜氛围',
  'art-nouveau': '新艺术运动风(art nouveau),流动有机曲线,花卉藤蔓纹样,装饰性极强,线条优雅',
  'japanese-ukiyoe': '浮世绘木版画风(ukiyo-e),平涂色块,有力轮廓线,木纹质感,经典日式构图',
  surrealism: '超现实主义画风(surrealism),梦幻意象与错位并置,象征隐喻,漂浮元素,潜意识图景',
  dunhuang: '敦煌壁画风(dunhuang fresco),矿物石色(石绿、朱砂、赭石),飞天飘带与藻井纹样,斑驳壁画肌理',
  'song-academy': '宋代院体工笔画风(gongbi academy painting),精工细笔,典雅设色,绢本质感,格物写生',
  'blue-white': '青花瓷画风(blue-and-white porcelain),钴蓝分水,白瓷底色,缠枝莲纹,釉面光泽',
  papercut: '民间剪纸风(papercut),镂空通透,大红纯色,对称构图,吉祥民俗纹样',
  /* 2026-08-18 决赛新增:非遗专项嫁接风格包(对齐 fuseStandards 16 风格) */
  'embroidery-su': '苏绣针意风(su embroidery),丝缕光泽,细密针脚,渐变丝色,雅致灵动的双面绣质感',
  thangka: '唐卡矿彩风(tibetan thangka),度量经比例,石青石绿朱砂矿彩,金线勾勒,坛城式庄严构图',
  lacquer: '漆器髹光风(chinese lacquerware),大漆深邃温润光泽,螺钿镶嵌,红黑漆层,犀皮斑纹肌理',
  nianhua: '木版年画风(new year woodblock print),套色明快,木版刀味,门神民俗叙事,红黄绿饱和配色,饱满构图',
};

/* ===========================================================
 * 非遗纹样注入(Phase F:灵感嫁接非遗支持)
 * =========================================================== */

/**
 * 检测参与嫁接的作品中是否含非遗类目(category === 'heritage'),
 * 若有则注入非遗纹样特征语句,引导 AI 融合传统工艺手法与现代设计语言。
 *
 * 设计原则:
 *   1. 仅在任一作品为 heritage 时触发,普通嫁接 prompt 完全不变
 *      (现有 fusionAlgorithms.test.ts 108 组合用例不受影响)
 *   2. 非遗作品的 style 字段存放类目中文名(剪纸/刺绣/瓷器),
 *      tags 字段前段为 techniquePoints(技法要点),作为注入语料
 *   3. 注入语句独立成段,保留传统工艺神韵的同时赋予当代审美表达
 */
function heritageInjection(ctx: FusionContext): string {
  const heritageArtworks = [ctx.artwork1, ctx.artwork2].filter(
    (a): a is ArtworkItem => a?.category === 'heritage'
  );
  if (heritageArtworks.length === 0) return '';

  const featureParts = heritageArtworks.map((a) => {
    const subCategory = a.style || '非遗';
    // techniquePoints 映射到 tags 前段,取前 4 条避免 prompt 过长
    const points = a.tags.slice(0, 4).join('、');
    return points ? `${subCategory}的${points}手法` : `${subCategory}传统纹样`;
  });

  return `非遗纹样注入:融合${featureParts.join('与')},在保留传统工艺神韵与民俗文化意蕴的同时,以现代设计语言重新解构,赋予当代审美表达;`;
}

/* ===========================================================
 * 统一构建入口
 * =========================================================== */

/**
 * 组装融合 prompt:方法帧 + 风格包 + 配比/强度 + 非遗注入(可选) + 质量尾缀
 * 未知方法回退到元素融合帧;未知风格回退到 fuseStandards 的 promptModifier
 */
export function buildFusionPrompt(ctx: FusionContext): string {
  const frame = METHOD_FRAMES[ctx.method.id] ?? elementFusionFrame;
  const stylePack =
    STYLE_PACKS[ctx.style.id] ??
    `${ctx.style.name}画风(${ctx.style.promptModifier}),${ctx.style.characteristics.join('、')}`;
  const heritage = heritageInjection(ctx);
  return [
    frame(ctx),
    `风格要求:${stylePack}。`,
    heritage,
    `融合配比:${dominanceWord(ctx.ratio)};融合强度:${intensityWord(ctx.intensity.value)}。`,
    '画面质量:高品质、博物馆级、构图专业、细节丰富。',
  ]
    .filter((segment) => segment.length > 0)
    .join('');
}
