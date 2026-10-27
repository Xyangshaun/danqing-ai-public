// ============================================================
// 脱敏文本展示组件
// 默认脱敏,支持点击"查看"切换(仅本地展示切换,
// 后端已脱敏数据无法还原,此处仅对前端原始值生效)
// ============================================================

import { useState } from 'react';
import { Typography, Tooltip } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { maskPhone, maskEmail, maskIdCard } from '@/utils/mask';

type MaskType = 'phone' | 'email' | 'idCard' | 'custom';

interface MaskedTextProps {
  value: string | null | undefined;
  type?: MaskType;
  /** type=custom 时使用的脱敏函数 */
  maskFn?: (v: string) => string;
  /** 是否允许切换查看(默认 false,始终脱敏) */
  revealable?: boolean;
}

export default function MaskedText({
  value,
  type = 'phone',
  maskFn,
  revealable = false,
}: MaskedTextProps) {
  const [revealed, setRevealed] = useState(false);

  if (!value) {
    return <span style={{ color: '#bfb8a8' }}>-</span>;
  }

  // 已脱敏(含 *)直接显示
  const isAlreadyMasked = String(value).includes('*');
  const masked = isAlreadyMasked
    ? String(value)
    : type === 'phone'
      ? maskPhone(value)
      : type === 'email'
        ? maskEmail(value)
        : type === 'idCard'
          ? maskIdCard(value)
          : maskFn
            ? maskFn(value)
            : String(value);

  const display = revealed && !isAlreadyMasked ? value : masked;

  if (!revealable || isAlreadyMasked) {
    return <span>{masked}</span>;
  }

  return (
    <Typography.Text>
      {display}
      <Tooltip title={revealed ? '隐藏' : '查看'}>
        <a
          onClick={(e) => {
            e.stopPropagation();
            setRevealed((v) => !v);
          }}
          style={{ marginLeft: 4, fontSize: 12 }}
        >
          {revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        </a>
      </Tooltip>
    </Typography.Text>
  );
}
