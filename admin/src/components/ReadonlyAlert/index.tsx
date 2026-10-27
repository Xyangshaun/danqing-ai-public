// ============================================================
// 二级只读管理员提示条
// 仅当当前用户为只读管理员时渲染,否则不渲染任何内容
// 用于各业务页面顶部,提示"只读视图,操作按钮已隐藏"
// ============================================================

import { Alert } from 'antd';
import { useReadonlyAdmin } from '@/utils/readonly';

export default function ReadonlyAlert() {
  const readonly = useReadonlyAdmin();
  if (!readonly) return null;
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="二级管理员:只读视图,操作按钮已隐藏"
    />
  );
}
