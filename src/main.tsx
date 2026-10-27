import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import AuthCallbackPage from './pages/AuthCallbackPage.tsx'
import './index.css'

/**
 * HashRouter 兼容方案(auth-design.md §1.2 步骤 5)
 *
 * 飞书 OAuth 回调 URL 是标准路径 /auth/feishu/callback?code=&state=(不带 #),
 * HashRouter 不会处理这种路径(它只处理 # 后面的部分)。
 *
 * 处理策略:
 * - 检测 window.location.pathname 是否为飞书回调路径
 * - 是:独立渲染 AuthCallbackPage(不走 HashRouter),处理完 code/state 后
 *      用 window.location.replace('/app/#/') 跳转首页,让 HashRouter 接管
 * - 否:正常渲染 HashRouter + App
 *
 * 生产环境推荐方案(auth-design.md §1.2 步骤 5 方案 1):
 * 飞书重定向到后端域名,后端处理后 302 跳转 /app/#/auth/feishu/success?ticket=xxx,
 * 前端走 HashRouter 正常路由。本 dev 方案仅用于本地联调。
 *
 * 2026-08-04 调整:业务应用移至 /app 路径,官网占据根路径
 */
const isFeishuCallback = window.location.pathname === '/app/auth/feishu/callback'
  || window.location.pathname === '/auth/feishu/callback';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFeishuCallback ? (
      <AuthCallbackPage />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>,
)
