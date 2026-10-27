// ============================================================
// 用户业务服务
// 对应 API:GET /users/profile + PATCH /users/profile
// ============================================================

import { userRepository } from '../repositories/user.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type UserProfile,
  type UpdateProfileRequest,
  type UpdateRoleRequest,
  type UpdateLearnerProfileRequest,
} from '../types/api-contract.js';
import type { User } from '@prisma/client';

class UserServiceClass {
  /**
   * 获取用户资料(等同于 /auth/me 的 user 字段)
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    return this.toUserProfile(user);
  }

  /**
   * 更新用户资料
   * 可更新:name / avatar / email / phone
   * 不可更新:feishuOpenId / feishuUnionId / role / tenantId
   */
  async updateProfile(userId: string, tenantId: string, data: UpdateProfileRequest): Promise<UserProfile> {
    const user = await userRepository.findByIdAndTenant(userId, tenantId);
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const updateData: Partial<Pick<User, 'name' | 'avatar' | 'email' | 'phone'>> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.avatar !== undefined) updateData.avatar = data.avatar;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;

    const updated = await userRepository.update(tenantId, userId, updateData);
    return this.toUserProfile(updated);
  }

  /**
   * 设置用户角色(首次登录新手引导 onboarding 用)
   *
   * 业务规则(对应 api-contract.ts UpdateRoleRequest 注释):
   *   - 仅允许当前 role='student'(首次登录默认角色)的用户自选一次
   *   - 已切换到 teacher/admin 的账户无法再次自选(需管理员介入)
   *   - 'owner' 角色由系统在创建个人租户时隐式赋值,不可通过本接口选
   *
   * 实现说明:
   *   - 用 "current role === 'student'" 作为 "尚未自选" 的判据:
   *     首次登录默认为 'student',用户一旦选了 'teacher'/'admin' 就不再是 'student',
   *     无法再调本接口自选;若用户首次就选了 'student',则保持 'student'(可后续重选,无副作用)。
   *   - 这样无需新增数据库字段(避免 Prisma migration),仅靠 role 即可表达 "已 onboarding" 语义。
   */
  async setRole(userId: string, tenantId: string, data: UpdateRoleRequest): Promise<UserProfile> {
    const user = await userRepository.findByIdAndTenant(userId, tenantId);
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    // 仅允许当前角色为 'student' 的用户自选(首次登录默认角色)
    if (user.role !== 'student') {
      throw new BusinessError(
        ErrorCode.FORBIDDEN,
        '已选择过职业身份,如需修改请联系管理员',
        403,
      );
    }

    const updated = await userRepository.setRole(userId, tenantId, data.role);
    return this.toUserProfile(updated);
  }

  /**
   * 设置学习者画像(onboarding 二级选择 + 设置页修改用)
   *
   * 与 setRole 的区别:
   *   - learnerProfile 是教学偏好(决定诊断默认模式/语气),非权限字段
   *   - 所有已认证用户可随时修改,无 "仅可自选一次" 限制
   *   - 不参与 TenantMember 同步(仅 User 表字段)
   */
  async setLearnerProfile(
    userId: string,
    tenantId: string,
    data: UpdateLearnerProfileRequest,
  ): Promise<UserProfile> {
    const user = await userRepository.findByIdAndTenant(userId, tenantId);
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const updated = await userRepository.update(tenantId, userId, {
      learnerProfile: data.learnerProfile,
    });
    return this.toUserProfile(updated);
  }

  private toUserProfile(user: User): UserProfile {
    return {
      id: user.id,
      tenantId: user.tenantId,
      feishuOpenId: user.feishuOpenId,
      feishuUnionId: user.feishuUnionId,
      name: user.name,
      avatar: user.avatar,
      email: user.email,
      phone: user.phone,
      role: user.role as UserProfile['role'],
      learnerProfile: (user.learnerProfile as UserProfile['learnerProfile']) ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }
}

export const userService = new UserServiceClass();
