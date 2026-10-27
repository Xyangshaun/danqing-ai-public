// ============================================================
// 登录页(飞书 OAuth)
// layout: false,独立全屏页
// ============================================================

import { useEffect, useState } from 'react';
import { history, useSearchParams } from '@umijs/max';
import { Button, App } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { getFeishuAuthorizeUrl } from '@/services/auth';
import { isAuthenticated } from '@/utils/auth';

export default function LoginPage() {
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  // 已登录直接跳转
  useEffect(() => {
    if (isAuthenticated()) {
      const redirect = params.get('redirect') || '/dashboard/overview';
      history.replace(redirect);
    }
  }, [params]);

  const onLogin = async () => {
    setLoading(true);
    try {
      const res = await getFeishuAuthorizeUrl('admin');
      // 跳转飞书授权页
      window.location.href = res.authorizeUrl;
    } catch {
      message.error('获取飞书授权链接失败,请稍后重试');
      setLoading(false);
    }
  };

  return (
    <div className="dq-login-page">
      <div className="dq-login-bg" />
      <div className="dq-login-card">
        <div className="dq-login-header">
          <div className="dq-login-logo">
            <span className="dq-login-mark">丹</span>
            <div className="dq-login-titles">
              <div className="dq-login-title">丹青有AI</div>
              <div className="dq-login-subtitle">运营管理后台</div>
            </div>
          </div>
          <div className="dq-login-seal">管理后台</div>
        </div>

        <div className="dq-login-body">
          <div className="dq-login-desc">
            本系统仅限授权运营人员与管理员使用,所有操作均记录审计日志。
          </div>

          <Button
            type="primary"
            size="large"
            block
            icon={<SafetyCertificateOutlined />}
            loading={loading}
            onClick={onLogin}
            style={{ height: 44, marginTop: 24 }}
          >
            飞书账号登录
          </Button>

          <div className="dq-login-hint">
            <SafetyCertificateOutlined style={{ marginRight: 4 }} />
            仅 ADMIN / OWNER 角色可访问
          </div>
        </div>

        <div className="dq-login-footer">
          © 2026 丹青有AI · 部署于内网 / VPN 环境
        </div>
      </div>

      <style>{`
        .dq-login-page {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f3efe6;
          overflow: hidden;
        }
        .dq-login-bg {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 15% 25%, rgba(201, 169, 97, 0.10) 0%, transparent 40%),
            radial-gradient(circle at 85% 75%, rgba(46, 92, 110, 0.08) 0%, transparent 45%),
            radial-gradient(circle at 50% 50%, rgba(26, 26, 26, 0.02) 0%, transparent 60%);
        }
        .dq-login-card {
          position: relative;
          width: 420px;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(12px);
          border: 1px solid #e3dccd;
          border-radius: 12px;
          padding: 36px 40px 28px;
          box-shadow: 0 12px 48px rgba(26, 26, 26, 0.08);
        }
        .dq-login-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .dq-login-logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dq-login-mark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: linear-gradient(135deg, #2e5c6e 0%, #1f4250 100%);
          color: #fff;
          font-weight: 600;
          font-size: 20px;
          box-shadow: 0 3px 8px rgba(46, 92, 110, 0.3);
        }
        .dq-login-title {
          font-size: 20px;
          font-weight: 600;
          color: #1a1a1a;
          letter-spacing: 0.02em;
        }
        .dq-login-subtitle {
          font-size: 12px;
          color: #6b6b6b;
          margin-top: 2px;
        }
        .dq-login-seal {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px 8px;
          border: 1px solid #c8392e;
          color: #c8392e;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
        }
        .dq-login-body {
          margin-top: 28px;
        }
        .dq-login-desc {
          font-size: 13px;
          color: #6b6b6b;
          line-height: 1.7;
          padding: 12px 14px;
          background: rgba(201, 169, 97, 0.08);
          border-left: 2px solid #c9a961;
          border-radius: 2px;
        }
        .dq-login-hint {
          margin-top: 16px;
          text-align: center;
          font-size: 12px;
          color: #6b6b6b;
        }
        .dq-login-footer {
          margin-top: 28px;
          padding-top: 16px;
          border-top: 1px solid #ece6d8;
          text-align: center;
          font-size: 11px;
          color: #6b6b6b;
        }
      `}</style>
    </div>
  );
}
