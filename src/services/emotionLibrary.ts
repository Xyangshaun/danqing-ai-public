/**
 * 东方情绪库 (P1)
 * ===========================================================
 * 18 种东方美学情绪,分 4 组:
 *   山水心境(5) / 花鸟生机(5) / 人文情思(4) / 气象万千(4)
 *
 * 每种情绪包含:中文名 / 英文 prompt 核心词 / 6 色色板 /
 * 关键词 / 艺术形式 / 画面元素,用于:
 *   1. EmotionPage 情绪选择与可视化
 *   2. 双情绪比例混合(mixPalettes / buildEmotionPrompt)
 *   3. AI 图像生成的 prompt 构建
 */

export type EmotionGroup = 'landscape' | 'flora' | 'humanity' | 'grandeur';

export interface EmotionEntry {
  id: string;
  name: string;
  group: EmotionGroup;
  /** 简短意境描述 */
  desc: string;
  /** 代表场景 */
  scene: string;
  /** 6 色色板(深 → 浅) */
  colorPalette: string[];
  /** 关键词联想 */
  keywords: string[];
  /** 艺术表现形式 */
  artForms: string[];
  /** 音乐意境 */
  musicMood: string;
  /** 英文 prompt 核心情绪词 */
  promptEn: string;
  /** 画面元素(英文,用于 prompt) */
  elements: string[];
}

export interface EmotionGroupMeta {
  label: string;
  desc: string;
  /** 组标识色 */
  accent: string;
}

export const EMOTION_GROUPS: Record<EmotionGroup, EmotionGroupMeta> = {
  landscape: { label: '山水心境', desc: '远山烟雨 · 天地大美', accent: '#2b6cb0' },
  flora: { label: '花鸟生机', desc: '草木有情 · 万物生长', accent: '#c53030' },
  humanity: { label: '人文情思', desc: '人间况味 · 心事幽微', accent: '#5a6b8a' },
  grandeur: { label: '气象万千', desc: '雷霆万钧 · 壮怀激烈', accent: '#b7791f' },
};

/* ===========================================================
 * 18 种情绪完整数据
 * =========================================================== */

export const EMOTION_LIBRARY: EmotionEntry[] = [
  /* ---------- 山水心境组 ---------- */
  {
    id: 'calm',
    name: '宁静',
    group: 'landscape',
    desc: '平和、清远、悠长',
    scene: '远山烟雨、湖面平镜、古寺禅意',
    colorPalette: ['#0d4f4f', '#2b6cb0', '#4299e1', '#63b3ed', '#90cdf4', '#bee3f8'],
    keywords: ['禅意', '悠远', '平和', '空灵', '自然'],
    artForms: ['青绿山水', '禅意画', '烟雨图', '平湖'],
    musicMood: '轻柔的竹笛、古筝与自然环境音',
    promptEn: 'serene tranquility',
    elements: ['misty mountains', 'still lake', 'distant temple', 'soft rain haze'],
  },
  {
    id: 'ethereal',
    name: '空灵',
    group: 'landscape',
    desc: '虚静、渺远、出尘',
    scene: '云雾缭绕、空谷幽兰、月下寒潭',
    colorPalette: ['#1a365d', '#2c5282', '#4a6fa5', '#7f9db9', '#b8cce4', '#e3edf7'],
    keywords: ['虚静', '出尘', '渺远', '澄澈', '无尘'],
    artForms: ['留白山水', '云水图', '寒潭月色', '幽谷图'],
    musicMood: '空灵的人声吟唱、微弱的钟磬余音',
    promptEn: 'ethereal emptiness',
    elements: ['swirling clouds', 'empty valley', 'moonlit pond', 'floating mist'],
  },
  {
    id: 'distant',
    name: '悠远',
    group: 'landscape',
    desc: '绵长、深邃、回望',
    scene: '长河落日、古道西风、关山万里',
    colorPalette: ['#3c366b', '#5a4f8a', '#7a6fae', '#9d94c4', '#c2bcdf', '#e2def0'],
    keywords: ['绵长', '深邃', '古道', '回望', '无尽'],
    artForms: ['长卷山水', '关山行旅', '落日长河', '驿道图'],
    musicMood: '悠长的箫声、缓慢的马头琴',
    promptEn: 'vast distance and longing',
    elements: ['endless river', 'setting sun', 'ancient road', 'layered ridges'],
  },
  {
    id: 'vast',
    name: '苍茫',
    group: 'landscape',
    desc: '辽阔、洪荒、寂寥',
    scene: '大漠孤烟、雪原无际、荒原落日',
    colorPalette: ['#2d3748', '#4a5568', '#6b7a90', '#8d99ae', '#b6c2cf', '#d9e2ec'],
    keywords: ['辽阔', '洪荒', '寂寥', '天地', '苍凉'],
    artForms: ['大漠图', '雪原图', '荒寒山水', '边塞画意'],
    musicMood: '苍凉的埙、低沉的呼麦',
    promptEn: 'boundless desolation',
    elements: ['vast desert', 'lone smoke column', 'endless snowfield', 'barren plain'],
  },
  {
    id: 'secluded',
    name: '隐逸',
    group: 'landscape',
    desc: '归隐、淡泊、自得',
    scene: '竹林茅屋、溪山渔隐、采菊东篱',
    colorPalette: ['#22543d', '#2f855a', '#48a868', '#6fbf8a', '#9fd6b2', '#c9e9d4'],
    keywords: ['归隐', '淡泊', '竹林', '渔樵', '自得'],
    artForms: ['竹林七贤', '渔隐图', '田园山水', '茅屋读书'],
    musicMood: '清淡的古琴、竹林风声与鸟鸣',
    promptEn: 'reclusive pastoral peace',
    elements: ['bamboo grove', 'thatched cottage', 'fishing boat', 'chrysanthemum fence'],
  },

  /* ---------- 花鸟生机组 ---------- */
  {
    id: 'joy',
    name: '喜悦',
    group: 'flora',
    desc: '热烈、奔放、欢腾',
    scene: '花开时节、节庆场面、孩童嬉戏',
    colorPalette: ['#742a2a', '#c53030', '#e53e3e', '#fc8181', '#feb2b2', '#fed7d7'],
    keywords: ['欢快', '热烈', '饱满', '生机', '欢腾'],
    artForms: ['工笔花鸟', '年画', '喜庆图', '繁花'],
    musicMood: '欢快的民乐合奏、节奏明快的鼓点',
    promptEn: 'joyful celebration',
    elements: ['blooming peonies', 'festival lanterns', 'playful birds', 'red silk ribbons'],
  },
  {
    id: 'hope',
    name: '希望',
    group: 'flora',
    desc: '破晓、绽放、温暖',
    scene: '黎明曙光、春天花朵、朝阳初升',
    colorPalette: ['#744210', '#c05621', '#d69e2e', '#ecc94b', '#f6e05e', '#faf089'],
    keywords: ['新生', '温暖', '光明', '憧憬', '生机'],
    artForms: ['朝霞图', '花卉静物', '春日田野', '金光山水'],
    musicMood: '温暖的弦乐、渐强的铜管,充满希望',
    promptEn: 'hopeful dawn light',
    elements: ['morning glow', 'spring blossoms', 'rising sun', 'dew on petals'],
  },
  {
    id: 'blooming',
    name: '烂漫',
    group: 'flora',
    desc: '繁盛、天真、绚烂',
    scene: '桃花满枝、樱花纷飞、山花烂漫',
    colorPalette: ['#97266d', '#b83280', '#d53f8c', '#ed64a6', '#f687b3', '#fbb6ce'],
    keywords: ['繁盛', '天真', '绚烂', '春日', '纷飞'],
    artForms: ['没骨花卉', '桃花源图', '百卉图', '春园图'],
    musicMood: '明快的琵琶轮指、轻盈的扬琴',
    promptEn: 'blooming exuberance',
    elements: ['peach blossoms', 'falling petals', 'wild hillside flowers', 'butterflies'],
  },
  {
    id: 'fresh',
    name: '清新',
    group: 'flora',
    desc: '淡雅、明净、初生',
    scene: '雨后新荷、清晨露珠、嫩柳初芽',
    colorPalette: ['#1d4044', '#25858a', '#38b2ac', '#4fd1c5', '#81e6d9', '#b2f5ea'],
    keywords: ['淡雅', '明净', '雨后', '初生', '露珠'],
    artForms: ['小写意花鸟', '荷塘清趣', '雨余图', '新绿图'],
    musicMood: '清脆的笛音、雨滴声与风铃',
    promptEn: 'fresh morning clarity',
    elements: ['lotus after rain', 'morning dew', 'young willow shoots', 'clear stream'],
  },
  {
    id: 'tender',
    name: '温婉',
    group: 'flora',
    desc: '柔美、含蓄、细腻',
    scene: '杏花微雨、江南春水、仕女拈花',
    colorPalette: ['#702459', '#9b2c5f', '#c0558a', '#d57ba6', '#e5a4c3', '#f3cbdd'],
    keywords: ['柔美', '含蓄', '细腻', '江南', '婉约'],
    artForms: ['仕女图', '杏花春雨', '工笔仕女', '江南春'],
    musicMood: '婉转的古筝、柔美的昆曲水磨腔',
    promptEn: 'gentle tender grace',
    elements: ['apricot blossoms in drizzle', 'jiangnan spring water', 'graceful figure', 'silk fan'],
  },

  /* ---------- 人文情思组 ---------- */
  {
    id: 'lonely',
    name: '孤独',
    group: 'humanity',
    desc: '空旷、留白、孤影',
    scene: '雪夜独行、月下孤舟、寒林独立',
    colorPalette: ['#1a202c', '#4a5568', '#718096', '#a0aec0', '#cbd5e0', '#e2e8f0'],
    keywords: ['孤寂', '清冷', '悠远', '静谧', '沉思'],
    artForms: ['水墨山水', '极简主义', '寒林图', '月夜'],
    musicMood: '舒缓、悠远、略带忧伤的钢琴与大提琴',
    promptEn: 'solitary loneliness',
    elements: ['lone boat under moon', 'snowy night path', 'solitary figure', 'bare winter trees'],
  },
  {
    id: 'melancholy',
    name: '忧伤',
    group: 'humanity',
    desc: '沉郁、含蓄、深远',
    scene: '秋日落叶、远山暮霭、雨中孤亭',
    colorPalette: ['#2d3748', '#4a5568', '#5a6b8a', '#718096', '#a0aec0', '#cbd5e0'],
    keywords: ['愁绪', '深沉', '含蓄', '秋意', '思念'],
    artForms: ['秋景山水', '墨梅', '雨景图', '暮霭'],
    musicMood: '低沉的二胡、缓慢的古琴旋律',
    promptEn: 'quiet melancholy',
    elements: ['falling autumn leaves', 'evening mist', 'rain pavilion', 'withered lotus'],
  },
  {
    id: 'nostalgia',
    name: '思念',
    group: 'humanity',
    desc: '缱绻、牵挂、追忆',
    scene: '故园东望、鸿雁传书、灯下缝衣',
    colorPalette: ['#4a2c2a', '#6d3d3a', '#8f5a50', '#b07d6b', '#cba28f', '#e3c6b8'],
    keywords: ['缱绻', '牵挂', '故园', '鸿雁', '灯下'],
    artForms: ['羁旅图', '家书图', '故园小景', '月夜怀人'],
    musicMood: '缠绵的琵琶、低回的箫声',
    promptEn: 'deep nostalgic yearning',
    elements: ['migrating geese', 'old hometown gate', 'oil lamp', 'letter brush and ink'],
  },
  {
    id: 'zen',
    name: '禅意',
    group: 'humanity',
    desc: '空无、寂静、顿悟',
    scene: '枯山水庭、古刹钟声、一钵一杖',
    colorPalette: ['#2f2a26', '#57504a', '#7d746d', '#a39a92', '#c8c1ba', '#e8e3dd'],
    keywords: ['空无', '寂静', '顿悟', '枯山水', '一味'],
    artForms: ['枯山水', '禅画', '泼墨罗汉', '茶室小景'],
    musicMood: '一声声缓慢的磬、极静的留白',
    promptEn: 'zen meditative stillness',
    elements: ['dry rock garden', 'raked sand patterns', 'temple bell', 'single tea bowl'],
  },

  /* ---------- 气象万千组 ---------- */
  {
    id: 'passion',
    name: '激情',
    group: 'grandeur',
    desc: '澎湃、炽烈、动感',
    scene: '烈火燎原、骏马奔腾、惊涛拍岸',
    colorPalette: ['#7f1d1d', '#c53030', '#e53e3e', '#f56565', '#fc8181', '#fed7d7'],
    keywords: ['奔放', '力量', '动感', '炽烈', '磅礴'],
    artForms: ['泼墨山水', '奔马图', '海浪图', '火焰'],
    musicMood: '激昂的交响乐、强烈的节奏与铜管',
    promptEn: 'burning passionate energy',
    elements: ['galloping horses', 'crashing waves', 'raging fire', 'splashed ink'],
  },
  {
    id: 'heroic',
    name: '豪迈',
    group: 'grandeur',
    desc: '旷达、雄浑、慷慨',
    scene: '大江东去、把酒临风、立马昆仑',
    colorPalette: ['#5f370e', '#8a4b23', '#b0693a', '#c98a52', '#ddab7c', '#eccba6'],
    keywords: ['旷达', '雄浑', '慷慨', '大江', '临风'],
    artForms: ['大江东去图', '立马图', '豪放人物', '边塞诗画'],
    musicMood: '豪放的唢呐、激越的战鼓',
    promptEn: 'heroic bold spirit',
    elements: ['mighty river eastward', 'warrior on horseback', 'wind blown robe', 'high cliffs'],
  },
  {
    id: 'majestic',
    name: '磅礴',
    group: 'grandeur',
    desc: '雄伟、壮阔、巍峨',
    scene: '五岳凌云、黄河咆哮、万里长城',
    colorPalette: ['#232838', '#3d4759', '#5a6a7f', '#7b8ea3', '#a3b5c4', '#c9d6e0'],
    keywords: ['雄伟', '壮阔', '巍峨', '五岳', '凌云'],
    artForms: ['金碧山水', '五岳图', '长城图卷', '黄河图'],
    musicMood: '恢弘的编钟、厚重的交响低音',
    promptEn: 'majestic monumental grandeur',
    elements: ['towering five peaks', 'roaring yellow river', 'great wall ridges', 'sea of clouds'],
  },
  {
    id: 'tragic',
    name: '壮烈',
    group: 'grandeur',
    desc: '悲怆、崇高、决绝',
    scene: '易水悲歌、乌江落日、断戟沉沙',
    colorPalette: ['#3a1c22', '#6b2737', '#94404f', '#b35d68', '#cd8a92', '#e2b7bd'],
    keywords: ['悲怆', '崇高', '决绝', '易水', '残阳'],
    artForms: ['历史画', '易水送别', '残阳如血', '古战场'],
    musicMood: '悲壮的鼓角、苍凉的大提琴',
    promptEn: 'tragic heroic sacrifice',
    elements: ['blood red sunset', 'broken halberd in sand', 'cold river crossing', 'fallen banner'],
  },
];

/* ===========================================================
 * 工具函数
 * =========================================================== */

const BY_NAME = new Map(EMOTION_LIBRARY.map((e) => [e.name, e]));
const BY_ID = new Map(EMOTION_LIBRARY.map((e) => [e.id, e]));

export function getEmotionByName(name: string): EmotionEntry {
  return BY_NAME.get(name) ?? EMOTION_LIBRARY[0];
}

export function getEmotionById(id: string): EmotionEntry {
  return BY_ID.get(id) ?? EMOTION_LIBRARY[0];
}

/** 按分组返回情绪列表 */
export function getEmotionsByGroup(): { group: EmotionGroup; meta: EmotionGroupMeta; items: EmotionEntry[] }[] {
  const order: EmotionGroup[] = ['landscape', 'flora', 'humanity', 'grandeur'];
  return order.map((group) => ({
    group,
    meta: EMOTION_GROUPS[group],
    items: EMOTION_LIBRARY.filter((e) => e.group === group),
  }));
}

/* ---------- 色板混合算法 ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function mixColors(c1: string, c2: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(r1 * ratio + r2 * (1 - ratio), g1 * ratio + g2 * (1 - ratio), b1 * ratio + b2 * (1 - ratio));
}

/**
 * 双情绪色板混合
 * @param primary 主情绪色板
 * @param secondary 次情绪色板
 * @param ratio 主情绪占比 0-1(1 = 纯主情绪)
 * @returns 混合后的 6 色色板
 */
export function mixPalettes(primary: string[], secondary: string[], ratio: number): string[] {
  const len = Math.max(primary.length, secondary.length);
  return Array.from({ length: len }, (_, i) => {
    const c1 = primary[Math.min(i, primary.length - 1)];
    const c2 = secondary[Math.min(i, secondary.length - 1)];
    return mixColors(c1, c2, ratio);
  });
}

/* ---------- 生成参数 ---------- */

export interface GenerationParams {
  /** 画幅 */
  aspect: 'square' | 'landscape' | 'portrait';
  /** 构图密度 0-1(0 极简 → 1 繁复) */
  density: number;
  /** 笔触力度 0-1(0 细腻 → 1 豪放) */
  brushwork: number;
  /** 留白程度 0-1(0 少留白 → 1 大量留白) */
  negativeSpace: number;
}

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  aspect: 'square',
  density: 0.5,
  brushwork: 0.5,
  negativeSpace: 0.5,
};

/** 画幅 → imageService size 参数 */
export function aspectToSize(aspect: GenerationParams['aspect']): string {
  switch (aspect) {
    case 'landscape':
      return 'landscape_4_3';
    case 'portrait':
      return 'portrait_4_3';
    default:
      return 'square';
  }
}

/* ---------- Prompt 构建 ---------- */

function describeRange(value: number, levels: [string, string, string]): string {
  if (value < 0.35) return levels[0];
  if (value > 0.7) return levels[2];
  return levels[1];
}

/**
 * 构建情绪画布 prompt(升级逻辑)
 *
 * 单情绪: 情绪词 + 元素 + 参数描述
 * 双情绪: 按比例分配主/次情绪词与元素权重
 */
export function buildEmotionPrompt(
  primary: EmotionEntry,
  secondary: EmotionEntry | null,
  ratio: number,
  params: GenerationParams,
  intensity: number,
): string {
  const parts: string[] = [];

  /* 1. 情绪主体 */
  if (secondary) {
    const pct = Math.round(ratio * 100);
    parts.push(
      `${primary.promptEn} as dominant mood (${pct}%) blended with ${secondary.promptEn} undertone (${100 - pct}%)`,
    );
  } else {
    const strength = describeRange(intensity, ['subtle gentle', 'balanced', 'intense profound']);
    parts.push(`${strength} ${primary.promptEn}`);
  }

  /* 2. 画面元素(主情绪取 3,次情绪按比例取 1-2) */
  const primaryElements = primary.elements.slice(0, 3);
  if (secondary && ratio < 0.85) {
    const secondaryCount = ratio > 0.6 ? 1 : 2;
    parts.push([...primaryElements, ...secondary.elements.slice(0, secondaryCount)].join(', '));
  } else {
    parts.push(primaryElements.join(', '));
  }

  /* 3. 艺术形式 */
  parts.push(primary.artForms[0] ? `${primary.artForms[0]} style` : 'chinese traditional painting');

  /* 4. 生成参数描述 */
  parts.push(describeRange(params.density, ['minimal sparse composition', 'balanced composition', 'dense intricate composition']));
  parts.push(describeRange(params.brushwork, ['delicate fine brushwork', 'moderate brushwork', 'bold expressive brushwork']));
  parts.push(describeRange(params.negativeSpace, ['rich filled canvas', 'moderate negative space', 'generous empty negative space']));

  /* 5. 双情绪色彩引导 */
  if (secondary) {
    parts.push(`color palette dominated by ${primary.colorPalette[1]} with accents of ${secondary.colorPalette[1]}`);
  }

  parts.push('chinese traditional painting aesthetic, high quality, masterpiece');
  return parts.join(', ');
}
