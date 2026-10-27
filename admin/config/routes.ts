/**
 * 路由配置
 * - access 字段对应 src/access.ts 中导出的函数,实现菜单级权限控制
 * - 权限码不在此硬编码"谁可访问",仅声明"查看本菜单需要哪个权限码"
 *   实际权限集合由后端 /api/admin/roles 返回,运行时匹配
 */
export default [
  {
    path: '/login',
    layout: false,
    component: './login',
  },
  {
    path: '/auth/feishu/callback',
    layout: false,
    component: './auth/callback',
  },
  {
    path: '/',
    redirect: '/dashboard/overview',
  },
  {
    path: '/dashboard',
    name: '数据看板',
    icon: 'dashboard',
    access: 'canStatsRead',
    routes: [
      {
        path: '/dashboard',
        redirect: '/dashboard/overview',
      },
      {
        path: '/dashboard/overview',
        name: '总览',
        component: './dashboard/overview',
        access: 'canStatsRead',
      },
      {
        path: '/dashboard/realtime',
        name: '实时大屏',
        component: './dashboard/realtime',
        access: 'canStatsRead',
      },
      {
        path: '/dashboard/observability',
        name: '可观测性',
        component: './dashboard/observability',
        access: 'canStatsRead',
      },
      {
        path: '/dashboard/tenant',
        name: '租户下钻',
        component: './dashboard/tenant',
        access: 'canStatsRead',
      },
    ],
  },
  {
    path: '/user',
    name: '用户管理',
    icon: 'team',
    access: 'canUserRead',
    routes: [
      {
        path: '/user',
        redirect: '/user/list',
      },
      {
        path: '/user/list',
        name: '用户列表',
        component: './user/list',
        access: 'canUserRead',
      },
      {
        path: '/user/detail/:id',
        name: '用户详情',
        component: './user/detail',
        access: 'canUserRead',
        hideInMenu: true,
      },
      {
        path: '/user/roles',
        name: '角色权限',
        component: './user/roles',
        access: 'canRoleRead',
      },
    ],
  },
  {
    path: '/content',
    name: '内容管理',
    icon: 'picture',
    access: 'canArtworkRead',
    routes: [
      {
        path: '/content',
        redirect: '/content/artworks',
      },
      {
        path: '/content/artworks',
        name: '作品库',
        component: './content/artworks',
        access: 'canArtworkRead',
      },
      {
        path: '/content/templates',
        name: '模板管理',
        component: './content/templates',
        access: 'canTemplateRead',
      },
    ],
  },
  {
    path: '/subscription',
    name: '订阅管理',
    icon: 'wallet',
    access: 'canSubscriptionRead',
    routes: [
      {
        path: '/subscription',
        redirect: '/subscription/list',
      },
      {
        path: '/subscription/list',
        name: '订阅列表',
        component: './subscription/list',
        access: 'canSubscriptionRead',
      },
      {
        path: '/subscription/detail/:id',
        name: '订阅详情',
        component: './subscription/detail',
        access: 'canSubscriptionRead',
        hideInMenu: true,
      },
      {
        path: '/subscription/invoices',
        name: '发票管理',
        component: './subscription/invoices',
        access: 'canSubscriptionRead',
      },
      {
        path: '/subscription/plans',
        name: '套餐管理',
        component: './subscription/plans',
        access: 'canPlanRead',
      },
    ],
  },
  {
    path: '/system',
    name: '系统管理',
    icon: 'setting',
    access: 'canSystemAccess',
    routes: [
      {
        path: '/system',
        redirect: '/system/tenants',
      },
      {
        path: '/system/tenants',
        name: '租户管理',
        component: './system/tenants',
        access: 'canTenantRead',
      },
      {
        path: '/system/audit-logs',
        name: '审计日志',
        component: './system/audit-logs',
        access: 'canAuditRead',
      },
      {
        path: '/system/api-keys',
        name: 'API 密钥',
        component: './system/api-keys',
        access: 'canApiKeyRead',
      },
      {
        path: '/system/quota',
        name: '配额管理',
        component: './system/quota',
        access: 'canTenantRead',
      },
      {
        path: '/system/health',
        name: '系统健康',
        component: './system/health',
        access: 'canSystemHealth',
      },
    ],
  },
  {
    path: '/dev',
    name: '开发者视图',
    icon: 'code',
    access: 'canDevView',
    routes: [
      {
        path: '/dev',
        redirect: '/dev/accounts',
      },
      {
        path: '/dev/accounts',
        name: '账号在线',
        component: './dev/accounts',
        access: 'canDevView',
      },
      {
        path: '/dev/deployments',
        name: '版本部署',
        component: './dev/deployments',
        access: 'canDevView',
      },
      {
        path: '/dev/features',
        name: '功能开关',
        component: './dev/features',
        access: 'canDevView',
      },
    ],
  },
  {
    path: '*',
    layout: false,
    component: './404',
  },
];
