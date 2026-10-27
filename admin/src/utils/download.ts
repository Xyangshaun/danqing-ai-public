// ============================================================
// CSV 下载工具
// - 流式拼接大数据量
// - RFC 4180 转义(含逗号/引号/换行用双引号包裹)
// - 前端导出走后端 /api/admin/users/export 接口(已脱敏)
//   本工具用于纯前端场景(如审计日志快照导出)
// ============================================================

/** CSV 字段转义 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 将对象数组转为 CSV 字符串 */
export function toCsv(rows: Record<string, unknown>[], fields: string[], headers?: string[]): string {
  const headerRow = (headers ?? fields).map(csvEscape).join(',');
  const dataRows = rows.map((row) =>
    fields.map((f) => csvEscape(row[f])).join(','),
  );
  // BOM 头确保 Excel 正确识别 UTF-8
  return '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
}

/** 触发浏览器下载(给定 Blob) */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放,避免 Safari 下载失败
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 下载文本内容 */
export function downloadText(text: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** 下载 JSON */
export function downloadJson(data: unknown, filename: string): void {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
    filename,
  );
}

/** 生成带时间戳的文件名 */
export function timestampedFilename(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}_${ts}.${ext}`;
}
