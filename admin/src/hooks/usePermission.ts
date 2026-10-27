// ============================================================
// 权限 Hook
// 基于 initialState.permissions 做按钮级权限判定
// ============================================================

import { useModel } from '@umijs/max';
import { PERM } from '@/constants';
import { useCallback } from 'react';

export function usePermission() {
  const { initialState } = useModel('@@initialState');
  const permissions = initialState?.permissions ?? [];

  const hasPermission = useCallback(
    (code: string): boolean => permissions.includes(code),
    [permissions],
  );

  const hasAny = useCallback(
    (codes: string[]): boolean => codes.some((c) => permissions.includes(c)),
    [permissions],
  );

  const hasAll = useCallback(
    (codes: string[]): boolean => codes.every((c) => permissions.includes(c)),
    [permissions],
  );

  return {
    permissions,
    hasPermission,
    hasAny,
    hasAll,
    // 常用快捷判定
    can: {
      userRead: hasPermission(PERM.userRead),
      userWrite: hasPermission(PERM.userWrite),
      userExport: hasPermission(PERM.userExport),
      roleRead: hasPermission(PERM.roleRead),
      roleWrite: hasPermission(PERM.roleWrite),
      artworkRead: hasPermission(PERM.artworkRead),
      artworkWrite: hasPermission(PERM.artworkWrite),
      templateRead: hasPermission(PERM.templateRead),
      templateWrite: hasPermission(PERM.templateWrite),
      subscriptionRead: hasPermission(PERM.subscriptionRead),
      subscriptionWrite: hasPermission(PERM.subscriptionWrite),
      planRead: hasPermission(PERM.planRead),
      planWrite: hasPermission(PERM.planWrite),
      statsRead: hasPermission(PERM.statsRead),
      tenantRead: hasPermission(PERM.tenantRead),
      tenantWrite: hasPermission(PERM.tenantWrite),
      auditRead: hasPermission(PERM.auditRead),
      apiKeyRead: hasPermission(PERM.apiKeyRead),
      apiKeyWrite: hasPermission(PERM.apiKeyWrite),
      systemHealth: hasPermission(PERM.systemHealth),
      invitationWrite: hasPermission(PERM.invitationWrite),
    },
  };
}
