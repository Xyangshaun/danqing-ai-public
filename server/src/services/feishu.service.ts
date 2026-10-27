// ============================================================
// 飞书 OAuth 服务
// 对应文档:auth-design.md §1.2 步骤 4(拼装 authorize URL)
// + §1.2 步骤 6(用 code 换 access_token)
// + §1.2 步骤 7(获取用户信息)
// 安全:App Secret 仅在后端持有,严禁出现在任何日志/响应
// ============================================================

import { env } from '../config/env.js';
import { httpClient } from '../utils/http-client.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';

/**
 * 飞书授权 URL 拼装结果
 */
export interface FeishuAuthorizeUrlResult {
  authorizeUrl: string;
  state: string;
  redirectUri: string;
}

/**
 * 飞书用户信息(对应 auth-design.md §1.2 步骤 7)
 */
export interface FeishuUserInfo {
  openId: string;
  unionId: string;
  name: string;
  avatarUrl: string;
  email: string | null;
  mobile: string | null;
  tenantKey: string | null;
  employeeNo: string | null;
}

class FeishuServiceClass {
  /**
   * 拼装飞书授权 URL
   * @param state 后端生成的 state(由 controller 传入,本服务不负责生成)
   * @param redirectUri 回调 URI(必须与飞书应用白名单严格匹配)
   */
  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const cfg = env();
    const params = new URLSearchParams({
      app_id: cfg.feishuAppId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `${cfg.feishuAuthzEndpoint}?${params.toString()}`;
  }

  /**
   * 根据客户端类型选择 redirect_uri
   */
  pickRedirectUri(client: 'web' | 'admin' | 'mobile'): string {
    const cfg = env();
    switch (client) {
      case 'admin':
        return cfg.feishuRedirectUriAdmin;
      case 'mobile':
        return cfg.feishuRedirectUriMobile;
      case 'web':
      default:
        return cfg.feishuRedirectUriWeb;
    }
  }

  /**
   * 获取飞书 app_access_token
   * OIDC 端点要求 Authorization: Bearer <app_access_token>
   * @returns app_access_token(有效期 2 小时)
   */
  private async getAppAccessToken(): Promise<string> {
    const cfg = env();
    try {
      const resp = await httpClient().post(
        'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
        {
          app_id: cfg.feishuAppId,
          app_secret: cfg.feishuAppSecret,
        },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const body = resp.data as { code?: number; app_access_token?: string; msg?: string };
      if (body.code !== 0 || !body.app_access_token) {
        logger.warn({ feishuCode: body.code, feishuMsg: body.msg }, '[feishu] app_access_token failed');
        throw new BusinessError(
          ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
          '飞书 app_access_token 获取失败',
          502,
        );
      }
      return body.app_access_token;
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[feishu] app_access_token http error');
      throw new BusinessError(
        ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
        '飞书 app_access_token 获取失败',
        502,
      );
    }
  }

  /**
   * 用 code 换 access_token
   * 对应 auth-design.md §1.2 步骤 6:POST /authen/v1/oidc/access_token
   * @param code 飞书返回的授权码(一次性,5 分钟有效)
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    openId: string;
    unionId: string;
    expiresIn: number;
  }> {
    const cfg = env();
    const endpoint = cfg.feishuTokenEndpoint;

    // OIDC 端点要求 Authorization: Bearer <app_access_token>
    const appAccessToken = await this.getAppAccessToken();

    try {
      const resp = await httpClient().post(
        endpoint,
        {
          grant_type: 'authorization_code',
          code,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appAccessToken}`,
          },
        },
      );

      // 飞书 OIDC 端点返回结构:{ code, msg, data: { access_token, refresh_token, open_id, union_id, expires_in, refresh_expires_in, token_type } }
      const body = resp.data as {
        code?: number;
        msg?: string;
        data?: {
          access_token?: string;
          refresh_token?: string;
          open_id?: string;
          union_id?: string;
          expires_in?: number;
          refresh_expires_in?: number;
          token_type?: string;
        };
      };

      if (body.code !== 0 || !body.data?.access_token) {
        logger.warn({ feishuCode: body.code, feishuMsg: body.msg }, '[feishu] token exchange failed');
        throw new BusinessError(
          ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
          '飞书 access_token 获取失败',
          502,
        );
      }

      const d = body.data;
      return {
        accessToken: d.access_token!,
        refreshToken: d.refresh_token ?? '',
        openId: d.open_id ?? '',
        unionId: d.union_id ?? '',
        expiresIn: d.expires_in ?? 7200,
      };
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[feishu] token exchange http error');
      throw new BusinessError(
        ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
        '飞书 access_token 获取失败',
        502,
      );
    }
  }

  /**
   * 创建飞书扫码登录二维码
   * 对应飞书 passport API:POST /suite/passport/oauth/qrcode/create
   * @param state 后端生成的 state(防 CSRF)
   * @returns 二维码图片 URL + qr_token(用于轮询扫码状态)
   */
  async createQrCode(state: string): Promise<{
    qrCodeUrl: string;
    qrToken: string;
    state: string;
  }> {
    const cfg = env();
    // 扫码登录回调地址复用 web redirect_uri(扫码确认后飞书返回 code,无需整页跳转)
    const redirectUri = cfg.feishuRedirectUriWeb;

    try {
      const resp = await httpClient().post(
        'https://passport.feishu.cn/suite/passport/oauth/qrcode/create',
        {
          client_id: cfg.feishuAppId,
          client_secret: cfg.feishuAppSecret,
          scope: 'login',
          redirect_uri: redirectUri,
          state,
        },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const body = resp.data as {
        code?: number;
        msg?: string;
        data?: {
          qr_code_url?: string;
          qr_token?: string;
          state?: string;
        };
      };
      if (body.code !== 0 || !body.data?.qr_code_url || !body.data.qr_token) {
        logger.warn({ feishuCode: body.code, feishuMsg: body.msg }, '[feishu] qrcode create failed');
        throw new BusinessError(
          ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
          '飞书二维码创建失败',
          502,
        );
      }
      return {
        qrCodeUrl: body.data.qr_code_url,
        qrToken: body.data.qr_token,
        state: body.data.state ?? state,
      };
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[feishu] qrcode create http error');
      throw new BusinessError(
        ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
        '飞书二维码创建失败',
        502,
      );
    }
  }

  /**
   * 查询飞书扫码登录状态
   * 对应飞书 passport API:GET /suite/passport/oauth/qrcode/status
   * @param qrToken 创建二维码时返回的 qr_token
   * @param state 创建二维码时返回的 state
   * @returns status: new(等待扫码) | scanned(已扫码待确认) | confirmed(已确认,含 code) | expired | canceled
   */
  async getQrCodeStatus(qrToken: string, state: string): Promise<{
    status: 'new' | 'scanned' | 'confirmed' | 'expired' | 'canceled';
    code?: string; // confirmed 时返回授权码,用于换 token
  }> {
    const cfg = env();
    const params = new URLSearchParams({
      client_id: cfg.feishuAppId,
      client_secret: cfg.feishuAppSecret,
      qr_token: qrToken,
      state,
    });
    const url = `https://passport.feishu.cn/suite/passport/oauth/qrcode/status?${params.toString()}`;

    try {
      const resp = await httpClient().get(url);
      const body = resp.data as {
        code?: number;
        msg?: string;
        data?: {
          status?: string;
          code?: string; // confirmed 时返回授权码
        };
      };
      if (body.code !== 0 || !body.data?.status) {
        logger.warn({ feishuCode: body.code, feishuMsg: body.msg }, '[feishu] qrcode status failed');
        throw new BusinessError(
          ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
          '飞书扫码状态查询失败',
          502,
        );
      }
      const status = body.data.status as 'new' | 'scanned' | 'confirmed' | 'expired' | 'canceled';
      return {
        status,
        code: body.data.code,
      };
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[feishu] qrcode status http error');
      throw new BusinessError(
        ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED,
        '飞书扫码状态查询失败',
        502,
      );
    }
  }

  /**
   * 用 access_token 获取用户信息
   * 对应 auth-design.md §1.2 步骤 7:GET /authen/v1/user_info
   * @param feishuAccessToken 飞书应用维度访问用户资源的 token(非 JWT)
   */
  async getUserInfo(feishuAccessToken: string): Promise<FeishuUserInfo> {
    const cfg = env();
    const endpoint = cfg.feishuUserinfoEndpoint;

    try {
      const resp = await httpClient().get(endpoint, {
        headers: {
          Authorization: `Bearer ${feishuAccessToken}`,
        },
      });

      const body = resp.data as {
        code?: number;
        msg?: string;
        data?: {
          open_id?: string;
          union_id?: string;
          name?: string;
          avatar_url?: string;
          email?: string;
          mobile?: string;
          tenant_key?: string;
          employee_no?: string;
        };
      };

      if (body.code !== 0 || !body.data) {
        logger.warn({ feishuCode: body.code, feishuMsg: body.msg }, '[feishu] user_info failed');
        throw new BusinessError(
          ErrorCode.FEISHU_USER_INFO_FAILED,
          '飞书用户信息获取失败',
          502,
        );
      }

      const d = body.data;
      return {
        openId: d.open_id ?? '',
        unionId: d.union_id ?? '',
        name: d.name ?? '飞书用户',
        avatarUrl: d.avatar_url ?? '',
        email: d.email ?? null,
        mobile: d.mobile ?? null,
        tenantKey: d.tenant_key ?? null,
        employeeNo: d.employee_no ?? null,
      };
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[feishu] user_info http error');
      throw new BusinessError(
        ErrorCode.FEISHU_USER_INFO_FAILED,
        '飞书用户信息获取失败',
        502,
      );
    }
  }
}

export const feishuService = new FeishuServiceClass();
