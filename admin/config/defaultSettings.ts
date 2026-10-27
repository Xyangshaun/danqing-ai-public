import type { ProLayoutProps } from '@ant-design/pro-components';
import type { ThemeConfig } from 'antd';

/**
 * 水墨美学色彩系统(与官网一致)
 * - 墨黑   #1a1a1a  主文字
 * - 宣纸白 #faf8f3  背景
 * - 朱砂红 #c8392e  强调 / 危险
 * - 石青   #2e5c6e  主色调 / 导航
 * - 金色   #c9a961  高端感 / 重点
 * - 灰墨   #6b6b6b  次要文字
 */
export const INK_COLORS = {
  ink: '#1a1a1a',
  paper: '#faf8f3',
  cinnabar: '#c8392e',
  stone: '#2e5c6e',
  gold: '#c9a961',
  inkSub: '#6b6b6b',
} as const;

/**
 * antd 5 Token(浅色主题)
 * 主色 = 石青(导航/链接/主按钮)
 * 危险色 = 朱砂红
 * 成功/警告/处理保持 antd 默认语义色,微调以融入水墨调
 */
export const antdToken: ThemeConfig['token'] = {
  colorPrimary: INK_COLORS.stone,
  colorLink: INK_COLORS.stone,
  colorLinkHover: '#3a6f82',
  colorError: INK_COLORS.cinnabar,
  colorWarning: '#c9a961',
  colorSuccess: '#3e7d5a',
  colorInfo: INK_COLORS.stone,
  colorTextBase: INK_COLORS.ink,
  colorBgBase: INK_COLORS.paper,
  colorBgLayout: '#f3efe6',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorText: INK_COLORS.ink,
  colorTextSecondary: INK_COLORS.inkSub,
  colorBorder: '#e3dccd',
  colorBorderSecondary: '#ece6d8',
  colorSplit: '#e3dccd',
  colorFill: '#f0eadb',
  colorFillSecondary: '#f5f0e3',
  fontFamily:
    '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: 13,
  borderRadius: 6,
  borderRadiusLG: 8,
  borderRadiusSM: 4,
  controlHeight: 30,
  controlHeightLG: 36,
  controlHeightSM: 24,
  wireframe: false,
};

/**
 * antd 5 Token(暗色主题)
 * 暗色 = 墨黑基底,金色点缀
 */
export const antdDarkToken: ThemeConfig['token'] = {
  ...antdToken,
  colorBgBase: '#141414',
  colorBgLayout: '#0f0f0f',
  colorBgContainer: '#1f1f1f',
  colorBgElevated: '#262626',
  colorText: '#f0ede4',
  colorTextSecondary: '#a8a39a',
  colorBorder: '#3a3a3a',
  colorBorderSecondary: '#2e2e2e',
  colorSplit: '#3a3a3a',
  colorFill: '#2e2e2e',
  colorFillSecondary: '#262626',
  colorPrimary: '#5b8fa3',
  colorLink: '#5b8fa3',
  colorWarning: '#d8b878',
};

/**
 * ProLayout 配置(参考 TRAE 产品 UI 风格:简洁专业、紧凑高密度)
 */
export const proLayout: ProLayoutProps = {
  title: '丹青有AI',
  logo: false,
  layout: 'mix',
  splitMenus: false,
  navTheme: 'light',
  fixedHeader: true,
  fixSiderbar: true,
  contentWidth: 'Fluid',
  siderWidth: 220,
  colorPrimary: INK_COLORS.stone,
  token: {
    header: {
      colorBgHeader: '#ffffff',
      colorHeaderTitle: INK_COLORS.ink,
      colorTextMenu: INK_COLORS.inkSub,
      colorTextMenuSecondary: INK_COLORS.inkSub,
      heightLayoutHeader: 52,
      colorBgMenuItemSelected: 'rgba(46, 92, 110, 0.08)',
      colorTextMenuSelected: INK_COLORS.stone,
    },
    sider: {
      colorMenuBackground: '#ffffff',
      colorTextMenu: INK_COLORS.inkSub,
      colorTextMenuSecondary: INK_COLORS.inkSub,
      colorTextMenuSelected: INK_COLORS.stone,
      colorBgMenuItemSelected: 'rgba(46, 92, 110, 0.10)',
      colorBgMenuItemHover: 'rgba(46, 92, 110, 0.06)',
    },
    bgLayout: '#f3efe6',
  },
};

export default { antdToken, antdDarkToken, proLayout };
