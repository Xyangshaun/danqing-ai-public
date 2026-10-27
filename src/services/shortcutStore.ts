/**
 * 快捷入口存储 (P2)
 * ===========================================================
 * 控制台首页"快捷入口"面板的用户自定义预设入口。
 * 快捷入口是【引用】(存 kind + presetId),不是拷贝:
 *   - 渲染时(resolveShortcuts)用最新预设的 name/accent 覆盖冗余字段,避免数据不同步
 *   - 预设被删除后,失效的快捷入口会被自动过滤并在挂载时静默清理
 *
 * 存储 key: 'danqing-shortcuts'
 * 上限 8 条,超出提示
 */

import { getEmotionById } from './emotionLibrary';
import { listEmotionPresets, type EmotionPreset } from './emotionPresetStore';
import { listFuseUserPresets, type FuseUserPreset } from './fusePresetStore';

/** 快捷入口指向的预设种类 */
export type ShortcutKind = 'emotion' | 'fuse';

export interface Shortcut {
  /** 快捷入口唯一 id */
  id: string;
  /** 指向哪类预设 */
  kind: ShortcutKind;
  /** 指向 emotion/fuse 预设 id */
  presetId: string;
  /** 冗余显示名(预设改名时,渲染用最新预设名覆盖) */
  name: string;
  /** 冗余颜色(从关联预设取) */
  accent: string;
  createdAt: number;
}

/** 渲染辅助结果:关联最新预设信息后的快捷入口 */
export interface ResolvedShortcut {
  id: string;
  kind: ShortcutKind;
  presetId: string;
  /** 最新预设名(覆盖冗余 name) */
  name: string;
  /** 最新预设主色(覆盖冗余 accent) */
  accent: string;
  createdAt: number;
  /** 点击跳转链接 */
  link: string;
}

const STORAGE_KEY = 'danqing-shortcuts';
export const MAX_SHORTCUTS = 8;

/** 校验单条快捷入口结构,非法返回 false */
function isValidShortcut(s: unknown): s is Shortcut {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    (o.kind === 'emotion' || o.kind === 'fuse') &&
    typeof o.presetId === 'string' &&
    typeof o.name === 'string' &&
    typeof o.accent === 'string' &&
    typeof o.createdAt === 'number'
  );
}

export function listShortcuts(): Shortcut[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidShortcut);
  } catch {
    return [];
  }
}

function writeShortcuts(list: Shortcut[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* localStorage 写失败静默,不影响页面 */
  }
}

/**
 * 添加快捷入口
 * - 已存在(同 kind + presetId)返回 duplicate
 * - 达到上限 8 返回 limit
 * - 成功返回 { ok: true, shortcut }
 */
export function addShortcut(
  kind: ShortcutKind,
  presetId: string,
): { ok: true; shortcut: Shortcut } | { ok: false; reason: 'limit' | 'duplicate' } {
  const list = listShortcuts();
  if (list.some((s) => s.kind === kind && s.presetId === presetId)) {
    return { ok: false, reason: 'duplicate' };
  }
  if (list.length >= MAX_SHORTCUTS) {
    return { ok: false, reason: 'limit' };
  }

  // 取冗余 name/accent(来自关联预设);调用方传入的 presetId 均来自现有预设列表,兜底防御
  const { name, accent } = resolvePresetInfo(kind, presetId);
  const shortcut: Shortcut = {
    id: `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    presetId,
    name,
    accent,
    createdAt: Date.now(),
  };
  writeShortcuts([shortcut, ...list]);
  return { ok: true, shortcut };
}

export function removeShortcut(id: string): void {
  const next = listShortcuts().filter((s) => s.id !== id);
  writeShortcuts(next);
}

/** 该 preset 是否已被固定为快捷入口 */
export function isShortcutAdded(kind: ShortcutKind, presetId: string): boolean {
  return listShortcuts().some((s) => s.kind === kind && s.presetId === presetId);
}

/**
 * 渲染辅助:读取快捷入口并关联最新预设信息
 * - 过滤掉 presetId 在对应 store 中已不存在的失效项
 * - 用最新预设的 name/accent 覆盖冗余字段
 * - 生成跳转 link(emotion → /emotion?preset=xx&auto=1;fuse → /fuse?preset=xx&auto=1)
 */
export function resolveShortcuts(): ResolvedShortcut[] {
  const shortcuts = listShortcuts();
  if (shortcuts.length === 0) return [];

  const emotionMap = new Map<string, EmotionPreset>();
  listEmotionPresets().forEach((p) => emotionMap.set(p.id, p));
  const fuseMap = new Map<string, FuseUserPreset>();
  listFuseUserPresets().forEach((p) => fuseMap.set(p.id, p));

  const resolved: ResolvedShortcut[] = [];
  for (const s of shortcuts) {
    if (s.kind === 'emotion') {
      const preset = emotionMap.get(s.presetId);
      if (!preset) continue; // 失效,跳过
      const primary = getEmotionById(preset.primaryId);
      resolved.push({
        id: s.id,
        kind: s.kind,
        presetId: s.presetId,
        name: preset.name,
        accent: primary?.colorPalette?.[0] || '#B91C1C',
        createdAt: s.createdAt,
        link: `/emotion?preset=${encodeURIComponent(preset.id)}&auto=1`,
      });
    } else {
      const preset = fuseMap.get(s.presetId);
      if (!preset) continue; // 失效,跳过
      resolved.push({
        id: s.id,
        kind: s.kind,
        presetId: s.presetId,
        name: preset.name,
        accent: '#B45309',
        createdAt: s.createdAt,
        link: `/fuse?preset=${encodeURIComponent(preset.id)}&auto=1`,
      });
    }
  }
  return resolved;
}

/**
 * 静默清理失效快捷入口:删除 presetId 在对应 store 中已不存在的快捷入口
 * (与 HomePage "我的预设方案"区块的 accent 取值保持一致)
 */
export function pruneInvalidShortcuts(): void {
  const shortcuts = listShortcuts();
  if (shortcuts.length === 0) return;

  const validKeys = new Set<string>();
  listEmotionPresets().forEach((p) => validKeys.add(`emotion:${p.id}`));
  listFuseUserPresets().forEach((p) => validKeys.add(`fuse:${p.id}`));

  const next = shortcuts.filter((s) => validKeys.has(`${s.kind}:${s.presetId}`));
  if (next.length !== shortcuts.length) {
    writeShortcuts(next);
  }
}

/** 从关联预设取冗余 name/accent(取不到时用兜底值,保证条目结构完整) */
function resolvePresetInfo(kind: ShortcutKind, presetId: string): { name: string; accent: string } {
  if (kind === 'emotion') {
    const preset = listEmotionPresets().find((p) => p.id === presetId);
    if (preset) {
      const primary = getEmotionById(preset.primaryId);
      return {
        name: preset.name,
        accent: primary?.colorPalette?.[0] || '#B91C1C',
      };
    }
    return { name: '情绪画布', accent: '#B91C1C' };
  }
  const preset = listFuseUserPresets().find((p) => p.id === presetId);
  if (preset) {
    return { name: preset.name, accent: '#B45309' };
  }
  return { name: '灵感嫁接', accent: '#B45309' };
}
