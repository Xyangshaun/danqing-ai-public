/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 墨色系（文字/边框/分割线）
        ink: {
          900: '#0f0f0f',
          800: '#1a1a1a',
          700: '#2d2d2d',
          600: '#404040',
          500: '#595959',
          400: '#737373',
          300: '#a3a3a3',
          200: '#d4d4d4',
          100: '#e5e5e5',
          50: '#f5f5f5',
        },
        // 米色系（背景层）
        rice: {
          50: '#fdfcf9',
          100: '#f9f6f0',
          200: '#f5f2eb',
          300: '#ede8df',
          400: '#e0d9c9',
        },
        // 中式品牌色
        cinnabar: '#c41e3a',       // 朱砂
        'cinnabar-dark': '#9a1830',
        'cinnabar-light': '#e85d75',
        stone: '#2e5fa1',          // 石青
        'stone-dark': '#1e4079',
        'stone-light': '#5a8bc4',
        gold: '#d4af37',           // 金
        'gold-dark': '#a8862a',
        'gold-light': '#e6c869',
        jade: '#5b8c5a',           // 增加玉色（成功状态）
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', '"SimSun"', '"STSong"', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        // 极轻微：分割线感
        'subtle': '0 1px 2px 0 rgba(15, 15, 15, 0.04)',
        // 一级卡片
        'card': '0 1px 3px 0 rgba(15, 15, 15, 0.06), 0 1px 2px 0 rgba(15, 15, 15, 0.04)',
        // hover/active 状态
        'card-hover': '0 4px 12px -2px rgba(15, 15, 15, 0.08), 0 2px 4px -1px rgba(15, 15, 15, 0.04)',
        // 浮层/下拉
        'overlay': '0 8px 24px -4px rgba(15, 15, 15, 0.12), 0 4px 8px -2px rgba(15, 15, 15, 0.06)',
        // 模态/弹窗
        'modal': '0 16px 48px -8px rgba(15, 15, 15, 0.18), 0 8px 16px -4px rgba(15, 15, 15, 0.08)',
        // 内嵌凹陷
        'inset-subtle': 'inset 0 1px 2px 0 rgba(15, 15, 15, 0.04)',
      },
      animation: {
        'ink-spread': 'inkSpread 3s ease-out forwards',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'slide-up': 'slideUp 0.4s ease-out forwards',
        'slide-down': 'slideDown 0.3s ease-out forwards',
        'slide-left': 'slideLeft 0.3s ease-out forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        inkSpread: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '50%': { opacity: '0.8' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideLeft: {
          '0%': { transform: 'translateX(8px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
