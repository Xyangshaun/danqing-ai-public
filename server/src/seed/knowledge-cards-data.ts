// ============================================================
// 丹青有AI - KnowledgeCard 系统内置 Seed 数据(参考图混合方案 Phase 3 批次①)
// 首批 28 张 = 素描 15 + 色彩 8 + 速写 5
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §5(KnowledgeCard)/§6 Phase 3
//
// problemPattern 关键词来源:ai-vision.service.ts 标注高频问题模式反推
//   (明度/灰/对比/重心/比例/衣纹等,批次③匹配引擎按关键词包含评分)
// 注入方式:prisma db seed,isBuiltIn=true(首版纯系统内置,无租户列)
// referenceAssets 初始 status='pending'——批次②预生成管线生成分步图后写回
//   (seed 的 update 分支不覆盖 referenceAssets,防抹掉已生成图)
// 固定 ID:便于引用(非标准 UUID 字符串,Prisma @id 为 String 支持)
// relatedWorks:引用 server/data/artworks.json 的作品 id(如 eu-portrait-001)
// ============================================================

/** 参考图资产(GradingProfile.referenceAssets JSON 结构;批次②管线写回) */
// (type 别名而非 interface:获得隐式索引签名,可整体赋值给 Prisma InputJsonObject)
export type ReferenceAssetsData = {
  /** pending=待生成(初始), ready=全部步骤已生成, partial=部分步骤失败 */
  status: 'pending' | 'ready' | 'partial';
  /** 分步图步骤数(2-5) */
  steps: number;
  /** 分步图 URL(与 steps 等长;pending 时为空数组) */
  imageUrls: string[];
  /** 图组说明(生成 prompt 的一部分,描述这组分步图展示什么) */
  caption: string;
  /** 生成完成时间(ISO 8601;pending 时无) */
  generatedAt?: string;
  /** 失败原因(partial 时记录) */
  failureReason?: string;
};

/** Seed 卡片数据结构(供 seed 脚本注入) */
export type SeedKnowledgeCard = {
  /** 固定 ID,如 'kcard_skull_zygomatic_001' */
  id: string;
  /** 适用类目:sketch=素描, color=色彩, quickSketch=速写, design=设计, heritage=非遗 */
  category: 'sketch' | 'color' | 'quickSketch' | 'design' | 'heritage';
  /** 知识点主题,如"头部结构/颧骨" */
  topic: string;
  /** 问题模式关键词(空格分隔;匹配引擎按关键词包含评分) */
  problemPattern: string;
  /** 难度:basic=基础, advanced=进阶 */
  difficulty: 'basic' | 'advanced';
  /** 原理讲解 */
  explanation: string;
  /** 针对性练习 */
  practiceDrill: string;
  /** 分步教学参考图资产(初始 pending) */
  referenceAssets: ReferenceAssetsData;
  /** 关联知识库作品 ID(artworks.json / heritage-works.json;可空) */
  relatedWorks: string[];
  /** 排序权重(数字越小越靠前) */
  sortOrder: number;
};

/** 辅助:构造 pending 状态的参考图资产 */
function pendingAssets(steps: number, caption: string): ReferenceAssetsData {
  return { status: 'pending', steps, imageUrls: [], caption };
}

// ============================================================
// 素描 15 张(头部结构 3 / 明度 4 / 构图 3 / 衬布 2 / 整体感 3)
// ============================================================

const SKETCH_CARDS: SeedKnowledgeCard[] = [
  {
    id: 'kcard_sketch_skull_zygomatic_001',
    category: 'sketch',
    topic: '头部结构/颧骨',
    problemPattern: '颧骨 骨点 结构线 转折 侧面 头像',
    difficulty: 'basic',
    explanation:
      '颧骨是头部正面与侧面的转折枢纽,由颧骨体和颧弓构成。它向外、向前突出,形成面颊最宽处。画头像时要把颧骨理解为连接额头、眼窝、上颌骨的"十字路口":颧骨体是正面看到的骨点,颧弓延伸到耳侧形成转折。颧骨三个朝向面(前面/侧面/下面)的明度必须拉开,否则脸会"平"。',
    practiceDrill:
      '半侧面头像临摹 ×3:每张用铅笔侧锋标出颧骨三个面的明度差(前面最亮、侧面中间、下面最暗),检查三面明度是否至少差两级。',
    referenceAssets: pendingAssets(
      3,
      '颧骨三个朝向面的结构分析与明度区分步骤:头骨侧面视角标出颧骨体与颧弓→半侧面头像上定位三个面→完成明度拉开对比',
    ),
    relatedWorks: ['eu-sketch-002', 'sketch-002'],
    sortOrder: 10,
  },
  {
    id: 'kcard_sketch_skull_eye_socket_002',
    category: 'sketch',
    topic: '头部结构/眼窝与眼球',
    problemPattern: '眼窝 眼球 眼睛 结构 深度 眉弓',
    difficulty: 'basic',
    explanation:
      '眼窝(眶部)是头骨上最深的凹陷,位于眉毛到颧骨之间。眼球嵌在眼窝内,因此上眼皮受眉弓投影、下眼皮受颧骨反光影响——画眼睛不是画"鱼眼",而是画"眼窝里的球"。眉弓是额头的底面转折,眼窝的暗部深度决定了整个头部的体积感。四个关键骨点:眶上缘、眶外缘、眶下缘、鼻梁侧。',
    practiceDrill:
      '石膏眼窝局部写生 ×5:只画眉弓-眼窝-眼球区域,每张 20 分钟,重点检查眼球是否"陷"进眼窝(暗部深度)、眼皮厚度是否交代。',
    referenceAssets: pendingAssets(
      3,
      '眼窝结构与眼球体积关系步骤:头骨眼窝凹陷解析→眼球嵌入眼窝的剖面示意→带明暗的完整眼睛结构渲染',
    ),
    relatedWorks: ['eu-sketch-001', 'eu-sketch-002'],
    sortOrder: 11,
  },
  {
    id: 'kcard_sketch_head_neck_shoulder_003',
    category: 'sketch',
    topic: '头颈肩关系',
    problemPattern: '头颈肩 脖子 斜方肌 胸锁乳突 穿插 关系',
    difficulty: 'basic',
    explanation:
      '头颈肩是初学者最容易画"断"的地方。脖子由胸锁乳突肌和斜方肌支撑,颈椎有自然生理弧度。关键结构:锁骨像"括号"从胸骨延伸到肩峰,斜方肌从枕骨向下铺到肩胛骨。画侧面时注意脖子不是垂直插入头,而是从下颌角向后上方倾斜连接。头颈肩穿插关系错了,头会像"搁"在肩上而不是"长"在肩上。',
    practiceDrill:
      '头颈肩局部速写 ×8:只画下颌到锁骨区域,男女各半,每张 10 分钟,检查斜方肌的斜度和锁骨的"括号"弧度。',
    referenceAssets: pendingAssets(
      3,
      '头颈肩穿插关系步骤:颈肩肌肉解剖示意→头颈肩侧面倾斜角度分析→完整半身像局部结构与明暗',
    ),
    relatedWorks: ['sketch-003'],
    sortOrder: 12,
  },
  {
    id: 'kcard_sketch_value_gray_004',
    category: 'sketch',
    topic: '明度/画面灰',
    problemPattern: '灰 明度 层次 拉开 黑白灰 对比 发灰',
    difficulty: 'basic',
    explanation:
      '画面灰的本质是明度范围压缩——最重处不够黑(应接近极限)、最亮处不够白(纸白是 255),所有调子挤在中间灰区。改法不是"整体加深",而是"两端拉开":先找到画面最重的一点压到极限,再守住最亮的留白区域不碰,中间灰自然拉开层次。检查方法:眯眼看画面,应有明确的黑、白、灰三大区域而不是一片均匀的灰。',
    practiceDrill:
      '明度两端练习 ×3:取任意旧作,只用软铅(6B 以上)把最重区压黑、用可塑橡皮把最亮区提白,每张 15 分钟,完成后退远 2 米眯眼检查三大区域是否分明。',
    referenceAssets: pendingAssets(
      3,
      '画面灰问题修正步骤:明度标尺示意中间灰堆积→两端拉开的黑白灰区域划分→修正前后的静物素描对比',
    ),
    relatedWorks: ['eu-portrait-001'],
    sortOrder: 13,
  },
  {
    id: 'kcard_sketch_value_contrast_005',
    category: 'sketch',
    topic: '明度/对比不足',
    problemPattern: '对比 对比度 不足 明度差 主体 平',
    difficulty: 'basic',
    explanation:
      '对比不足指画面各区域明度过于接近,主体与背景、亮面与暗面的明度差不够,画面发"平"。关键概念:对比是相对的——同一块灰色在亮区旁边显暗、在暗区旁边显亮。改法:主动确定"最亮对"(画面上明度差最大的两个相邻区域)放在视觉中心,边缘区域对比减弱,形成主次节奏。',
    practiceDrill:
      '明度差标注练习:找 3 张大师素描(如伦勃朗、门采尔),用数字 1-5 标出每个区域的明度等级,统计主视觉中心区的明度差是否 ≥3 级、边缘区是否 ≤2 级。',
    referenceAssets: pendingAssets(
      3,
      '明度对比建立步骤:五级明度标尺→同一静物的弱对比与强对比版本并置→视觉中心强对比+边缘弱对比的完整示范',
    ),
    relatedWorks: ['eu-portrait-001', 'eu-baroque-001'],
    sortOrder: 14,
  },
  {
    id: 'kcard_sketch_value_highlight_006',
    category: 'sketch',
    topic: '明度/高光缺失',
    problemPattern: '高光 最亮 留白 亮点 提亮',
    difficulty: 'basic',
    explanation:
      '高光是画面中最亮的点,通常出现在最突出、最接近光源的表面(鼻头、颧骨、罐口沿、布褶高点)。素描里高光=留白,即从开始铺调子就要保护这块区域。高光缺失的画会显得"乌"——明明暗部画得很重,物体却没有"鼓"出来。注意高光不是纯白一片:它有形状(随结构面变化)、有虚实(边缘不能抠死)。',
    practiceDrill:
      '高光保护练习 ×3:画静物单体(苹果/罐子),起形后先圈出所有高光位置,全程检查高光区域是否被污染、高光形状是否随结构变化。',
    referenceAssets: pendingAssets(
      3,
      '高光处理步骤:光源方向与高光位置分析→高光形状随结构面的变化示意→带高光的完整静物渲染',
    ),
    relatedWorks: ['eu-baroque-002'],
    sortOrder: 15,
  },
  {
    id: 'kcard_sketch_value_dark_007',
    category: 'sketch',
    topic: '明度/暗部闷',
    problemPattern: '暗部 发闷 死黑 反光 透气 层次',
    difficulty: 'basic',
    explanation:
      '暗部闷=暗部一片死黑,没有层次和"透气感"。原理:暗部不是没有光,而是被反光照亮——靠近桌面的暗部底面最亮(反光强),远离反光源的区域更暗。改法:暗部整体用软铅轻铺保持"透气"(能看到纸的纹理),反光区域用硬铅轻提;投影比物体暗部更黑,明暗交界线是暗部最重的带。',
    practiceDrill:
      '暗部解剖练习 ×3:画球体+衬布,把暗部分为明暗交界线、暗面、反光、投影四层,每层明度差至少半级,检查投影是否比暗部重、反光是否比暗面亮。',
    referenceAssets: pendingAssets(
      4,
      '暗部四层结构步骤:球体暗部明暗交界线定位→暗面与反光区分→投影形状与重度→四层完整对比渲染',
    ),
    relatedWorks: ['eu-portrait-001'],
    sortOrder: 16,
  },
  {
    id: 'kcard_sketch_composition_balance_008',
    category: 'sketch',
    topic: '构图/重心偏移',
    problemPattern: '重心 偏移 构图 失衡 偏 倾斜',
    difficulty: 'basic',
    explanation:
      '画面重心指视觉重量平衡点。构图失衡的常见原因:主体全部偏一侧、大面积空白无呼应、静物高低差太均匀。改法:①主体放在画面视觉中心(三分线交点附近)而非几何正中;②用次要物体"配重"——左边主体重,右边放小物或伸出布角呼应;③检查四边留白:上下左右留白宽度差控制在 1:1.5 内(有意构图除外)。',
    practiceDrill:
      '构图配重练习 ×6:同一组静物画 3 种构图(三角形/S 形/圆形),每种 10 分钟小稿,用红点标出视觉重心位置,检查是否落在画面中部 1/3 区域。',
    referenceAssets: pendingAssets(
      3,
      '构图重心平衡步骤:失衡构图问题标注→配重物添加示意→修正后的平衡构图对比',
    ),
    relatedWorks: ['eu-renaissance-002', 'eu-renaissance-004'],
    sortOrder: 17,
  },
  {
    id: 'kcard_sketch_composition_margin_009',
    category: 'sketch',
    topic: '构图/边留白',
    problemPattern: '留白 边缘 构图 太满 太空 空间',
    difficulty: 'basic',
    explanation:
      '边留白问题分两种:太满(主体顶着纸边,画面喘不过气)和太空(主体缩在中间,四周大面积闲置)。标准:主体外沿与纸边的最小间距保持在画面短边的 1/8-1/6;有"出口"的画面(如静物组一侧留空延伸)比"封闭"的构图更有呼吸感。特殊地,冲击性构图可以故意破边(物体切出画面),但必须有意为之且切在非重点一侧。',
    practiceDrill:
      '留白变奏练习 ×4:同一物体分别画顶边/窄边/标准边/破边四种留白,每张 10 分钟,对比哪种最透气、哪种最堵。',
    referenceAssets: pendingAssets(
      3,
      '画面留白控制步骤:太满与太空问题示意→标准留白边距标注→破边构图的主动运用',
    ),
    relatedWorks: ['jp-ukiyoe-001'],
    sortOrder: 18,
  },
  {
    id: 'kcard_sketch_composition_scale_010',
    category: 'sketch',
    topic: '构图/主体过小',
    problemPattern: '主体 过小 尺度 比例 构图 偏小',
    difficulty: 'basic',
    explanation:
      '主体过小=视觉主体占画面面积不足(通常 <1/3),导致画面空、物象关系松散。改法:起形时先用长直线框出主体的大致占位(目标 ≥ 画面 1/2 高度),从整体框架往里收,而不是从局部细节往外长。检验:退远 2 米,主体应该第一眼抓住视线;如果被背景抢了,就是小了或对比弱了。',
    practiceDrill:
      '满构图练习 ×5:任何写生对象都强制画到画面高度 2/3 以上,连续 5 张,再画一张正常比例,对比构图强度差异。',
    referenceAssets: pendingAssets(
      3,
      '主体尺度控制步骤:过小构图问题分析→长直线框架定位法→放大主体后的构图对比',
    ),
    relatedWorks: [],
    sortOrder: 19,
  },
  {
    id: 'kcard_sketch_cloth_folds_011',
    category: 'sketch',
    topic: '衬布/布褶组织',
    problemPattern: '衬布 布褶 褶皱 布纹 组织 走向',
    difficulty: 'basic',
    explanation:
      '布褶不是随机的线条,而是受力结构的可视化:布褶走向由支撑点(物体压住的地方)和悬垂方向决定。组织原则:①褶从受力点出发呈放射状;②褶有主次——主褶(大转折)粗而深,次褶细而浅;③褶的走向暗示空间——横向褶显前后、纵向褶显左右。画衬布最忌"平均对待每条褶"和"闭眼乱排线"。',
    practiceDrill:
      '布褶写生 ×3:搭一块有明确支撑点的衬布,先标出所有受力点,再只画主褶(5-8 条),最后轻扫次褶,每张 30 分钟。',
    referenceAssets: pendingAssets(
      3,
      '布褶组织步骤:受力点与放射走向分析→主褶次褶区分示意→完整衬布明暗渲染',
    ),
    relatedWorks: ['eu-portrait-002'],
    sortOrder: 20,
  },
  {
    id: 'kcard_sketch_cloth_planes_012',
    category: 'sketch',
    topic: '衬布/体块转折',
    problemPattern: '衬布 体块 转折 平面 灰面 前后',
    difficulty: 'basic',
    explanation:
      '衬布虽然柔软,也要按"体块"理解:布覆盖在桌面/物体上,形成前后的平面(顶面、立面、垂面)转折。灰面处理:顶面(受光)最亮、立面(中间灰)次之、垂面(背光)最重,三个面的明度差不小于一级。前后空间靠虚实:近处布褶对比强、刻画实;远处布褶对比弱、处理虚。衬布是把静物"串"进空间的关键,不是背景装饰。',
    practiceDrill:
      '衬布三面练习 ×2:画带衬布的静物,先把布分成顶/立/垂三个大面统一铺色,区分三面明度后再加褶皱细节,每张 45 分钟。',
    referenceAssets: pendingAssets(
      3,
      '衬布体块转折步骤:顶立垂三面划分→三面明度差建立→带空间虚实的完整衬布',
    ),
    relatedWorks: [],
    sortOrder: 21,
  },
  {
    id: 'kcard_sketch_unity_detail_013',
    category: 'sketch',
    topic: '整体感/局部过度刻画',
    problemPattern: '局部 过度 刻画 跳 整体 协调',
    difficulty: 'basic',
    explanation:
      '局部过度刻画指某个区域(常是主体亮面、某个兴趣点)细节密度远超其他区域,导致画面"碎"、视觉跳跃。原理:画面细节量应有节奏——视觉中心最密,向外递减;暗部和远景整体概括。改法:完成每个局部后退远检查,问"这个区域的刻画强度排画面第几";如果不是第一且不该第一,就用纸笔/橡皮统一减弱。',
    practiceDrill:
      '刻画节奏练习:临摹一张完成度高的素描,用红笔圈出细节最密的 3 个区域,分析它们的连线是否落在视觉中心、密度是否递减,写 100 字总结。',
    referenceAssets: pendingAssets(
      3,
      '刻画节奏控制步骤:局部过跳问题示意→细节密度梯度分布图→主次节奏明确的大关系示范',
    ),
    relatedWorks: ['eu-baroque-001'],
    sortOrder: 22,
  },
  {
    id: 'kcard_sketch_unity_edges_014',
    category: 'sketch',
    topic: '整体感/边缘线处理',
    problemPattern: '边缘线 虚实 边缘 硬 死 软',
    difficulty: 'advanced',
    explanation:
      '边缘线(轮廓)不是一根线,而是两个面的转折。虚实用笔原则:受光侧的边缘实、背光侧虚;视觉中心边缘实、边缘区域虚;前方物体边缘实、后方虚。高级处理:边缘"断"比"连"更显生动——在转折最急处断开让观者脑补。死抠一圈黑边的物体像"剪纸贴画",与背景割裂。',
    practiceDrill:
      '边缘变奏练习 ×3:画两个前后静物,前物边缘四处变化(实/虚/断/破各一处),后物边缘整体减弱,检查空间感是否增强。',
    referenceAssets: pendingAssets(
      3,
      '边缘线虚实处理步骤:物体轮廓的四态(实虚断破)示意→前后物体边缘强弱对比→边缘融入背景的完整示范',
    ),
    relatedWorks: ['eu-baroque-002'],
    sortOrder: 23,
  },
  {
    id: 'kcard_sketch_unity_space_015',
    category: 'sketch',
    topic: '整体感/空间层次',
    problemPattern: '空间 前后 层次 虚实 空气感 纵深',
    difficulty: 'advanced',
    explanation:
      '空间感的营造靠三组关系:①虚实——近实远虚(视觉聚焦原理);②明度——近处对比强、远处对比弱(空气透视);③重叠——前后物体遮挡关系明确。检查方法:眯眼看画面,能否分出至少 3 层深度平面(前景/中景/背景)。常见病:远处物体和近处画得一样清楚(无空气感)、物体互不遮挡(漂浮感)。',
    practiceDrill:
      '三层空间练习 ×3:摆前后两组静物(间隔 1 米以上),前景完整刻画、中景保持中间调、背景只画大关系(5 分钟内完成),每张 40 分钟。',
    referenceAssets: pendingAssets(
      3,
      '空间层次营造步骤:三层深度平面划分→空气透视的明度衰减示意→前中后虚实递减的完整示范',
    ),
    relatedWorks: ['cn-mountain-002'],
    sortOrder: 24,
  },
];

// ============================================================
// 色彩 8 张(冷暖 2 / 纯灰 3 / 笔触 2 / 色调统一 1)
// ============================================================

const COLOR_CARDS: SeedKnowledgeCard[] = [
  {
    id: 'kcard_color_warm_cool_016',
    category: 'color',
    topic: '色彩/冷暖关系',
    problemPattern: '冷暖 冷暖关系 色性 倾向 发冷 发暖',
    difficulty: 'basic',
    explanation:
      '色彩冷暖是相对概念:红橙黄偏暖、蓝绿紫偏冷,但暖色里的玫瑰红比朱红冷、冷色里的群青比湖蓝暖。画面冷暖失衡的两种病:全冷——画面像蒙了层灰纱,无生气;全暖——火气重,浮躁。改法:确定光源色温(冷光如阴天、暖光如白炽灯)后,暗部统一向光源补色相倾斜(暖光暗部偏冷、冷光暗部偏暖),形成冷暖对抗中的平衡。',
    practiceDrill:
      '冷暖对抗小色稿 ×6:同一组静物分别画冷光暖暗、暖光冷暗、冷光冷暗、暖光暖暗四组(每组 2 张 15 分钟小稿),对比哪组最有色彩张力。',
    referenceAssets: pendingAssets(
      3,
      '冷暖关系步骤:色相环冷暖分区→光源色温与暗部补色倾向示意→冷光暖暗完整静物色彩示范',
    ),
    relatedWorks: ['eu-impressionist-001', 'eu-impressionist-002'],
    sortOrder: 25,
  },
  {
    id: 'kcard_color_warm_cool_light_017',
    category: 'color',
    topic: '色彩/光源色与环境色',
    problemPattern: '光源色 环境色 条件色 固有色 影响',
    difficulty: 'advanced',
    explanation:
      '条件色理论:物体亮面=固有色+光源色,暗部=固有色+环境色(补色倾向),高光≈光源色。初学者只画固有色(什么物体涂什么颜色),画面像"填色画"。改法:观察暗部时眯眼找"偏什么"——白瓷瓶暗部在红布上偏红、在绿植旁偏绿灰。环境色的饱和度必须低于固有色(灰一档),否则脏。',
    practiceDrill:
      '环境色捕捉练习 ×5:摆一个白瓶配三块不同色衬布,分别画暗部在三种环境下的色偏(每张 20 分钟小色稿),检查暗部是否"吃"进环境又保持白瓶感。',
    referenceAssets: pendingAssets(
      3,
      '条件色观察步骤:光源色/固有色/环境色三要素分解→白瓶暗部在不同衬布上的色偏对比→条件色完整的静物示范',
    ),
    relatedWorks: ['eu-impressionist-001'],
    sortOrder: 26,
  },
  {
    id: 'kcard_color_purity_gray_018',
    category: 'color',
    topic: '色彩/纯灰失衡',
    problemPattern: '纯灰 纯度 鲜艳 灰浊 脏色 单一',
    difficulty: 'basic',
    explanation:
      '纯灰关系指画面鲜艳(高纯度)与浑浊(低纯度)色的配比。原则:纯色是"音符",灰色是"底色"——纯色面积小而精(视觉中心),灰色面积大而稳(背景/次要)。全纯=噪闹刺眼,全灰=沉闷浑浊。灰调的高级感来自纯度微差(灰与灰之间有倾向变化),不是一潭死灰。',
    practiceDrill:
      '纯灰占比练习 ×4:同一组静物,纯色面积分别控制在 10%/20%/40%/70% 四张小稿(各 20 分钟),对比哪张最耐看,总结自己画面的纯灰"舒适区"。',
    referenceAssets: pendingAssets(
      3,
      '纯灰配比步骤:纯度色阶标尺→纯色位置与面积的布局示意→主纯次灰的完整色彩示范',
    ),
    relatedWorks: ['modern-abstract-002'],
    sortOrder: 27,
  },
  {
    id: 'kcard_color_purity_dirty_019',
    category: 'color',
    topic: '色彩/脏色问题',
    problemPattern: '脏 颜色 脏色 闷 搅拌 调和',
    difficulty: 'basic',
    explanation:
      '脏色=颜色失去倾向(说不出偏什么色相),成因:①三原色等量反复搅拌(互补色互杀);②过多颜色叠加超过 3 层;③笔没洗净带进杂色。改法:调色遵循"邻近色调和"(主色+微量邻色+倾向色),笔上水分控制(水粉脏多为水脏或粉过多),"宁薄勿厚"地分层罩染而不是一次调和到位。',
    practiceDrill:
      '调色纯净练习:做 3 组三联调色条——红黄蓝各自向两个邻色渐变(各 10 格),全程禁止互补色相混,检查每格是否都说得出明确色相倾向。',
    referenceAssets: pendingAssets(
      3,
      '调色防脏步骤:脏色成因的混色示意→邻近色调和的色条渐变→干净色层的完整静物示范',
    ),
    relatedWorks: [],
    sortOrder: 28,
  },
  {
    id: 'kcard_color_purity_rhythm_020',
    category: 'color',
    topic: '色彩/纯度节奏',
    problemPattern: '纯度 节奏 变化 平均 主次',
    difficulty: 'advanced',
    explanation:
      '纯度节奏指画面纯度变化有主次、有梯度,像音乐有强拍弱拍。常见病:纯度均质(所有物体鲜度一样,画面"平")和纯度跳脱(一处突然最艳,与周围断裂)。改法:建立纯度三级制——主视觉(最高纯)> 次要物(中间纯)> 背景衬布(低纯),相邻两级差控制在"能感觉但不刺眼"的程度。',
    practiceDrill:
      '纯度三级练习 ×3:画一组三物静物,先规划三级纯度(主/次/背),完成后用手机转灰度对比彩色版,检查主视觉是否仍是第一眼焦点。',
    referenceAssets: pendingAssets(
      3,
      '纯度节奏步骤:三级纯度阶梯示意→主次背纯度布局规划→灰度校验法对比示范',
    ),
    relatedWorks: ['eu-impressionist-004'],
    sortOrder: 29,
  },
  {
    id: 'kcard_color_brush_modeling_021',
    category: 'color',
    topic: '笔触/笔触塑造',
    problemPattern: '笔触 摆笔 塑造 干湿 堆砌',
    difficulty: 'basic',
    explanation:
      '笔触是色彩画的"骨骼":摆笔贴形(笔随结构走)则物体结实,乱涂则松散。基础笔法:①摆——用笔腹肯定压出色块(主体块面);②扫——笔侧锋轻扫(衔接过渡);③点——笔尖点戳(高光/细节);④揉——干笔轻揉(灰面柔和)。水粉注意"饱笔不塌、渴笔不浮":亮部厚堆有张力、暗部薄涂透气。',
    practiceDrill:
      '笔法分解练习 ×4:同一苹果分别只用摆/扫/点/揉四种笔法各画一张(每张 15 分钟),再综合画一张,体会每种笔法的结构功能。',
    referenceAssets: pendingAssets(
      4,
      '笔触塑造步骤:摆笔贴形块面示意→扫笔衔接过渡→点戳高光细节→四法综合的完整静物示范',
    ),
    relatedWorks: ['eu-impressionist-004'],
    sortOrder: 30,
  },
  {
    id: 'kcard_color_brush_direction_022',
    category: 'color',
    topic: '笔触/运笔方向',
    problemPattern: '运笔 方向 笔触 顺结构 贴形',
    difficulty: 'advanced',
    explanation:
      '运笔方向应服从形体结构:圆柱体(罐身)横向用笔(随圆转)、球体(苹果)弧线用笔(随弧包)、平面(桌面)顺透视方向用笔(近宽远窄)。"顺结构"的笔触帮形体"鼓"起来,"逆结构"(如球体上拉直线)则切开体积。统一中还求变化:同方向笔触的长短、轻重、疏密错开,避免"铁轨"式平行线。',
    practiceDrill:
      '贴形笔触练习 ×3:罐+果+布的组合,每物只用最贴其结构的笔向(罐横弧/果包弧/布放射),禁止随意涂抹,每张 40 分钟。',
    referenceAssets: pendingAssets(
      3,
      '运笔方向步骤:罐身横弧笔向示意→球体包弧笔向→组合静物的贴形笔触完整示范',
    ),
    relatedWorks: ['eu-impressionist-003'],
    sortOrder: 31,
  },
  {
    id: 'kcard_color_tonal_harmony_023',
    category: 'color',
    topic: '色调/统一性',
    problemPattern: '色调 统一 调性 花乱 主色调 倾向',
    difficulty: 'basic',
    explanation:
      '色调=画面色彩的总倾向(如暖灰调、冷蓝调、黄橙调)。统一方法:①笼罩法——最后整体罩一层主倾向透明色;②渗透法——调色盘上每种色都微量掺入主色调(如暖调里所有色带一点黄);③呼应法——主色在画面 3 处以上以不同纯度重现。"花"的原因即无主色调统摄:每块色都各自为政。检验:退远眯眼,能否用一两个色相词概括整张画。',
    practiceDrill:
      '主色渗透练习 ×4:同一组静物分别以黄橙/蓝绿/红灰/紫灰为主调画四张小稿(各 25 分钟),每张的所有颜色必须可辨主调渗透,对比同一组物在不同调性下的情绪差异。',
    referenceAssets: pendingAssets(
      3,
      '色调统一步骤:主调色的选择与渗透示意→呼应法的多点重现布局→统一色调的完整静物示范',
    ),
    relatedWorks: ['cn-mountain-001', 'eu-impressionist-002'],
    sortOrder: 32,
  },
];

// ============================================================
// 速写 5 张(比例/动态线/重心/衣纹/头手脚)
// ============================================================

const QUICK_SKETCH_CARDS: SeedKnowledgeCard[] = [
  {
    id: 'kcard_quick_proportion_024',
    category: 'quickSketch',
    topic: '速写/人物比例',
    problemPattern: '比例 头身 比例失调 偏长 偏短 人物',
    difficulty: 'basic',
    explanation:
      '速写标准比例:站姿约 7-7.5 头身(艺用简化),坐 5-5.5,蹲 3.5-4;肩宽约 2 头长(男)/1.5(女);上臂 1.5 头、前臂 1 头、手 0.8 头。快速校验三招:①垂线法——肘垂对腰际、腕垂对胯;②头比对——以头长为单位量坐高/腿长;③负形法——看轮廓外空间的形状比看肢体更易发现比例错。宁可微短勿过长:腿画长必翻车。',
    practiceDrill:
      '头长标尺练习 ×8:8 张动态速写(站坐蹲各若干),每张先用头长为单位在纸边轻标刻度(如 7 头身标 7 格),画完对照实际误差 >0.5 头长的重画。',
    referenceAssets: pendingAssets(
      3,
      '人物比例步骤:站坐蹲三姿头身标尺→头长为单位量各段肢体→带比例网格的完整人物速写',
    ),
    relatedWorks: ['sketch-003', 'eu-sketch-001'],
    sortOrder: 33,
  },
  {
    id: 'kcard_quick_dynamic_line_025',
    category: 'quickSketch',
    topic: '速写/动态线',
    problemPattern: '动态 动态线 姿态 重心线 运动感',
    difficulty: 'basic',
    explanation:
      '动态线是贯穿人体运动趋势的假想线,一条线抓住"正在做什么"。找法:从锁骨窝(头颈胸方向)→ 腰 → 承重腿膝盖连成主线,辅线捕捉四肢摆动。画速写第一步永远是 10 秒定动态线,而非从头顶描轮廓——没有动态线的速写是"站军装照",有它才有"劲"。动态线宁过勿不及:夸张 10% 比准确更生动。',
    practiceDrill:
      '动态线捕捉 ×20:看 20 段运动视频(跳舞/打球/搬物),每段只画 1 条主线+2 条辅线(每张 15 秒),连续做完后挑 5 条最准的扩成完整速写。',
    referenceAssets: pendingAssets(
      3,
      '动态线步骤:运动人体的主线辅线标注→主线夸张与重心关系→由动态线扩展的完整人物速写',
    ),
    relatedWorks: ['cn-modern-001'],
    sortOrder: 34,
  },
  {
    id: 'kcard_quick_balance_026',
    category: 'quickSketch',
    topic: '速写/重心不稳',
    problemPattern: '重心 站立 稳 失衡 支撑 支点',
    difficulty: 'basic',
    explanation:
      '重心=人体重力作用点(约在骶骨前),支撑面=双脚及之间区域。稳=重心铅垂线落在支撑面内。画站姿校验:从锁骨窝向地面垂一条线(心里画),应落在承重脚脚弓上——叉腰则落在两脚间。失衡速写的特征:人像"漂"着或要摔倒。修正口诀:"重心压承重腿,另一腿可自由摆";肩线与髋线反向倾斜(一高一低)形成生动站姿而非立正。',
    practiceDrill:
      '重心校验练习 ×10:10 张站姿速写,每张画完用尺子从锁骨窝垂真线到纸底,检查落点是否在承重脚内,全部修正后再加肩髋线倾斜。',
    referenceAssets: pendingAssets(
      3,
      '重心稳定步骤:锁骨窝垂线与支撑面关系示意→承重腿与自由腿的分工→肩髋反向倾斜的生动站姿示范',
    ),
    relatedWorks: [],
    sortOrder: 35,
  },
  {
    id: 'kcard_quick_clothing_folds_027',
    category: 'quickSketch',
    topic: '速写/衣纹组织',
    problemPattern: '衣纹 褶皱 疏密 线条 组织 繁简',
    difficulty: 'basic',
    explanation:
      '衣纹三大类:①牵引纹(肢体弯曲拉伸处,如肘膝腋下)——深而集中;②折叠纹(堆叠处如腰部、裤脚)——碎而密;③垂坠纹(悬垂如裙摆)——长而顺。疏密原则:关节处密、肢体中段疏,"密不透风,疏可走马"。画法:先抓牵引纹(体现形),折叠纹挑三五个(体现质),垂坠纹一笔带势(体现动)。忌讳:全身平均排线变成"木乃伊"。',
    practiceDrill:
      '衣纹分类练习 ×6:6 张局部(肘/膝/腋/腰/裤脚/裙摆各一),每张只画该部位衣纹并标注类型,检查三类纹的用线轻重差异是否拉开。',
    referenceAssets: pendingAssets(
      3,
      '衣纹组织步骤:三类衣纹(牵引/折叠/垂坠)分布示意→关节处疏密节奏分析→完整人物速写的衣纹主次示范',
    ),
    relatedWorks: ['watercolor-004'],
    sortOrder: 36,
  },
  {
    id: 'kcard_quick_head_hands_feet_028',
    category: 'quickSketch',
    topic: '速写/头手脚刻画',
    problemPattern: '头 手 脚 刻画 简单 草率 表情',
    difficulty: 'basic',
    explanation:
      '头手脚是速写"打分点":头部占 20% 分值,手 15%,脚 10%。头部画法:抓发型外轮廓+五官中轴线(不是完整肖像),眼睛一条线+眉、嘴简括;手:先定手掌梯形+拇指三角,再分四指(成组处理忌一根根描);脚:鞋型概括为楔形,注意脚踝内外高低差(内高外低)。头手脚草率=画面"没画完";但刻画过度超时也亏——控制在总时长 25% 内。',
    practiceDrill:
      '三局部专项 ×9:头/手/脚各 3 张(每张 10 分钟),头只练发型+中轴线、手只练掌形+分组指、脚只练鞋楔形,连续三天各一轮。',
    referenceAssets: pendingAssets(
      4,
      '头手脚刻画步骤:头部发型轮廓与中轴线画法→手的掌形分组法→脚的楔形鞋型→头手脚完整刻画的人物速写',
    ),
    relatedWorks: ['sketch-001', 'eu-sketch-002'],
    sortOrder: 37,
  },
];

// ============================================================
// 汇总导出
// ============================================================

export const SEED_KNOWLEDGE_CARDS: SeedKnowledgeCard[] = [
  ...SKETCH_CARDS,
  ...COLOR_CARDS,
  ...QUICK_SKETCH_CARDS,
];

// ============================================================
// 校验(seed 注入前预校验)
// ============================================================

export type KnowledgeCardValidationResult = {
  valid: boolean;
  errors: string[];
};

const VALID_CATEGORIES = ['sketch', 'color', 'quickSketch', 'design', 'heritage'] as const;
const VALID_DIFFICULTIES = ['basic', 'advanced'] as const;

export function validateSeedKnowledgeCards(): KnowledgeCardValidationResult {
  const errors: string[] = [];

  if (SEED_KNOWLEDGE_CARDS.length === 0) {
    errors.push('SEED_KNOWLEDGE_CARDS 为空');
  }

  const seenIds = new Set<string>();
  for (const card of SEED_KNOWLEDGE_CARDS) {
    if (seenIds.has(card.id)) {
      errors.push(`卡片 ID 重复: ${card.id}`);
    }
    seenIds.add(card.id);

    if (!card.id.startsWith('kcard_')) {
      errors.push(`卡片 ID 前缀不规范(应为 kcard_): ${card.id}`);
    }
    if (!VALID_CATEGORIES.includes(card.category)) {
      errors.push(`卡片 ${card.id} category 非法: ${card.category}`);
    }
    if (!VALID_DIFFICULTIES.includes(card.difficulty)) {
      errors.push(`卡片 ${card.id} difficulty 非法: ${card.difficulty}`);
    }

    // topic/problemPattern:非空 + 长度上限(与 schema VarChar 一致)
    if (!card.topic || card.topic.length > 64) {
      errors.push(`卡片 ${card.id} topic 为空或超 64 字: ${card.topic}`);
    }
    if (!card.problemPattern || card.problemPattern.length > 255) {
      errors.push(`卡片 ${card.id} problemPattern 为空或超 255 字`);
    } else {
      const keywords = card.problemPattern.trim().split(/\s+/);
      if (keywords.length < 2) {
        errors.push(`卡片 ${card.id} problemPattern 关键词不足 2 个: ${card.problemPattern}`);
      }
    }

    // 讲解内容:有实质长度(教学价值底线)
    if (!card.explanation || card.explanation.length < 30) {
      errors.push(`卡片 ${card.id} explanation 过短(<30 字),无教学价值`);
    }
    if (!card.practiceDrill || card.practiceDrill.length < 10) {
      errors.push(`卡片 ${card.id} practiceDrill 过短(<10 字)`);
    }

    // referenceAssets:pending/ready/partial 语义一致
    const { referenceAssets } = card;
    if (!['pending', 'ready', 'partial'].includes(referenceAssets.status)) {
      errors.push(`卡片 ${card.id} referenceAssets.status 非法: ${referenceAssets.status}`);
    }
    if (!Number.isInteger(referenceAssets.steps) || referenceAssets.steps < 2 || referenceAssets.steps > 5) {
      errors.push(`卡片 ${card.id} steps 非法(应 2-5): ${referenceAssets.steps}`);
    }
    if (referenceAssets.status === 'ready' && referenceAssets.imageUrls.length !== referenceAssets.steps) {
      errors.push(`卡片 ${card.id} status=ready 但 imageUrls 数(${referenceAssets.imageUrls.length})与 steps(${referenceAssets.steps})不符`);
    }
    if (referenceAssets.status === 'pending' && referenceAssets.imageUrls.length !== 0) {
      errors.push(`卡片 ${card.id} status=pending 但 imageUrls 非空`);
    }
    if (!referenceAssets.caption || referenceAssets.caption.length > 200) {
      errors.push(`卡片 ${card.id} caption 为空或超 200 字`);
    }

    // relatedWorks:字符串数组
    if (!Array.isArray(card.relatedWorks) || card.relatedWorks.some((w) => typeof w !== 'string')) {
      errors.push(`卡片 ${card.id} relatedWorks 应为 string[]`);
    }

    if (!Number.isInteger(card.sortOrder)) {
      errors.push(`卡片 ${card.id} sortOrder 非整数: ${card.sortOrder}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
