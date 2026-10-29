# 丹青有AI

> 专为高校艺术教育场景设计的 AI 助教系统。支持绘画、设计、产品设计、雕塑等多种创作形式，让每一份创作都得到专业的点评与指导。

## 项目简介

「丹青有AI」是一个面向高校艺术教育的全栈 AI 助教系统：学生上传作品后，系统在数秒内完成构图、色彩、原创性等维度的智能诊断，给出可操作的改进建议，并串联课堂素材生成、中式美学风格转换、成长追踪等完整教学闭环。

### 核心功能

| 功能 | 说明 |
|------|------|
| **智绘镜** | 智能感知作品复杂度，3 秒内完成构图、色彩、原创性三维度诊断 |
| **课堂素材生成器** | 输入课程主题，自动生成多组教学参考素材 |
| **中式美学风格库** | 内置水墨、青绿山水等非遗风格，一键转换草图风格 |
| **灵感嫁接** | 上传两张作品，AI 提取元素融合，8 种风格 × 6 种方法 × 4 级强度 |
| **情绪画布** | 输入情绪关键词，AI 生成对应色调的参考画面 |
| **成长追踪** | 记录每次诊断数据，生成能力变化曲线和最佳作品 |

## 产品预览

官方网站 [danqing.site](https://danqing.site) 实际运行界面：

| 官网首页 | 产品功能 · AI 诊断 | 创作形式 |
|------|------|------|
| ![官网首页](docs/screenshots/01-landing.png) | ![产品功能](docs/screenshots/02-workspace.png) | ![创作形式](docs/screenshots/03-generator.png) |

| 功能展示 | 数据背书 |
|------|------|
| ![功能展示](docs/screenshots/04-styles.png) | ![数据背书](docs/screenshots/05-growth.png) |

### 技术栈

- **前端**：React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + React Router v6 + Recharts
- **官网**：Next.js（`website/`）
- **管理端**：React + Vite（`admin/`）
- **移动端**：React（`mobile/`）
- **后端**：Node.js + TypeScript + Prisma ORM + Redis（`server/`）
- **工程化**：Docker、Vercel、前后端测试门禁（Vitest）

## 在线演示

- **产品完整体验**：[danqing.site](https://danqing.site)（生产环境，含全部 AI 功能）
- **社区版部署体验**：https://6a4f01878de2462eddd4b61e.vercel.app

## 开源范围说明

本仓库采用 **AGPL-3.0** 许可证开源，为**社区版工程快照**：包含完整的前端、官网、管理端、移动端源码，以及后端完整的路由、控制器、数据模型、队列、缓存与测试工程，可直接部署运行。

**✅ 本仓库包含（社区版，AGPL-3.0）**

- 用户端前端完整源码（`src/`）
- 官网（`website/`）、管理端（`admin/`）、移动端（`mobile/`）
- 后端工程结构：路由、控制器、数据模型（Prisma Schema）、队列、缓存、测试（`server/`）
- Docker 与部署配置样例

**🔒 企业版模块（不在本仓库，通过在线演示体验）**

以下 AI 引擎模块属于商业企业版，本仓库仅保留模块导出符号清单以展示接口边界（见 `server/src/services/` 下对应文件头注释）：

| 模块 | 职责 |
|------|------|
| `ai-vision.service.ts` | AI 视觉分析引擎：视觉提示词工程、标注框几何规整、置信度仲裁 |
| `analysis-engine.service.ts` | 分析调度引擎：多维度诊断编排与结果融合 |
| `ai-analysis.service.ts` | AI 分析服务层 |
| `generation.service.ts` | 教学素材 / 灵感嫁接 / 情绪画布生成引擎 |
| `style-analysis.service.ts` | 中式美学风格分析与转换 |
| `knowledge-card-generation.service.ts` | 知识卡片生成 |
| `knowledge-card-match.service.ts` | 知识卡片匹配 |
| `image-generation.service.ts` | 图像生成服务 |
| `grading-suggestion-engine.ts` | 评分建议引擎 |
| `marker-locator.ts` | 问题标注定位算法 |

> 企业版模块的完整效果可通过上方在线演示直接体验；如有代码审阅需要（如开源基金评审），欢迎联系仓库所有者另行安排。
> 出于安全与知识产权保护目的，本仓库为独立初始化的干净提交，不包含原开发仓库的提交历史。

## 项目结构

```
├── src/                 # 用户端前端（React 18 + TS + Vite）
│   ├── components/      # 组件（含作品标注层、工作台等）
│   ├── pages/           # 页面
│   └── services/        # 前端服务层
├── server/              # 后端（Node.js + TS + Prisma + Redis）
│   ├── src/controllers/ # 控制器
│   ├── src/routes/      # 路由
│   ├── src/services/    # 业务服务（企业版 AI 模块为接口占位）
│   └── prisma/          # 数据模型与迁移
├── website/             # 官网（Next.js）
├── admin/               # 管理端
├── mobile/              # 移动端
├── public/              # 静态资源与素材库数据
└── .github/             # 仓库配置
```

## 本地开发

```bash
# 环境要求：Node.js >= 18，npm >= 9
npm install        # 安装前端依赖
npm run dev        # 启动前端开发服务器 (http://localhost:5173)

cd server && npm install   # 安装后端依赖
cp server/.env.example server/.env   # 参照示例补齐环境变量
```

> 说明：企业版 AI 引擎模块未随本仓库分发，后端服务可独立启动，前端页面与全部工程链路可完整运行与二次开发；AI 分析能力可通过 [danqing.site](https://danqing.site) 在线体验。

## 许可证

本项目社区版基于 [GNU AGPL-3.0](LICENSE) 许可证开源。这意味着：

- 你可以自由地使用、学习、修改和分发本仓库代码；
- 基于本仓库的修改版本若以网络服务形式对外提供，需按 AGPL-3.0 开放对应源码；
- 企业版模块及商业授权请联系仓库所有者。

Copyright (c) 2026 Xyangshaun
