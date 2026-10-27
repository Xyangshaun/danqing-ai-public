// 丹青有AI 移动端分析记录 API(对应后端 /analyses/*)
// 类型全部来自跨端契约 src/types/api-contract.ts
// 注:创建 / 上传 / 删除在 P3-1.3 / 后续任务接入,本文件仅含 P3-1.2 用到的列表 + 详情。
import api from './api';
import type {
  ArtType,
  CreateAnalysisResponse,
  ListAnalysesQuery,
  ListAnalysesResponse,
  GetAnalysisResponse,
} from '../types/api-contract';

/** GET /analyses — 历史列表(分页) */
export function listAnalyses(
  query: ListAnalysesQuery,
): Promise<ListAnalysesResponse> {
  return api.get('/analyses', { params: query }) as unknown as Promise<ListAnalysesResponse>;
}

/** GET /analyses/:id — 分析详情 */
export function getAnalysis(id: string): Promise<GetAnalysisResponse> {
  return api.get(`/analyses/${encodeURIComponent(id)}`) as unknown as Promise<GetAnalysisResponse>;
}

/**
 * 待上传的图片文件(RN 端本地资源)
 * - uri:本地 file:// 或 ph:// 路径
 * - type:MIME(jpeg/png/webp)
 * - fileName:文件名(后端做魔数校验,MIME 仅作参考)
 */
export interface UploadImageFile {
  uri: string;
  type?: string;
  fileName?: string;
}

/**
 * POST /analyses/upload — multipart/form-data 上传作品图 + 表单字段
 *
 * 后端契约:
 *   - 文件字段名:image(单文件,≤10MB,jpeg/png/webp,后端做魔数权威校验)
 *   - 表单字段:artType(必填)/ title(可选)/ remark(可选)
 *   - 3 秒 SLA:后端 AI 分析硬超时 2500ms;移动端 axios timeout 30000ms,
 *     给上传 + AI 总时长留余量,但单次请求不超过 30s
 *   - 响应拦截器已自动拆包 ApiResponse,这里直接拿到 CreateAnalysisResponse
 *
 * RN FormData 兼容性:
 *   RN 的 FormData.append 运行时支持 { uri, type, name } 资源对象,
 *   但与 lib.dom.d.ts 的 FormData 类型签名不兼容,这里用类型断言绕过。
 */
export function uploadAnalysis(params: {
  image: UploadImageFile;
  artType: ArtType;
  title?: string;
  remark?: string;
}): Promise<CreateAnalysisResponse> {
  const formData = new FormData();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileAsset: any = {
    uri: params.image.uri,
    type: params.image.type || 'image/jpeg',
    name: params.image.fileName || `photo-${Date.now()}.jpg`,
  };
  formData.append('image', fileAsset);
  formData.append('artType', params.artType);
  if (params.title) formData.append('title', params.title);
  if (params.remark) formData.append('remark', params.remark);

  return api.post('/analyses/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 上传 + AI 分析单次请求不超过 30s(后端 2500ms AI 硬超时 + 上传 + 网络余量)
    timeout: 30000,
  }) as unknown as Promise<CreateAnalysisResponse>;
}
