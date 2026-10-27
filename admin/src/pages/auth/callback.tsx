// ============================================================
// 飞书 OAuth 回调页
// 解析 code/state → 调用后端换取 token → 校验角色 → 跳转
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { history, useSearchParams } from '@umijs/max';
import { Spin, Result, Button, App } from 'antd';
import { handleFeishuCallback, getCurrentUser } from '@/services/auth';
import { listRoles } from '@/services/user';
import { setAccessToken } from '@/utils/auth';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error');

    if (err) {
      setError(`飞书授权失败:${err}`);
      return;
    }
    if (!code || !state) {
      setError('回调参数缺失(code/state)');
      return;
    }

    (async () => {
      try {
        // 1. 用 code 换 token
        const res = await handleFeishuCallback({ code, state });
        setAccessToken(res.accessToken, res.accessTokenExpiresAt);

        // 2. 拉取用户 + 角色矩阵,校验是否有管理权限
        const me = await getCurrentUser();
        const roles = await listRoles();
        const roleInfo = roles.find((r) => r.role === me.user.role);
        const permissions = roleInfo?.permissions ?? [];
        const hasAdminPerm = permissions.some((p) => p.startsWith('admin:'));

        if (!hasAdminPerm) {
          setError('当前账号无管理后台访问权限(仅 ADMIN/OWNER 可登录)');
          return;
        }

        message.success(`欢迎回来,${me.user.name}`);
        history.replace('/dashboard/overview');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '登录回调处理失败';
        setError(msg);
      }
    })();
  }, [params, message]);

  if (error) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f3efe6',
        }}
      >
        <Result
          status="error"
          title="登录失败"
          subTitle={error}
          extra={[
            <Button key="login" type="primary" onClick={() => history.replace('/login')}>
              返回登录
            </Button>,
          ]}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3efe6',
        gap: 16,
      }}
    >
      <Spin size="large" />
      <div style={{ color: '#6b6b6b', fontSize: 13 }}>正在完成飞书登录...</div>
    </div>
  );
}
