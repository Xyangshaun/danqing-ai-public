import type { Config } from 'tailwindcss';

/**
 * 丹青有AI 水墨美学设计系统
 * 严格遵循水墨色系,避免 AI 模板感
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 水墨色系
        ink: {
          DEFAULT: '#1a1a1a', // 墨黑 - 主文字
          50: '#f7f7f7',
          100: '#ededed',
          200: '#d4d4d4',
          300: '#a8a8a8',
          400: '#6b6b6b', // 灰墨 - 次要文字
          500: '#4a4a4a',
          600: '#2e2e2e',
          700: '#1f1f1f',
          800: '#161616',
          900: '#0d0d0d',
        },
        paper: {
          DEFAULT: '#faf8f3', // 宣纸白 - 背景
          50: '#fefdfb',
          100: '#faf8f3',
          200: '#f3efe4',
          300: '#e8e1cf',
          400: '#d4cab0',
        },
        cinnabar: {
          DEFAULT: '#c8392e', // 朱砂红 - 强调/CTA
          50: '#fdf3f2',
          100: '#fae0dd',
          200: '#f3b8b1',
          300: '#e88d82',
          400: '#d85f50',
          500: '#c8392e',
          600: '#a82a20',
          700: '#85211a',
          800: '#5f1812',
          900: '#3d0f0b',
        },
        stone: {
          DEFAULT: '#2e5c6e', // 石青 - 辅助
          50: '#f0f5f7',
          100: '#dbe8ec',
          200: '#b3d0d9',
          300: '#7faec0',
          400: '#4d8599',
          500: '#2e5c6e',
          600: '#234858',
          700: '#1a3642',
          800: '#0f2229',
          900: '#07111a',
        },
        gold: {
          DEFAULT: '#c9a961', // 金色 - 点缀/高端感
          50: '#fbf7ec',
          100: '#f5ecd0',
          200: '#ebd79e',
          300: '#dcc06b',
          400: '#d0b063',
          500: '#c9a961',
          600: '#a8854a',
          700: '#856638',
          800: '#5d4726',
          900: '#3a2b17',
        },
      },
      fontFamily: {
        // 系统字体栈,严禁 Google Fonts
        sans: [
          'PingFang SC',
          'Microsoft YaHei',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        serif: [
          'Songti SC',
          'SimSun',
          'STSong',
          'serif',
        ],
      },
      fontSize: {
        // 中文阅读节奏
        'display-xl': ['clamp(2.75rem, 6vw, 5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-lg': ['clamp(2.25rem, 5vw, 4rem)', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'display-md': ['clamp(1.75rem, 3.5vw, 2.75rem)', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '30': '7.5rem',
      },
      maxWidth: {
        'content': '1200px',
        'prose-cn': '720px',
      },
      borderRadius: {
        'ink': '0.25rem',
      },
      boxShadow: {
        'ink-sm': '0 1px 2px rgba(26, 26, 26, 0.04), 0 1px 3px rgba(26, 26, 26, 0.06)',
        'ink': '0 4px 12px rgba(26, 26, 26, 0.06), 0 2px 6px rgba(26, 26, 26, 0.04)',
        'ink-lg': '0 12px 32px rgba(26, 26, 26, 0.08), 0 4px 12px rgba(26, 26, 26, 0.05)',
        'ink-glow': '0 0 0 1px rgba(201, 169, 97, 0.2), 0 8px 24px rgba(201, 169, 97, 0.12)',
      },
      backgroundImage: {
        'paper-grain':
          'radial-gradient(circle at 20% 30%, rgba(201,169,97,0.04) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(46,92,110,0.03) 0%, transparent 40%)',
        'ink-wash':
          'radial-gradient(ellipse at top, rgba(26,26,26,0.06) 0%, transparent 60%)',
      },
      keyframes: {
        'ink-spread': {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '60%': { opacity: '0.6' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'ink-fade-in': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'brush-stroke': {
          '0%': { strokeDashoffset: '1000', opacity: '0' },
          '30%': { opacity: '1' },
          '100%': { strokeDashoffset: '0', opacity: '1' },
        },
        'seal-press': {
          '0%': { transform: 'scale(1.4) rotate(-8deg)', opacity: '0' },
          '60%': { transform: 'scale(0.95) rotate(2deg)', opacity: '0.9' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        'ink-spread': 'ink-spread 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'ink-fade-in': 'ink-fade-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'brush-stroke': 'brush-stroke 2.4s ease-out forwards',
        'seal-press': 'seal-press 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'float-slow': 'float-slow 6s ease-in-out infinite',
      },
      transitionTimingFunction: {
        'ink': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
