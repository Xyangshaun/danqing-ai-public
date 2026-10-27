// ============================================================
// 丹青有AI 移动端 Expo 应用配置
// 环境变量通过 dotenv 从 .env 读取(Expo CLI 启动时执行本文件)
// 运行时通过 expo-constants 读取 extra 字段(见 src/services/api.ts)
// 对应后端 API 契约:.trae/documents/api-contract-v1.md §1.1
// ============================================================
require('dotenv').config();

const apiBaseUrl =
  process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const feishuRedirectUriMobile =
  process.env.FEISHU_REDIRECT_URI_MOBILE || 'danqing://auth/feishu/callback';

module.exports = {
  expo: {
    name: '丹青有AI',
    slug: 'danqing-ai',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'danqing',
    userInterfaceStyle: 'automatic',
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.danqing.ai',
      infoPlist: {
        NSCameraUsageDescription: '用于拍摄艺术作品进行 AI 诊断',
        NSPhotoLibraryUsageDescription: '用于选择艺术作品进行 AI 诊断',
      },
    },
    android: {
      package: 'com.danqing.ai',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.READ_EXTERNAL_STORAGE',
      ],
    },
    web: {
      bundler: 'metro',
      output: 'static',
    },
    experiments: {
      tsconfigPaths: true,
    },
    extra: {
      apiBaseUrl,
      feishuRedirectUriMobile,
      eas: {
        projectId: '',
      },
    },
  },
};
