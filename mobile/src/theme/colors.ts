// 丹青有AI 水墨色系设计令牌
// 对应移动端设计规范:墨黑 / 宣纸白 / 朱砂红 / 石青 / 金色
// 严格遵循,禁止在业务代码中硬编码其他色值
export const InkColor = '#1a1a1a'; // 墨黑(标题 / 正文)
export const PaperColor = '#f5f2eb'; // 宣纸白(背景)
export const CinnabarColor = '#c41e3a'; // 朱砂红(强调 / 危险)
export const StoneBlueColor = '#2e5fa1'; // 石青(主操作 / 链接)
export const GoldColor = '#d4af37'; // 金色(高亮 / 评分)

export const palette = {
  ink: InkColor,
  paper: PaperColor,
  cinnabar: CinnabarColor,
  stoneBlue: StoneBlueColor,
  gold: GoldColor,
} as const;
