# 丹青有AI 运营管理后台

> Ant Design Pro 5 + UmiJS 4 + TypeScript 严格模式
> 独立部署于 admin.[domain],仅内网/VPN 可访问

## 开发

```bash
cd admin
npm install
npm run dev      # 默认 http://localhost:8000
```

## 构建

```bash
npm run build    # 输出到 dist/
```

## 环境变量

复制 `.env.example` 为 `.env`,按需修改:

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| ADMIN_API_TARGET | http://localhost:3000 | 后端业务应用地址(开发代理) |
| FEISHU_REDIRECT_URI | http://localhost:8000/auth/feishu/callback | 飞书 OAuth 回调地址 |

## 鉴权

- 飞书 OAuth 登录,JWT access_token 存储于 localStorage
- 请求头:`Authorization: Bearer {access_token}` + `X-Client: admin`
- 仅 ADMIN/OWNER 角色可访问(无 admin:* 权限将进入 403)

## 后端接口

- 认证:`/api/v1/auth/*`
- 管理:`/api/admin/*`(用户/内容/订阅/数据看板/系统)

## 模块

1. 用户管理 `/user` - 列表/详情/角色/批量/导出
2. 内容管理 `/content` - 作品审核/模板 CRUD
3. 订阅管理 `/subscription` - 订阅/发票/套餐
4. 数据看板 `/dashboard` - 总览/趋势/留存/AI成本/实时/租户
5. 系统管理 `/system` - 租户/审计日志/API密钥/健康
