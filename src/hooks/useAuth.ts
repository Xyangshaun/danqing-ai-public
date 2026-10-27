// ============================================================
// 丹青有AI - useAuth Hook
// 必须在 <AuthProvider> 内使用
// ============================================================

import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  }
  return ctx;
}

export type { AuthContextValue } from '../context/AuthContext';
