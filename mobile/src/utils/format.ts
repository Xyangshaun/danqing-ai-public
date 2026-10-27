// 丹青有AI 移动端展示格式化工具(纯函数,无副作用)
// 类型来自跨端契约 src/types/api-contract.ts
import type {
  AnalysisStatus,
  ArtType,
  UserRole,
  ISODateString,
} from '../types/api-contract';

/** 作品类型 → 中文 */
export function artTypeToLabel(t: ArtType): string {
  switch (t) {
    case 'painting':
      return '绘画';
    case 'design':
      return '设计';
    case 'product':
      return '产品';
    case 'sculpture':
      return '雕塑';
    default:
      return '未知';
  }
}

/** 分析状态 → 中文 */
export function statusToLabel(s: AnalysisStatus): string {
  switch (s) {
    case 'pending':
      return '排队中';
    case 'processing':
      return '分析中';
    case 'success':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未知';
  }
}

/** 用户角色 → 中文 */
export function roleToLabel(r: UserRole): string {
  switch (r) {
    case 'admin':
      return '管理员';
    case 'teacher':
      return '教师';
    case 'student':
      return '学生';
    case 'owner':
      return '所有者';
    default:
      return '未知';
  }
}

/** ISO 时间 → YYYY-MM-DD HH:mm(本地时区) */
export function formatDateTime(iso: ISODateString | string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
