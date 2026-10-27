// ============================================================
// HTTP 客户端(axios 实例)
// 用于调用飞书 OAuth API(authorize / token / userinfo)
// 对应文档:auth-design.md §1.2 步骤 6-7
// 安全:超时 5s,严禁日志输出 App Secret / token
// ============================================================

import axios, { type AxiosInstance } from 'axios';
import { logger } from './logger.js';

let httpClientInstance: AxiosInstance | null = null;

/**
 * 获取 axios 单例
 * - 超时:5 秒(防止飞书 API 阻塞 3 秒 SLA 链路)
 * - 默认 Content-Type: application/json
 */
export function httpClient(): AxiosInstance {
  if (httpClientInstance) {
    return httpClientInstance;
  }
  httpClientInstance = axios.create({
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // 不让 axios 抛 4xx/5xx,业务层通过 response.data.code 判断
    validateStatus: (status) => status >= 200 && status < 600,
  });

  // 请求拦截器:不记录敏感头(Authorization / App Secret)
  httpClientInstance.interceptors.request.use((config) => {
    // 只记录 URL + method,不记录 headers / data
    logger.debug({ url: config.url, method: config.method }, '[http] request');
    return config;
  });

  // 响应拦截器:统一错误日志(脱敏)
  httpClientInstance.interceptors.response.use(
    (response) => {
      logger.debug(
        { url: response.config.url, status: response.status },
        '[http] response',
      );
      return response;
    },
    (err) => {
      // err.message 不含敏感信息
      const url = err.config?.url ?? 'unknown';
      const status = err.response?.status ?? 'n/a';
      logger.error({ url, status, err: err.message }, '[http] error');
      return Promise.reject(err);
    },
  );

  return httpClientInstance;
}
