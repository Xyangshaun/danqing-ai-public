// ============================================================
// 班级 Repository(班级即租户 type='class')
// 对应文档:data-model-v1.md §7.2(强制 tenant_id 过滤)
//
// 职责:
//   - 班级不建新表,复用 Tenant(type='class') + TenantMember 模型
//   - 仅封装班级专属查询;通用成员/租户查询复用 tenantRepository
//   - 所有查询强制 tenantId/type='class' 过滤,防止跨班级/跨类型越权
// ============================================================

import type { ClassMessage, Tenant, TenantMember, User } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 班级列表项(当前用户成员关系 + 班级租户 + 成员数) */
export interface ClassMembershipWithTenant {
  membership: TenantMember;
  tenant: Tenant;
  memberCount: number;
}

export class ClassRepository {
  /**
   * 创建班级(事务):Tenant(type='class') + TenantMember(role='teacher')
   * 保证原子性:任一失败整体回滚,避免出现"无班主任的孤儿班级"
   *
   * @param data.name 班级名称
   * @param data.description 班级描述(可空,最大 500 字符,service 层已校验)
   * @param data.teacherId 创建者用户 ID(自动成为班级 teacher)
   * @param data.maxSeats 席位上限(默认 50,由 service 层传入)
   */
  async createClassWithTeacher(data: {
    name: string;
    description: string | null;
    teacherId: string;
    maxSeats: number;
  }): Promise<{ tenant: Tenant; membership: TenantMember }> {
    return prisma().$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          type: 'class',
          description: data.description,
          plan: 'free',
          status: 'active',
          maxSeats: data.maxSeats,
        },
      });
      const membership = await tx.tenantMember.create({
        data: {
          userId: data.teacherId,
          tenantId: tenant.id,
          role: 'teacher',
          joinedAt: new Date(),
        },
      });
      return { tenant, membership };
    });
  }

  /**
   * 查询指定用户作为成员的所有班级(type='class'),含成员数
   * 通过 TenantMember 关联查询,按加入时间倒序
   * 注:不过滤 tenant.status,禁用班级仍展示(由 service 层决定可用性语义)
   */
  async listClassesByMember(userId: string): Promise<ClassMembershipWithTenant[]> {
    const memberships = await prisma().tenantMember.findMany({
      where: {
        userId,
        tenant: { type: 'class' },
      },
      include: {
        tenant: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    return memberships.map((m) => ({
      membership: m,
      tenant: m.tenant,
      memberCount: m.tenant._count.members,
    }));
  }

  /**
   * 按 ID 查询班级(强制 type='class' 过滤)
   * 防止把 school/college/individual 类型的租户当班级操作
   */
  async findClassById(classId: string): Promise<Tenant | null> {
    return prisma().tenant.findFirst({
      where: { id: classId, type: 'class' },
    });
  }

  // ============================================================
  // 班级讨论消息(ClassMessage)
  // ============================================================

  /**
   * 写入班级消息(text / analysis_share)
   * analysis_share 的归属校验由 service 层完成,此处仅落盘
   */
  async createMessage(data: {
    tenantId: string;
    userId: string;
    type: 'text' | 'analysis_share';
    content: string;
    analysisId?: string;
    snapshot?: object;
  }): Promise<ClassMessage & { user: Pick<User, 'id' | 'name' | 'avatar'> }> {
    return prisma().classMessage.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        type: data.type,
        content: data.content,
        analysisId: data.analysisId ?? null,
        // Prisma Json 字段:undefined 表示不写入(DB null)
        snapshot: data.snapshot ?? undefined,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  /**
   * 查询班级消息(强制 tenantId 过滤)
   * 三种模式:
   *   - 默认:最新 limit 条(倒序取再反转为升序)
   *   - after(消息 ID):该消息之后创建的记录(升序,增量轮询)
   *   - before(消息 ID):该消息之前创建的记录(倒序取 limit 条,返回时反转为升序)
   *
   * 游标基于 createdAt + id 双条件(避免同毫秒记录丢失)
   */
  async listMessages(params: {
    tenantId: string;
    limit: number;
    after?: string;
    before?: string;
  }): Promise<{ items: (ClassMessage & { user: Pick<User, 'id' | 'name' | 'avatar'> })[]; hasMore: boolean }> {
    const { tenantId, limit, after, before } = params;

    // 游标消息定位(取 createdAt 作为比较基准)
    let cursor: { createdAt: Date; id: string } | null = null;
    const cursorId = after ?? before;
    if (cursorId) {
      cursor = await prisma().classMessage.findFirst({
        where: { id: cursorId, tenantId },
        select: { createdAt: true, id: true },
      });
      // 游标无效(消息不存在/跨班级):返回空集,由 service 映射语义
      if (!cursor) return { items: [], hasMore: false };
    }

    const include = { user: { select: { id: true, name: true, avatar: true } } } as const;

    if (after && cursor) {
      // 增量:createdAt > 游标,或同毫秒 id > 游标 id(升序)
      const items = await prisma().classMessage.findMany({
        where: {
          tenantId,
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        },
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      });
      return { items, hasMore: false };
    }

    if (before && cursor) {
      // 翻页:createdAt < 游标,或同毫秒 id < 游标 id(倒序取 limit+1 判断 hasMore)
      const rows = await prisma().classMessage.findMany({
        where: {
          tenantId,
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).reverse();
      return { items, hasMore };
    }

    // 默认:最新 limit 条(倒序取,返回时反转为升序)
    const rows = await prisma().classMessage.findMany({
      where: { tenantId },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).reverse();
    return { items, hasMore };
  }

  /**
   * 校验指定分析是否被分享到班级(存在 analysis_share 消息)
   * 用于 shared-analyses 端点的访问放行判定
   */
  async existsShareMessage(tenantId: string, analysisId: string): Promise<boolean> {
    const count = await prisma().classMessage.count({
      where: { tenantId, analysisId, type: 'analysis_share' },
    });
    return count > 0;
  }
}

export const classRepository = new ClassRepository();
