// ============================================================
// 丹青有AI - 专业美术/非遗术语词典（B 模块 ArtTermTooltip 专用数据源）
//
// 设计原则:
//   1. 术语覆盖：初学者最容易卡住的 60+ 术语（按使用频率排序）
//   2. 解释风格：大白话 + 画面类比 / 生活类比（不是教材定义，是"一听就懂"）
//   3. 术语类别（category）：
//        composition  构图类
//        color        色彩类
//        technique    技法/造型类
//        aesthetic    美学原理类
//        heritage     非遗专属类
//   4. 与 Prompt 对齐：AI 输出解释格式是「专业名词(白话解释)」，
//      词典的 definition 就是括号里那句白话的扩展版
//   5. 别名（aliases）：如"计白当黑"也叫"留白经营",查询时命中任一即返回
// ============================================================

export type ArtTermCategory =
  | 'composition'
  | 'color'
  | 'technique'
  | 'aesthetic'
  | 'heritage';

/** 单条术语记录 */
export interface ArtTermRecord {
  /** 标准术语名 */
  term: string;
  /** 类别（用于分类筛选 + 标签配色） */
  category: ArtTermCategory;
  /** 白话解释（口语化,1 句话懂） */
  definition: string;
  /** 更深入的解释/画面类比/生活类比（可选,悬停气泡里展开） */
  elaboration?: string;
  /** 别名/近义词/其他说法（查询时用） */
  aliases?: string[];
}

export const ART_TERM_DICTIONARY: ArtTermRecord[] = [
  // ===================== composition 构图类 =====================
  {
    term: '视觉重心',
    category: 'composition',
    definition: '整张画第一眼最吸引你视线落下去的那个点；如果重心偏了,画面就会像往一边倒的天平,让人看着不舒服。',
    aliases: ['画面重心', '视觉落点', '受力中心'],
  },
  {
    term: '黄金分割',
    category: 'composition',
    definition: '也叫 1:0.618 的"好看比例",把一张画用两条横线+两条竖线分成 9 格,交叉点就是放主角最顺眼的位置。',
    elaboration: '生活类比:手机壁纸里主角总放在上 1/3 处、电影海报人物总在左右 1/3 处——这都是黄金分割。因为人眼天然喜欢 0.618 这个比例。',
    aliases: ['黄金比例', '黄金分割比', '0.618'],
  },
  {
    term: '三分法',
    category: 'composition',
    definition: '把画面横竖各分成 3 份（画"井"字）,把主角、地平线等关键东西放在分线上或交叉点上,瞬间就变好看。',
    elaboration: '最容易上手的构图方法。拍风景照时把地平线放下 1/3 线 = 天空多;放上 1/3 线 = 地面多,都比放正中好看。',
    aliases: ['井字构图', '九宫格构图', '三分构图'],
  },
  {
    term: '构图',
    category: 'composition',
    definition: '就是"东西在纸上怎么摆"——你画的东西放在哪、占多大、彼此之间远近前后关系怎么安排,这就是构图。',
    aliases: ['画面构成', '经营位置'],
  },
  {
    term: '留白',
    category: 'composition',
    definition: '不是"没画的空白地方",是你特意留出来给视线喘气的地方——就像一句话里要有停顿和逗号,人才不会读窒息。',
    aliases: ['计白当黑', '空白经营', '气口'],
  },
  {
    term: '计白当黑',
    category: 'composition',
    definition: '中国传统画里最重要的一条审美原则：画出来的黑线条重要,没画的白空白同样重要,两者是互补的,要一起"设计"。',
    elaboration: '生活类比:一张海报文字堆得满满的就难看——不是字写得不好,是没给眼睛留"白"。国画里一张大纸只画一条小鱼,剩下的留白就是意境。',
    aliases: ['留白', '空白经营', '知白守黑'],
  },
  {
    term: '主次关系',
    category: 'composition',
    definition: '一张画里必须有"最重要的主角(主)"和"让主角更突出的配角(次)"；不能每件东西都一样大一样抢眼,否则就像一个乐队所有人同时独奏,吵。',
    aliases: ['主次', '主宾关系'],
  },
  {
    term: '虚实关系',
    category: 'composition',
    definition: '画里有的地方画得清清楚楚、细节满满的 = "实"(主角);有的地方虚虚的、朦胧淡掉 = "虚"(背景/远处)。虚是为了托实,让主角被看见。',
    elaboration: '就像手机拍人像,"人像模式"自动把人拍清楚、背景模糊掉——这就是虚实关系在帮主角突出。',
    aliases: ['虚实', '虚实对比'],
  },
  {
    term: '疏密对比',
    category: 'composition',
    definition: '线条、颜色、物体的摆放不能平均密度——有的地方密得挤挤的(紧),有的地方疏得空空的(松),一密一疏画面才有节奏感。',
    elaboration: '生活类比:一首歌不能从头到尾一样快一样响,要有密集的副歌,也要有松散的主歌,才好听。画画同理。',
    aliases: ['疏密', '松紧关系'],
  },
  {
    term: '画面节奏',
    category: 'composition',
    definition: '画面里"大大小小、密密麻麻、虚虚实实"交替出现的规律感;有节奏的画,视线会顺着它走,没节奏的画看一眼就散了。',
    aliases: ['节奏', '韵律'],
  },
  {
    term: '透视',
    category: 'composition',
    definition: '把"三维立体的世界"画在"一张二维平纸"上的方法:近大远小、近宽远窄、近长远短,让人一看就觉得"这是有空间深度的"。',
    aliases: ['透视线', '透视关系'],
  },
  {
    term: '引导线',
    category: 'composition',
    definition: '画面里的线(道路、河流、手臂、墙沿)会牵着观者视线往前走;利用它把视线引到主角身上,就是高级构图技巧。',
  },
  {
    term: '受力平衡',
    category: 'aesthetic',
    definition: '把画面想象成一台天平,左边放了重东西(面积大/颜色深/细节多),右边也要有"东西"压一下,不然画会"往一边倒"。',
    elaboration: '注意:平衡 ≠ 对称。对称是左右一模一样重;平衡是左边一个大西瓜,右边三个橘子,重量相等但形态不同,画面更高级。',
    aliases: ['视觉平衡', '画面平衡'],
  },
  {
    term: '团块化',
    category: 'composition',
    definition: '莫兰迪静物画常用的方法:把 3-4 件零散物品合并、看成一个整体的大几何形来画,不让它们各自"独立发光",画面立刻就整体了。',
    aliases: ['整体团块', '归堆处理'],
  },
  {
    term: '构图偏移',
    category: 'composition',
    definition: '主角或视觉重心放得太偏(比如全堆在左边 1/4),右边留白过多空落落,画面会"失重"。',
  },
  {
    term: '比例',
    category: 'technique',
    definition: 'A 东西和 B 东西相比的大小关系,比如人头和身体比例是 1:7,杯子和茶壶不能一样大;比例错了,人就会像大头娃娃。',
    aliases: ['大小比例', '尺寸关系'],
  },

  // ===================== color 色彩类 =====================
  {
    term: '色调',
    category: 'color',
    definition: '整张画给人的"大颜色感觉"——是蓝蓝冷冷的冷色调,还是黄黄暖暖的暖色调?色调统一了,哪怕里面颜色多,也不乱。',
    aliases: ['画面主色调', '整体色调'],
  },
  {
    term: '冷暖对比',
    category: 'color',
    definition: '色环上蓝绿灰 = 冷色,红黄橙 = 暖色;冷和暖放一起会互相衬得对方更鲜明。一张画全冷会闷、全暖会燥,冷暖搭配才高级。',
    aliases: ['冷暖关系', '冷暖色对比'],
  },
  {
    term: '色彩和谐',
    category: 'color',
    definition: '一组颜色放一起让人眼睛舒服,不打架;常见 5 种和谐方式:邻近色、互补色、三角色、分裂互补、四色。',
    elaboration: '邻近色 = 色环上隔壁邻居(如黄+橙),最温柔;互补色 = 对面冤家(红+绿/蓝+橙/黄+紫),最耀眼。',
  },
  {
    term: '邻近色',
    category: 'color',
    definition: '色环上紧挨着的颜色(红+橙、蓝+绿、黄+黄绿),它们是"亲戚",放一起不会打架,最温柔和谐。',
    aliases: ['相邻色', '类似色'],
  },
  {
    term: '互补色',
    category: 'color',
    definition: '色环上正对面的那一对(红-绿、蓝-橙、黄-紫),是视觉上最"刺激"的搭档,碰在一起会让对方更亮更抢眼。',
    elaboration: '用互补色的诀窍:一个大块面积(比如 70% 蓝),另一个小块当点缀(30% 橙),不然就会像乡村大舞台——太吵。',
    aliases: ['对比色', '补色'],
  },
  {
    term: '饱和度',
    category: 'color',
    definition: '颜色的"鲜艳程度"——红得像鞭炮红 = 饱和度高;红得像旧墙褪了色的灰粉 = 饱和度低。',
    aliases: ['纯度', '鲜艳度', '彩度'],
  },
  {
    term: '明度',
    category: 'color',
    definition: '颜色的"亮不亮"——同一种红,加白变亮(高明度),加黑变暗(低明度);一张画不能都亮或都暗,要拉开。',
    aliases: ['亮度', '明暗', '黑白灰'],
  },
  {
    term: '黑白灰',
    category: 'color',
    definition: '哪怕画的是彩色,把它变成黑白照片后,画面里"深色(黑)/中色(灰)/浅色(白)"三层要都有,画面才"立"得起来。',
    elaboration: '90% 的新手画"灰"了——不是颜色灰,是黑白灰没有拉开,颜色都堆在中间灰那一层,没对比就没精神。',
  },
  {
    term: '色彩过渡',
    category: 'color',
    definition: '一种颜色渐变到另一种颜色、或亮面渐变到暗面时,中间有没有"软台阶",跳了就是硬、不自然;顺了就是柔、高级。',
    aliases: ['过渡', '渐变过渡'],
  },
  {
    term: '色调沉闷',
    category: 'color',
    definition: '整张画颜色都灰灰浊浊、没有一个亮点或一个重色压住,像阴天没出太阳,看着没精神。',
  },
  {
    term: '主色调',
    category: 'color',
    definition: '占画面 60% 以上的"大底色",决定这张画的整体感觉;一张画必须有主色调,各色各占 50% 就打架了。',
  },
  {
    term: '空气感',
    category: 'aesthetic',
    definition: '画里有"透气"的感觉,不是东西塞满了,视线能在物体之间绕来绕去,像真的有空气在流动。',
    aliases: ['呼吸感', '空间气息'],
  },

  // ===================== technique 技法 / 造型类 =====================
  {
    term: '笔触',
    category: 'technique',
    definition: '画笔(或铅笔、剪刀、刻刀)在画面上留下的痕迹——长/短/方/圆/干/湿,笔触就是作品的"笔迹性格"。',
    aliases: ['用笔', '笔法'],
  },
  {
    term: '造型',
    category: 'technique',
    definition: '"画出来的这东西像不像、准不准"——人物头身比例、苹果圆不圆、杯子直不直,这都是造型能力。',
    aliases: ['造型准确', '形体'],
  },
  {
    term: '塑造',
    category: 'technique',
    definition: '把一个平面的形状画出"三维立体鼓起来"的过程,靠的是明暗层次、颜色冷暖渐变;塑造够了,东西就摸得着。',
    aliases: ['体积塑造', '立体感'],
  },
  {
    term: '质感',
    category: 'technique',
    definition: '画出来的东西让你一看就"知道摸上去是什么感觉"——玻璃是光滑的、羊毛是毛茸茸的、石头是粗糙的,这就是质感。',
    aliases: ['材质感', '肌理'],
  },
  {
    term: '肌理',
    category: 'technique',
    definition: '物体表面凹凸不平的纹理——皮肤的毛孔、树皮的裂纹、粗布的颗粒;肌理做对了,画面就"高级"。',
    aliases: ['纹理', '质感细节'],
  },
  {
    term: '体块',
    category: 'technique',
    definition: '把复杂东西(比如人头)拆成简单几何体(立方体、球体、圆柱)去理解,画的时候用几何体的明暗来画,立体感就一下有了。',
    aliases: ['形体归纳', '几何归纳'],
  },
  {
    term: '结构',
    category: 'technique',
    definition: '东西"长什么样、里面怎么搭的骨架"——人物的肌肉骨骼、苹果从蒂到脐的走向、衣服里面肩膀的形状,这都是结构。',
    aliases: ['内在结构', '解剖结构'],
  },
  {
    term: '明暗交界线',
    category: 'technique',
    definition: '立体物体上"亮面和暗面交界的那一圈",是整幅画里最暗的地方,把它画对了,物体就"立"起来了。',
  },
  {
    term: '灰面',
    category: 'technique',
    definition: '亮面到暗面之间的过渡色,决定物体的圆润度;新手常跳过灰面直接亮接暗,物体就会像铁片一样"硬"。',
  },
  {
    term: '高光',
    category: 'technique',
    definition: '物体上最亮的那一点(光源直接反射的地方),高光的形状直接决定物体质感——圆高光=光滑金属,方高光=玻璃。',
  },
  {
    term: '完整度',
    category: 'aesthetic',
    definition: '这幅画"画完了吗"的指标——有没有哪个区域明显还停留在草稿阶段、细节没跟上、边缘没收口,整体是否从头到尾气息连贯。',
    aliases: ['完成度'],
  },
  {
    term: '画面关系',
    category: 'aesthetic',
    definition: '画里所有东西"搭在一起合不合"——主次、虚实、冷暖、黑白灰、远近、色彩之间的相互关系,关系对了,单看每个局部都一般,合起来就好看。',
  },

  // ===================== aesthetic 美学原理类 =====================
  {
    term: '形式美法则',
    category: 'aesthetic',
    definition: '人类几千年总结出的"好看的规矩"——对称/均衡/对比/和谐/节奏/比例/主次/多样统一,共 8 条,符合了就好看。',
    elaboration: '不用背,观察任何你觉得美的东西(建筑/海报/名画/美女),都能在里面找到至少 3 条以上形式美法则。',
  },
  {
    term: '多样统一',
    category: 'aesthetic',
    definition: '形式美法则最高级的一条:画面东西要多样(不能太单调),但多样的东西底下要用一种规则统一(不能太乱),既丰富又整体。',
    aliases: ['变化与统一', '对比与调和'],
  },
  {
    term: '对比与统一',
    category: 'aesthetic',
    definition: '对比 = 故意把两样东西做不一样(大/小,黑/白,冷/暖)让它们互相突出;统一 = 又让它们同时在一个大规则里,不打架。',
    aliases: ['对比与调和'],
  },
  {
    term: '韵律',
    category: 'aesthetic',
    definition: '画面里"重复出现又有变化"的规律感——像诗歌的押韵、音乐的节拍,看的人视线会跟着走,觉得有味。',
  },
  {
    term: '意境',
    category: 'aesthetic',
    definition: '画里传递的"情绪+想象空间"。不是画了什么东西,而是看完后你心里被带出来的那种感觉——寂寥、温润、苍茫、热烈。',
    elaboration: '一张画只画一条小船 + 一片大留白,你会觉得"孤独"或"旷远",这就是意境——是画面之外的东西。',
    aliases: ['气韵', '氛围'],
  },
  {
    term: '气韵',
    category: 'aesthetic',
    definition: '中国传统画论最高审美标准:一张画里有没有"活气",线条/笔触/物体是不是像有生命在流动,而不是死的。',
    aliases: ['气韵生动', '气息'],
  },
  {
    term: '审美判断力',
    category: 'aesthetic',
    definition: '不是"画功",是"看出来好不好、为什么好、怎么改会更好"的眼光。审美能力上去了,手才能跟上去;否则只会越画越熟,不会越画越好。',
    elaboration: '训练方法很简单:每画完一张,先别改,先问自己 3 个问题:①如果画面是天平,它会往哪边倒?②如果是音乐,会不会乐器同时独奏太满?③视线停留 3 秒后会看到哪、能不能走完整张画?',
  },
  {
    term: '风格识别度',
    category: 'aesthetic',
    definition: '把你的作品和同类 100 张作品混在一起,别人能否一眼认出"这是你画的"?识别度高的作品有个人语言,不是千篇一律。',
  },
  {
    term: '原创性',
    category: 'aesthetic',
    definition: '不是"完全不看别人"才叫原创,而是你看了 100 个别人的好东西后,消化重组,长出属于你自己的表达方法——那就是原创。',
  },

  // ===================== heritage 非遗专属类 =====================
  {
    term: '阳剪',
    category: 'heritage',
    definition: '剪纸里的"正形剪法":把要表现的纹样(比如一只蝙蝠)的线条都连着保留下来,镂空的是线条之外的地方。阳剪=定造型。',
    elaboration: '口诀:"阳剪连,阴剪断;阳剪形,阴剪魂。"',
    aliases: ['阳刻剪纸', '阳刻'],
  },
  {
    term: '阴剪',
    category: 'heritage',
    definition: '剪纸里的"反形剪法":把图案的线条挖空去掉,靠"镂空"来表现形状。阴剪的空比实还重要,是营造韵律和气息的关键。',
    elaboration: '口诀:"阳剪连,阴剪断;阳剪形,阴剪魂。"',
    aliases: ['阴刻剪纸', '阴刻'],
  },
  {
    term: '对折剪',
    category: 'heritage',
    definition: '剪纸最基础的技法:把纸对折一次或多次,剪一半展开就得到镜像对称图案;90% 的传统窗花都是对折剪出来的。',
    aliases: ['折剪法', '对称剪'],
  },
  {
    term: '刀工流畅度',
    category: 'heritage',
    definition: '剪纸里评价好坏的第一条:大轮廓能不能一刀直直走到底,不出现"抖、碎、断、毛"——流畅的线条看着就舒服,抖线像磕巴一样让人揪心。',
  },
  {
    term: '走线如流水 落脚如钉钉',
    category: 'heritage',
    definition: '剪纸老艺人口诀:走长线时要像河水一样顺流而下,一刀走到底;收刀落点时要像钉子钉进木板一样准而稳,不飘不歪。',
    aliases: ['剪纸口诀', '老艺人口诀'],
  },
  {
    term: '通气',
    category: 'heritage',
    definition: '扬州剪纸审美原则之一:"满而不堵"——题材可以铺满整张纸,但线条与线条之间必须留"气口"(细小的连通镂空),让光能透过去,画面就不死。',
    aliases: ['气口', '不堵'],
  },
  {
    term: '满而不堵',
    category: 'heritage',
    definition: '民间剪纸/刺绣/瓷器装饰的最高审美:内容可以满满当当、热热闹闹(符合民间"求满"心理),但通过虚实/留白/气口的处理,看着不挤不闷。',
  },
  {
    term: '团花',
    category: 'heritage',
    definition: '剪纸里最经典的构图:把纸对折 2-4 次后剪,展开是一个完美对称的圆形花纹(像花一样),用于春节窗花心、婚庆喜字。',
  },
  {
    term: '针法',
    category: 'heritage',
    definition: '刺绣里的"用笔方法":线怎么走、怎么绕、怎么填。常见针法:苏绣齐针/乱针绣、湘绣鬅毛针、蜀绣车凝针、粤绣金银线绣——针法决定风格。',
    aliases: ['刺绣针法'],
  },
  {
    term: '齐针',
    category: 'heritage',
    definition: '苏绣最基础的针法:线条排列整齐,边口齐平不露底,像用尺子比着画出来一样。用于绣图案轮廓和大面积色块。',
  },
  {
    term: '乱针绣',
    category: 'heritage',
    definition: '苏绣里"像油画一样"的针法:线条长短不一、纵横交叉、层层叠加,远看融合成柔和的色彩过渡,适合绣肖像和风景。',
    aliases: ['正则绣', '杨守玉针法'],
  },
  {
    term: '釉色',
    category: 'heritage',
    definition: '瓷器表面那层玻璃质的颜色涂层——汝窑天青釉、钧窑窑变釉、青花釉里红、粉彩珐琅彩……釉色是评价瓷器好坏的半壁江山。',
    aliases: ['瓷器釉色', '釉面'],
  },
  {
    term: '开片',
    category: 'heritage',
    definition: '哥窑等青瓷最著名的釉面效果:釉层上出现像冰裂一样的细裂纹,这原本是烧制缺陷,后来变成人为追求的残缺美——"金丝铁线"。',
  },
  {
    term: '窑变',
    category: 'heritage',
    definition: '钧窑最神奇的地方:同一件瓷器入窑,高温下釉料里的金属元素自然流动反应,出窑后每一件颜色花纹都不一样——"入窑一色,出窑万彩"。',
  },
  {
    term: '纹样寓意',
    category: 'heritage',
    definition: '非遗里每个形状图案都有"潜台词":蝙蝠=福、鹿=禄、牡丹=富贵、鱼=年年有余、万字回纹=连绵不绝——不懂寓意就只看到"花",懂了才看到祝福和文化。',
  },
];

// ============================================================
// 工具函数:查询术语（term 精准命中或 aliases 模糊命中,均返回）
// ============================================================

/** 归一化字符串（去空格、全半角、大小写、标点）用于别名匹配 */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。？！、/\\（）()「」"'《》:：]/g, '');
}

/** 查单个术语:命中返回 ArtTermRecord,未命中返回 null */
export function findArtTerm(query: string): ArtTermRecord | null {
  const q = normalize(query);
  if (!q) return null;
  for (const rec of ART_TERM_DICTIONARY) {
    if (normalize(rec.term) === q) return rec;
    if (rec.aliases?.some((a) => normalize(a) === q)) return rec;
  }
  // 再做一次包含:别名里包含 query 也算命中（处理"计白当黑是啥"）
  for (const rec of ART_TERM_DICTIONARY) {
    if (normalize(rec.term).includes(q)) return rec;
    if (rec.aliases?.some((a) => normalize(a).includes(q))) return rec;
  }
  return null;
}

/** 批量查一段文本里出现了哪些术语（用于报告整体扫描），返回 { term, offset, record }[] */
export function scanTermsInText(text: string): Array<{ term: string; offset: number; record: ArtTermRecord }> {
  if (!text) return [];
  const out: Array<{ term: string; offset: number; record: ArtTermRecord }> = [];
  // 按术语长度降序,优先识别长术语（"黄金分割"优先于"黄金"）
  const sorted = [...ART_TERM_DICTIONARY].sort((a, b) => {
    const la = Math.max(a.term.length, ...(a.aliases?.map((x) => x.length) ?? [0]));
    const lb = Math.max(b.term.length, ...(b.aliases?.map((x) => x.length) ?? [0]));
    return lb - la;
  });
  const used = new Set<number>();
  for (const rec of sorted) {
    const needles = [rec.term, ...(rec.aliases ?? [])];
    for (const needle of needles) {
      if (needle.length < 2) continue; // 太短忽略(避免"色"单字命中)
      let idx = text.indexOf(needle, 0);
      while (idx >= 0) {
        // 避免重叠命中
        let overlap = false;
        for (let i = idx; i < idx + needle.length; i++) {
          if (used.has(i)) { overlap = true; break; }
        }
        if (!overlap) {
          for (let i = idx; i < idx + needle.length; i++) used.add(i);
          out.push({ term: needle, offset: idx, record: rec });
        }
        idx = text.indexOf(needle, idx + 1);
      }
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}
